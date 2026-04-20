/**
 * SocketHandler — Socket.IO event handlers for real-time quiz interaction.
 *
 * This is the main entry point for all WebSocket communication.
 * It coordinates between QuizManager, LeaderboardService, and RoomManager
 * to handle the full real-time quiz flow.
 */

import type { Server, Socket } from 'socket.io';
import { ZodError } from 'zod';
import { config } from '../config';
import type { ILeaderboardStore } from '../leaderboard/LeaderboardService';
import { RateLimiter } from '../middleware/rateLimiter';
import { getLeaderboardSchema, joinQuizSchema, startQuizSchema, submitAnswerSchema } from '../middleware/validation';
import type { QuizManager } from '../quiz/QuizManager';
import type { QuizSession } from '../quiz/QuizSession';
import type { AnswerSubmission, Participant, QuestionPayload } from '../quiz/types';
import { AppError, ErrorCode } from '../utils/errors';
import { createLogger } from '../utils/logger';
import type {
  ClientToServerEvents,
  GenericResponse,
  JoinQuizPayload,
  JoinQuizResponse,
  LeaderboardResponse,
  ServerToClientEvents,
  SubmitAnswerResponse,
} from './events';
import type { RoomManager } from './RoomManager';

const logger = createLogger('SocketHandler');

type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents>;
type TypedServer = Server<ClientToServerEvents, ServerToClientEvents>;

/** Per-user rate limiter for answer submissions */
const answerRateLimiter = new RateLimiter(config.maxAnswersPerSecond, 1000);

export class SocketHandler {
  private io: TypedServer;
  private quizManager: QuizManager;
  private leaderboard: ILeaderboardStore;
  private roomManager: RoomManager;

  /** Throttle leaderboard broadcasts per quiz */
  private leaderboardBroadcastTimers: Map<string, NodeJS.Timeout> = new Map();
  private pendingLeaderboardUpdates: Set<string> = new Set();

  constructor(io: TypedServer, quizManager: QuizManager, leaderboard: ILeaderboardStore, roomManager: RoomManager) {
    this.io = io;
    this.quizManager = quizManager;
    this.leaderboard = leaderboard;
    this.roomManager = roomManager;
  }

  /**
   * Initialize Socket.IO event handling.
   */
  setup(): void {
    this.io.on('connection', (socket: TypedSocket) => {
      logger.info('Client connected', { socketId: socket.id });

      this.registerHandlers(socket);

      socket.on('disconnect', () => {
        this.handleDisconnect(socket);
      });
    });

    logger.info('Socket handler initialized');
  }

  private registerHandlers(socket: TypedSocket): void {
    socket.on('join_quiz', (data, callback) => {
      void this.handleJoinQuiz(socket, data, callback);
    });

    socket.on('submit_answer', (data, callback) => {
      void this.handleSubmitAnswer(socket, data, callback);
    });

    socket.on('start_quiz', (data, callback) => {
      this.handleStartQuiz(socket, data, callback);
    });

    socket.on('get_leaderboard', (data, callback) => {
      this.handleGetLeaderboard(socket, data, callback);
    });
  }

  // ─── Event Handlers ──────────────────────────────────────────────────────

  private async handleJoinQuiz(
    socket: TypedSocket,
    data: JoinQuizPayload,
    callback: (response: JoinQuizResponse) => void,
  ): Promise<void> {
    try {
      const validated = joinQuizSchema.parse(data);
      const { quizId, username, userId } = validated;

      const session = this.quizManager.getOrCreateSession(quizId);
      const participant = this.joinOrReconnectParticipant(session, username, userId);

      this.roomManager.joinRoom(socket, quizId, participant.userId, participant.username);

      // Only wire session events once per session
      this.wireSessionEvents(quizId, session);

      await this.ensureLeaderboardEntry(quizId, participant);

      socket.to(quizId).emit('participant_joined', {
        userId: participant.userId,
        username: participant.username,
        participantCount: session.participantCount,
      });

      const participants = session.getParticipants().map((p) => ({
        userId: p.userId,
        username: p.username,
        isHost: p.isHost,
      }));

      logger.info('User joined quiz', {
        socketId: socket.id,
        userId: participant.userId,
        username: participant.username,
        quizId,
        participantCount: session.participantCount,
      });

      callback({
        success: true,
        userId: participant.userId,
        isHost: participant.isHost,
        quizTitle: session.quiz.title,
        participants,
        state: session.state,
        currentQuestion: session.getCurrentQuestionPayload(),
      });
    } catch (err) {
      const error = this.toAppError(err);
      logger.error('Join quiz failed', { error: error.message, quizId: this.getQuizIdForLog(data) });
      callback({ success: false, error: error.message, errorCode: error.code });
    }
  }

