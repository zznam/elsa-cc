/**
 * QuizSession — Manages the lifecycle of a single quiz session.
 *
 * State machine:
 *   WAITING → ACTIVE → FINISHED
 *
 * Responsibilities:
 *   - Track participants and their state
 *   - Manage question progression with timers
 *   - Coordinate with ScoringEngine for answer processing
 *   - Emit events for real-time broadcasting
 */

import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import type {
  Quiz,
  Question,
  Participant,
  QuizSessionState,
  ScoreResult,
  QuestionPayload,
  AnswerSubmission,
} from './types';
import { QuizSessionState as State } from './types';
import { ScoringEngine } from './ScoringEngine';
import { createLogger } from '../utils/logger';
import {
  AppError,
  ErrorCode,
  DuplicateAnswerError,
} from '../utils/errors';

const logger = createLogger('QuizSession');

export interface QuizSessionEvents {
  /** Emitted when a participant joins */
  participantJoined: (participant: Participant) => void;
  /** Emitted when a participant leaves */
  participantLeft: (userId: string, username: string) => void;
  /** Emitted when the quiz starts */
  quizStarted: () => void;
  /** Emitted when a new question begins */
  questionStarted: (payload: QuestionPayload) => void;
  /** Emitted when a question's time expires */
  questionTimeout: (questionId: string, correctOptionIndex: number) => void;
  /** Emitted when a user's score is updated */
  scoreUpdated: (userId: string, scoreResult: ScoreResult) => void;
  /** Emitted when the quiz ends */
  quizEnded: () => void;
}

export class QuizSession extends EventEmitter {
  public readonly sessionId: string;
  public readonly quiz: Quiz;
  private _state: QuizSessionState;
  private participants: Map<string, Participant>;
  private currentQuestionIndex: number;
  private questionTimer: NodeJS.Timeout | null;
  private questionStartTime: number;
  private scoringEngine: ScoringEngine;
  private startedAt: number | null;
  private readonly maxParticipants: number;

  constructor(quiz: Quiz, maxParticipants: number = 100) {
    super();
    this.sessionId = uuidv4();
    this.quiz = quiz;
    this._state = State.WAITING;
    this.participants = new Map();
    this.currentQuestionIndex = -1;
    this.questionTimer = null;
    this.questionStartTime = 0;
    this.scoringEngine = new ScoringEngine();
    this.startedAt = null;
    this.maxParticipants = maxParticipants;
  }

  // ─── Getters ──────────────────────────────────────────────────────────────

  get state(): QuizSessionState {
    return this._state;
  }

  get participantCount(): number {
    return this.participants.size;
  }

  get currentQuestion(): Question | null {
    if (this.currentQuestionIndex < 0 || this.currentQuestionIndex >= this.quiz.questions.length) {
      return null;
    }
    return this.quiz.questions[this.currentQuestionIndex];
  }

  get totalQuestions(): number {
    return this.quiz.questions.length;
  }

  get durationSeconds(): number {
    if (!this.startedAt) return 0;
    return Math.round((Date.now() - this.startedAt) / 1000);
  }

  // ─── Participant Management ─────────────────────────────────────────

  /** Add a participant. Rejects if quiz has already started, full, or username is taken. */
  addParticipant(username: string): Participant {
    if (this._state !== State.WAITING) {
      throw new AppError(ErrorCode.QUIZ_ALREADY_STARTED, `Cannot join quiz '${this.quiz.id}': session is already in ${this._state} state`);
    }

    if (this.participants.size >= this.maxParticipants) {
      throw new AppError(ErrorCode.QUIZ_FULL, `Quiz session '${this.quiz.id}' is full (${this.maxParticipants} max)`);
    }

    for (const p of this.participants.values()) {
      if (p.username === username) {
        throw new AppError(ErrorCode.USER_ALREADY_JOINED, `Username "${username}" is already taken`);
      }
    }

    const participant: Participant = {
      userId: uuidv4(),
      username,
      joinedAt: Date.now(),
      answeredQuestions: new Set(),
      totalScore: 0,
      streak: 0,
      isConnected: true,
    };

    this.participants.set(participant.userId, participant);

    logger.info('Participant joined', {
      sessionId: this.sessionId,
      userId: participant.userId,
      username,
      participantCount: this.participants.size,
    });

    this.emit('participantJoined', participant);
    return participant;
  }

  /** Mark as disconnected — keep state so they can reconnect mid-quiz. */
  disconnectParticipant(userId: string): void {
    const participant = this.participants.get(userId);
    if (participant) {
      participant.isConnected = false;
      logger.info('Participant disconnected', { sessionId: this.sessionId, userId, username: participant.username });
      this.emit('participantLeft', userId, participant.username);
    }
  }

  /** Restore a previously disconnected participant. */
  reconnectParticipant(userId: string): Participant | null {
    const participant = this.participants.get(userId);
    if (participant) {
      participant.isConnected = true;
      logger.info('Participant reconnected', { sessionId: this.sessionId, userId });
    }
    return participant || null;
  }


  getParticipant(userId: string): Participant | undefined {
    return this.participants.get(userId);
  }


  getParticipants(): Participant[] {
    return Array.from(this.participants.values());
  }

  // ─── Quiz Lifecycle ───────────────────────────────────────────────────────

  /** Transition from WAITING → ACTIVE, then begin question delivery. */
  start(): void {
    if (this._state !== State.WAITING) {
      throw new AppError(
        ErrorCode.QUIZ_ALREADY_STARTED,
        `Cannot start quiz '${this.quiz.id}': already in ${this._state} state`,
      );
    }

    this._state = State.ACTIVE;
    this.startedAt = Date.now();

    logger.info('Quiz started', {
      sessionId: this.sessionId,
      quizId: this.quiz.id,
      participantCount: this.participants.size,
    });

    this.emit('quizStarted');
    this.advanceToNextQuestion();
  }

