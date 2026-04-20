/**
 * QuizManager — Top-level manager for all quiz sessions.
 *
 * Responsibilities:
 *   - Create new quiz sessions from quiz templates
 *   - Look up active sessions by quiz ID
 *   - Clean up expired sessions
 *   - Provide session metrics
 */

import { config } from '../config';
import { getQuizById } from '../data/mockQuizzes';
import { AppError, ErrorCode } from '../utils/errors';
import { createLogger } from '../utils/logger';
import { QuizSession } from './QuizSession';

const logger = createLogger('QuizManager');

export class QuizManager {
  /** Active quiz sessions mapped by quiz ID */
  private sessions: Map<string, QuizSession> = new Map();
  /** Session cleanup interval */
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Periodically clean up finished or expired sessions
    this.cleanupInterval = setInterval(() => {
      this.cleanupSessions();
    }, 60000); // Every minute
  }

  /**
   * Create a new quiz session for the given quiz ID.
   * If a session already exists and is still live, return it.
   * New participants can join only while the session is WAITING.
   * Disconnected participants can reconnect while the session is ACTIVE.
   * If it's FINISHED, create a new one.
   */
  getOrCreateSession(quizId: string): QuizSession {
    const existingSession = this.sessions.get(quizId);

    if (existingSession && existingSession.state !== 'FINISHED') {
      logger.info('Returning existing session', {
        quizId,
        sessionId: existingSession.sessionId,
        state: existingSession.state,
      });
      return existingSession;
    }

    // Look up quiz data
    const quiz = getQuizById(quizId);
    if (!quiz) {
      throw new AppError(ErrorCode.QUIZ_NOT_FOUND, `Quiz '${quizId}' does not exist`);
    }

    const session = new QuizSession(quiz, config.maxParticipantsPerQuiz);

    this.sessions.set(quizId, session);

    logger.info('New quiz session created', {
      quizId,
      sessionId: session.sessionId,
      quizTitle: quiz.title,
    });

    return session;
  }

  /**
   * Get an active session by quiz ID.
   */
  getSession(quizId: string): QuizSession | undefined {
    return this.sessions.get(quizId);
  }

  /**
   * Remove finished sessions that have been inactive.
   */
  private cleanupSessions(): void {
    const _now = Date.now();
    let cleaned = 0;

    for (const [quizId, session] of this.sessions.entries()) {
      if (session.state === 'FINISHED') {
        session.destroy();
        this.sessions.delete(quizId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.info('Cleaned up sessions', { cleaned, remaining: this.sessions.size });
    }
  }

  /**
   * Get metrics about active sessions.
   */
  getMetrics(): { activeSessions: number; totalParticipants: number } {
    let totalParticipants = 0;
    for (const session of this.sessions.values()) {
      totalParticipants += session.participantCount;
    }

    return {
      activeSessions: this.sessions.size,
      totalParticipants,
    };
  }

  /**
   * Clean up all sessions and stop the cleanup interval.
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    for (const session of this.sessions.values()) {
      session.destroy();
    }
    this.sessions.clear();

    logger.info('QuizManager destroyed');
  }
}