  private async handleSubmitAnswer(
    socket: TypedSocket,
    data: AnswerSubmission,
    callback: (response: SubmitAnswerResponse) => void,
  ): Promise<void> {
    try {
      const validated = submitAnswerSchema.parse(data);

      const connection = this.roomManager.getConnection(socket.id);
      if (!connection) {
        callback({ success: false, error: 'Not connected to a quiz' });
        return;
      }

      if (connection.quizId !== validated.quizId) {
        callback({ success: false, error: 'Socket is not joined to this quiz', errorCode: ErrorCode.USER_NOT_IN_QUIZ });
        return;
      }

      if (!answerRateLimiter.isAllowed(connection.userId)) {
        callback({
          success: false,
          error: 'Too fast! Please wait before submitting again.',
          errorCode: 'RATE_LIMITED',
        });
        return;
      }

      const session = this.quizManager.getSession(validated.quizId);
      if (!session) {
        callback({ success: false, error: 'Quiz session not found' });
        return;
      }

      const result = session.submitAnswer(connection.userId, {
        quizId: validated.quizId,
        questionId: validated.questionId,
        selectedOptionIndex: validated.selectedOptionIndex,
        clientTimestamp: validated.clientTimestamp,
      });

      if (result.pointsEarned > 0) {
        await this.leaderboard.updateScore(
          validated.quizId,
          connection.userId,
          connection.username,
          result.pointsEarned,
        );
      }

      this.scheduleLeaderboardBroadcast(validated.quizId);
      callback({ success: true, result });
    } catch (err) {
      const error = this.toAppError(err);
      logger.error('Submit answer failed', { error: error.message });
      callback({ success: false, error: error.message, errorCode: error.code });
    }
  }

  private handleStartQuiz(
    socket: TypedSocket,
    data: { quizId: string },
    callback: (response: GenericResponse) => void,
  ): void {
    try {
      const validated = startQuizSchema.parse(data);

      const session = this.quizManager.getSession(validated.quizId);
      if (!session) {
        callback({ success: false, error: 'Quiz session not found' });
        return;
      }

      const connection = this.roomManager.getConnection(socket.id);
      if (!connection || connection.quizId !== validated.quizId) {
        callback({
          success: false,
          error: 'You must join this quiz before starting it',
          errorCode: ErrorCode.USER_NOT_IN_QUIZ,
        });
        return;
      }

      if (session.hostUserId !== connection.userId) {
        callback({
          success: false,
          error: 'Only the quiz host can start the quiz',
          errorCode: ErrorCode.USER_NOT_IN_QUIZ,
        });
        return;
      }

      session.start();
      callback({ success: true });
    } catch (err) {
      const error = this.toAppError(err);
      logger.error('Start quiz failed', { error: error.message });
      callback({ success: false, error: error.message, errorCode: error.code });
    }
  }

  private handleGetLeaderboard(
    _socket: TypedSocket,
    data: { quizId: string },
    callback: (response: LeaderboardResponse) => void,
  ): void {
    let quizId: string;
    try {
      quizId = getLeaderboardSchema.parse(data).quizId;
    } catch (err) {
      const error = this.toAppError(err);
      logger.warn('Get leaderboard validation failed', { error: error.message });
      callback({ success: false, error: error.message });
      return;
    }

    this.leaderboard
      .getLeaderboard(quizId)
      .then((leaderboard) => {
        callback({ success: true, leaderboard });
      })
      .catch((err) => {
        logger.error('Get leaderboard failed', { error: (err as Error).message });
        callback({ success: false, error: 'Failed to retrieve leaderboard' });
      });
  }

  // ─── Session Event Wiring ─────────────────────────────────────────────────

  /**
   * Wire quiz session events to Socket.IO broadcasts.
   * Uses a flag to ensure events are only wired once per session.
   */
  private wiredSessions: Set<string> = new Set();