  private advanceToNextQuestion(): void {
    if (this.questionTimer) {
      clearTimeout(this.questionTimer);
      this.questionTimer = null;
    }

    this.currentQuestionIndex++;

    if (this.currentQuestionIndex >= this.quiz.questions.length) {
      this.endQuiz();
      return;
    }

    const question = this.quiz.questions[this.currentQuestionIndex];
    this.questionStartTime = Date.now();

    const payload: QuestionPayload = {
      questionId: question.id,
      questionNumber: this.currentQuestionIndex + 1,
      totalQuestions: this.quiz.questions.length,
      word: question.word,
      prompt: question.prompt,
      options: question.options,
      timeLimitSeconds: question.timeLimitSeconds,
      difficulty: question.difficulty,
    };

    logger.info('Question started', {
      sessionId: this.sessionId,
      questionId: question.id,
      questionNumber: this.currentQuestionIndex + 1,
    });

    this.emit('questionStarted', payload);

    this.questionTimer = setTimeout(() => {
      this.handleQuestionTimeout();
    }, question.timeLimitSeconds * 1000);
  }


  private handleQuestionTimeout(): void {
    const question = this.currentQuestion;
    if (!question) return;

    logger.info('Question timed out', {
      sessionId: this.sessionId,
      questionId: question.id,
    });

    this.emit('questionTimeout', question.id, question.correctOptionIndex);

    // Brief pause before next question to let clients show the correct answer
    setTimeout(() => {
      this.advanceToNextQuestion();
    }, 3000);
  }


  private endQuiz(): void {
    if (this.questionTimer) {
      clearTimeout(this.questionTimer);
      this.questionTimer = null;
    }

    this._state = State.FINISHED;

    logger.info('Quiz ended', {
      sessionId: this.sessionId,
      quizId: this.quiz.id,
      durationSeconds: this.durationSeconds,
    });

    this.emit('quizEnded');
  }

  // ─── Answer Processing ──────────────────────────────────────────────
  submitAnswer(userId: string, submission: AnswerSubmission): ScoreResult {
    if (this._state !== State.ACTIVE) {
      throw new AppError(ErrorCode.QUIZ_ALREADY_FINISHED, `Cannot submit answer: quiz '${this.quiz.id}' is in ${this._state} state`);
    }

    const participant = this.participants.get(userId);
    if (!participant) {
      throw new AppError(ErrorCode.USER_NOT_IN_QUIZ, `User '${userId}' is not in quiz session '${this.sessionId}'`);
    }

    const question = this.currentQuestion;
    if (!question || question.id !== submission.questionId) {
      throw new AppError(ErrorCode.INVALID_ANSWER, `Question '${submission.questionId}' is not the current question for quiz '${this.quiz.id}'`);
    }

    if (participant.answeredQuestions.has(question.id)) {
      throw new DuplicateAnswerError();
    }

    if (!this.scoringEngine.isValidOptionIndex(question, submission.selectedOptionIndex)) {
      throw new AppError(ErrorCode.INVALID_ANSWER, `Invalid option index ${submission.selectedOptionIndex} for question '${question.id}' (${question.options.length} options available)`);
    }

    const responseTimeMs = Date.now() - this.questionStartTime;

    const result = this.scoringEngine.calculateScore(
      question,
      submission.selectedOptionIndex,
      responseTimeMs,
      participant.streak,
      participant.totalScore,
    );

    participant.answeredQuestions.add(question.id);
    participant.totalScore = result.totalScore;
    participant.streak = result.currentStreak;

    logger.info('Answer submitted', {
      sessionId: this.sessionId,
      userId,
      questionId: question.id,
      correct: result.correct,
      pointsEarned: result.pointsEarned,
      totalScore: result.totalScore,
    });

    this.emit('scoreUpdated', userId, result);

    this.checkAllAnswered();

    return result;
  }

  /** If all connected participants answered, skip the timer and advance. */
  private checkAllAnswered(): void {
    const question = this.currentQuestion;
    if (!question) return;

    const connectedParticipants = Array.from(this.participants.values()).filter(
      (p) => p.isConnected,
    );

    const allAnswered = connectedParticipants.every((p) =>
      p.answeredQuestions.has(question.id),
    );

    if (allAnswered && connectedParticipants.length > 0) {
      logger.info('All participants answered — advancing', {
        sessionId: this.sessionId,
        questionId: question.id,
      });

      // Brief pause then advance
      if (this.questionTimer) {
        clearTimeout(this.questionTimer);
        this.questionTimer = null;
      }
      setTimeout(() => {
        this.advanceToNextQuestion();
      }, 2000);
    }
  }

  /** Build a client-safe payload — excludes correctOptionIndex to prevent cheating. */
  getCurrentQuestionPayload(): QuestionPayload | null {
    const question = this.currentQuestion;
    if (!question) return null;

    return {
      questionId: question.id,
      questionNumber: this.currentQuestionIndex + 1,
      totalQuestions: this.quiz.questions.length,
      word: question.word,
      prompt: question.prompt,
      options: question.options,
      timeLimitSeconds: question.timeLimitSeconds,
      difficulty: question.difficulty,
    };
  }


  destroy(): void {
    if (this.questionTimer) {
      clearTimeout(this.questionTimer);
      this.questionTimer = null;
    }
    this.removeAllListeners();

    logger.info('Quiz session destroyed', { sessionId: this.sessionId });
  }
}
