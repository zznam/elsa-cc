/**
 * Custom error types for the quiz application.
 * Provides structured error handling with error codes for client communication.
 */

export enum ErrorCode {
  QUIZ_NOT_FOUND = 'QUIZ_NOT_FOUND',
  QUIZ_ALREADY_STARTED = 'QUIZ_ALREADY_STARTED',
  QUIZ_ALREADY_FINISHED = 'QUIZ_ALREADY_FINISHED',
  QUIZ_FULL = 'QUIZ_FULL',
  USER_ALREADY_JOINED = 'USER_ALREADY_JOINED',
  USER_NOT_IN_QUIZ = 'USER_NOT_IN_QUIZ',
  INVALID_ANSWER = 'INVALID_ANSWER',
  DUPLICATE_ANSWER = 'DUPLICATE_ANSWER',
  QUESTION_TIMEOUT = 'QUESTION_TIMEOUT',
  RATE_LIMITED = 'RATE_LIMITED',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;
  public readonly isOperational: boolean;

  constructor(code: ErrorCode, message: string, statusCode: number = 400, isOperational: boolean = true) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

export class QuizNotFoundError extends AppError {
  constructor(quizId: string) {
    super(ErrorCode.QUIZ_NOT_FOUND, `Quiz session '${quizId}' not found`, 404);
  }
}

export class QuizFullError extends AppError {
  constructor(quizId: string) {
    super(ErrorCode.QUIZ_FULL, `Quiz session '${quizId}' is full`, 403);
  }
}

export class DuplicateAnswerError extends AppError {
  constructor() {
    super(ErrorCode.DUPLICATE_ANSWER, 'You have already answered this question');
  }
}

export class RateLimitedError extends AppError {
  constructor() {
    super(ErrorCode.RATE_LIMITED, 'Too many requests. Please slow down.', 429);
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(ErrorCode.VALIDATION_ERROR, message, 400);
  }
}