  private wireSessionEvents(quizId: string, session: QuizSession): void {
    if (this.wiredSessions.has(quizId)) return;
    this.wiredSessions.add(quizId);

    session.on('quizStarted', () => {
      this.io.to(quizId).emit('quiz_started', {
        quizId,
        totalQuestions: session.totalQuestions,
      });
    });

    session.on('questionStarted', (payload: QuestionPayload) => {
      this.io.to(quizId).emit('question', payload);
    });

    session.on('questionTimeout', (questionId: string, correctOptionIndex: number) => {
      this.io.to(quizId).emit('question_timeout', { questionId, correctOptionIndex });
    });

    session.on('quizEnded', async () => {
      try {
        const leaderboard = await this.leaderboard.getLeaderboard(quizId, 50);
        this.io.to(quizId).emit('quiz_ended', {
          quizId,
          finalLeaderboard: leaderboard,
          durationSeconds: session.durationSeconds,
        });

        // Cleanup
        this.wiredSessions.delete(quizId);
        const timer = this.leaderboardBroadcastTimers.get(quizId);
        if (timer) {
          clearTimeout(timer);
          this.leaderboardBroadcastTimers.delete(quizId);
        }
        this.pendingLeaderboardUpdates.delete(quizId);
      } catch (err) {
        logger.error('Failed to send quiz ended event', { error: (err as Error).message });
      }
    });
  }

  private joinOrReconnectParticipant(session: QuizSession, username: string, userId?: string): Participant {
    if (!userId) {
      return session.addParticipant(username);
    }

    const participant = session.reconnectParticipant(userId);
    if (!participant) {
      throw new AppError(ErrorCode.USER_NOT_IN_QUIZ, 'Previous participant was not found for this quiz');
    }

    if (participant.username !== username) {
      throw new AppError(ErrorCode.USER_NOT_IN_QUIZ, 'Previous participant does not match this username');
    }

    return participant;
  }

  private async ensureLeaderboardEntry(quizId: string, participant: Participant): Promise<void> {
    await this.leaderboard.updateScore(quizId, participant.userId, participant.username, 0);
    this.scheduleLeaderboardBroadcast(quizId);
  }

  private toAppError(err: unknown): AppError {
    if (err instanceof AppError) return err;
    if (err instanceof ZodError) {
      return new AppError(ErrorCode.VALIDATION_ERROR, err.errors[0]?.message || 'Invalid payload');
    }
    return new AppError(ErrorCode.INTERNAL_ERROR, 'Internal server error');
  }

  private getQuizIdForLog(data: unknown): string | undefined {
    if (!data || typeof data !== 'object' || !('quizId' in data)) return undefined;
    const quizId = (data as { quizId?: unknown }).quizId;
    return typeof quizId === 'string' ? quizId : undefined;
  }

  /** Throttled broadcast — at most once per configured interval to avoid flooding clients. */
  private scheduleLeaderboardBroadcast(quizId: string): void {
    this.pendingLeaderboardUpdates.add(quizId);
    if (this.leaderboardBroadcastTimers.has(quizId)) return;

    const timer = setTimeout(async () => {
      this.leaderboardBroadcastTimers.delete(quizId);
      this.pendingLeaderboardUpdates.delete(quizId);

      try {
        const leaderboard = await this.leaderboard.getLeaderboard(quizId, 20);
        this.io.to(quizId).emit('leaderboard_update', leaderboard);
      } catch (err) {
        logger.error('Failed to broadcast leaderboard', { error: (err as Error).message });
      }
    }, config.leaderboardBroadcastIntervalMs);

    this.leaderboardBroadcastTimers.set(quizId, timer);
  }

  // ─── Disconnect Handling ──────────────────────────────────────────────────

  private handleDisconnect(socket: TypedSocket): void {
    const connection = this.roomManager.leaveRoom(socket.id);
    if (!connection) return;

    const session = this.quizManager.getSession(connection.quizId);
    if (session) {
      session.disconnectParticipant(connection.userId);

      // Notify remaining participants
      socket.to(connection.quizId).emit('participant_left', {
        userId: connection.userId,
        username: connection.username,
      });
    }

    logger.info('Client disconnected', {
      socketId: socket.id,
      userId: connection.userId,
      quizId: connection.quizId,
    });
  }
}
