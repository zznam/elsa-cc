/**
 * Domain types for the quiz system.
 * Defines the core data structures used across the application.
 */

/** Represents a single quiz question */
export interface Question {
  id: string;
  /** The vocabulary word or phrase being tested */
  word: string;
  /** The question prompt shown to the user */
  prompt: string;
  /** Available answer options */
  options: string[];
  /** Index of the correct answer in the options array (0-based) */
  correctOptionIndex: number;
  /** Time limit for this question in seconds */
  timeLimitSeconds: number;
  /** Difficulty level affects scoring */
  difficulty: 'easy' | 'medium' | 'hard';
}

/** Represents a quiz template (the question set) */
export interface Quiz {
  id: string;
  title: string;
  description: string;
  questions: Question[];
}

/** Quiz session states — follows a strict state machine */
export enum QuizSessionState {
  /** Waiting for participants to join */
  WAITING = 'WAITING',
  /** Quiz is in progress — questions are being shown */
  ACTIVE = 'ACTIVE',
  /** Quiz has ended — final results available */
  FINISHED = 'FINISHED',
}

/** Represents a participant in a quiz session */
export interface Participant {
  userId: string;
  username: string;
  joinedAt: number;
  /** Track which questions this user has answered */
  answeredQuestions: Set<string>;
  /** Current total score */
  totalScore: number;
  /** Current answer streak */
  streak: number;
  /** Whether the user is currently connected */
  isConnected: boolean;
}

/** Result of scoring an answer */
export interface ScoreResult {
  correct: boolean;
  /** Points earned for this answer (0 if incorrect) */
  pointsEarned: number;
  /** Base points before bonuses */
  basePoints: number;
  /** Time bonus points */
  timeBonus: number;
  /** Streak bonus points */
  streakBonus: number;
  /** Current streak count */
  currentStreak: number;
  /** User's new total score */
  totalScore: number;
  /** The correct answer for feedback */
  correctOptionIndex: number;
}

/** Leaderboard entry for a single participant */
export interface LeaderboardEntry {
  userId: string;
  username: string;
  score: number;
  rank: number;
}

/** Full leaderboard state */
export interface Leaderboard {
  quizId: string;
  entries: LeaderboardEntry[];
  updatedAt: number;
}

/** Data sent when a question starts */
export interface QuestionPayload {
  questionId: string;
  questionNumber: number;
  totalQuestions: number;
  word: string;
  prompt: string;
  options: string[];
  timeLimitSeconds: number;
  difficulty: string;
}

/** Data sent with an answer submission */
export interface AnswerSubmission {
  quizId: string;
  questionId: string;
  selectedOptionIndex: number;
  /** Client-side timestamp for latency measurement */
  clientTimestamp: number;
}
