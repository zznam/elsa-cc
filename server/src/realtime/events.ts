/**
 * Socket.IO event type definitions.
 * Defines the contract between client and server for real-time communication.
 */

import type { AnswerSubmission, Leaderboard, QuestionPayload, ScoreResult } from '../quiz/types';

// ─── Client → Server Events ──────────────────────────────────────────────────

export interface ClientToServerEvents {
  /** Join a quiz session */
  join_quiz: (data: JoinQuizPayload, callback: (response: JoinQuizResponse) => void) => void;

  /** Submit an answer to the current question */
  submit_answer: (data: AnswerSubmission, callback: (response: SubmitAnswerResponse) => void) => void;

  /** Host starts the quiz (only the quiz creator can do this) */
  start_quiz: (data: { quizId: string }, callback: (response: GenericResponse) => void) => void;

  /** Request current leaderboard */
  get_leaderboard: (data: { quizId: string }, callback: (response: LeaderboardResponse) => void) => void;
}

// ─── Server → Client Events ──────────────────────────────────────────────────

export interface ServerToClientEvents {
  /** A new participant joined the quiz */
  participant_joined: (data: ParticipantJoinedPayload) => void;

  /** A participant disconnected */
  participant_left: (data: { userId: string; username: string }) => void;

  /** Quiz has started */
  quiz_started: (data: { quizId: string; totalQuestions: number }) => void;

  /** New question is available */
  question: (data: QuestionPayload) => void;

  /** Leaderboard has been updated */
  leaderboard_update: (data: Leaderboard) => void;

  /** Quiz has ended — final results */
  quiz_ended: (data: QuizEndedPayload) => void;

  /** Server error notification */
  error: (data: ErrorPayload) => void;

  /** Question time expired */
  question_timeout: (data: { questionId: string; correctOptionIndex: number }) => void;
}

// ─── Payload Types ───────────────────────────────────────────────────────────

export interface JoinQuizPayload {
  quizId: string;
  username: string;
  /** Previous participant ID used to restore a disconnected participant */
  userId?: string;
}

export interface JoinQuizResponse {
  success: boolean;
  error?: string;
  errorCode?: string;
  userId?: string;
  isHost?: boolean;
  quizTitle?: string;
  participants?: Array<{ userId: string; username: string; isHost: boolean }>;
  state?: string;
  currentQuestion?: QuestionPayload | null;
}

export interface SubmitAnswerResponse {
  success: boolean;
  error?: string;
  errorCode?: string;
  result?: ScoreResult;
}

export interface GenericResponse {
  success: boolean;
  error?: string;
  errorCode?: string;
}

export interface LeaderboardResponse {
  success: boolean;
  error?: string;
  leaderboard?: Leaderboard;
}

export interface ParticipantJoinedPayload {
  userId: string;
  username: string;
  participantCount: number;
}

export interface QuizEndedPayload {
  quizId: string;
  finalLeaderboard: Leaderboard;
  /** Duration of the quiz in seconds */
  durationSeconds: number;
}

export interface ErrorPayload {
  code: string;
  message: string;
}
