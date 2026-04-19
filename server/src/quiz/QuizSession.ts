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

  // ─── Participant Management ───────────────────────────────────────────────

  /**
   * Add a participant to the quiz session.
   * @returns The created participant with assigned userId
   */
  addParticipant(username: string): Participant {
    if (this._state === State.FINISHED) {
      throw new AppError(ErrorCode.QUIZ_ALREADY_FINISHED, 'This quiz has already ended');
    }

    if (this.participants.size >= this.maxParticipants) {
      throw new AppError(ErrorCode.QUIZ_FULL, 'Quiz session is full');
    }

    // Check for duplicate username
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

  /**
   * Mark a participant as disconnected (don't remove — they might reconnect).
   */
  disconnectParticipant(userId: string): void {
    const participant = this.participants.get(userId);
    if (participant) {
      participant.isConnected = false;
      logger.info('Participant disconnected', { sessionId: this.sessionId, userId, username: participant.username });
      this.emit('participantLeft', userId, participant.username);
    }
  }

  /**
   * Reconnect a previously disconnected participant.
   */
  reconnectParticipant(userId: string): Participant | null {
    const participant = this.participants.get(userId);
    if (participant) {
      participant.isConnected = true;
      logger.info('Participant reconnected', { sessionId: this.sessionId, userId });
    }
    return participant || null;
  }

  /**
   * Get a participant by userId.
   */
  getParticipant(userId: string): Participant | undefined {
    return this.participants.get(userId);
  }

  /**
   * Get all participants as an array.
   */
  getParticipants(): Participant[] {
    return Array.from(this.participants.values());
  }

  // ─── Quiz Lifecycle ───────────────────────────────────────────────────────

  /**
   * Start the quiz — transitions from WAITING to ACTIVE.
   */
  start(): void {
    if (this._state !== State.WAITING) {
      throw new AppError(
        ErrorCode.QUIZ_ALREADY_STARTED,
        'Quiz has already started',
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

  /**
   * Advance to the next question or end the quiz.
   */
  private advanceToNextQuestion(): void {
    // Clear any existing timer
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

    // Set timer for question timeout
    this.questionTimer = setTimeout(() => {
      this.handleQuestionTimeout();
    }, question.timeLimitSeconds * 1000);
  }

  /**
   * Handle question timeout — emit event and advance.
   */
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

  /**
   * End the quiz — transitions from ACTIVE to FINISHED.
   */
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

  // ─── Answer Processing ────────────────────────────────────────────────────

  /**
   * Process an answer submission from a participant.
   * @returns ScoreResult with the scoring breakdown
   */
  submitAnswer(userId: string, submission: AnswerSubmission): ScoreResult {
    if (this._state !== State.ACTIVE) {
      throw new AppError(ErrorCode.QUIZ_ALREADY_FINISHED, 'Quiz is not active');
    }

    const participant = this.participants.get(userId);
    if (!participant) {
      throw new AppError(ErrorCode.USER_NOT_IN_QUIZ, 'User is not in this quiz session');
    }

    const question = this.currentQuestion;
    if (!question || question.id !== submission.questionId) {
      throw new AppError(ErrorCode.INVALID_ANSWER, 'Invalid question — the quiz may have moved on');
    }

    // Prevent duplicate answers
    if (participant.answeredQuestions.has(question.id)) {
      throw new DuplicateAnswerError();
    }

    // Validate option index
    if (!this.scoringEngine.isValidOptionIndex(question, submission.selectedOptionIndex)) {
      throw new AppError(ErrorCode.INVALID_ANSWER, 'Invalid answer option');
    }

    // Calculate response time
    const responseTimeMs = Date.now() - this.questionStartTime;

    // Calculate score
    const result = this.scoringEngine.calculateScore(
      question,
      submission.selectedOptionIndex,
      responseTimeMs,
      participant.streak,
      participant.totalScore,
    );

    // Update participant state
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

    // Check if all connected participants have answered
    this.checkAllAnswered();

    return result;
  }

  /**
   * If all connected participants have answered, advance immediately.
   */
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

  /**
   * Get current question as a client-safe payload (no correct answer).
   */
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

  /**
   * Clean up timers and resources.
   */
  destroy(): void {
    if (this.questionTimer) {
      clearTimeout(this.questionTimer);
      this.questionTimer = null;
    }
    this.removeAllListeners();

    logger.info('Quiz session destroyed', { sessionId: this.sessionId });
  }
}
