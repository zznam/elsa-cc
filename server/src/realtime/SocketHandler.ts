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
import { METRIC, metrics } from '../monitoring/metrics';
import type { QuizManager } from '../quiz/QuizManager';
import type { QuizSession } from '../quiz/QuizSession';
import type { AnswerSubmission, Leaderboard, Participant, QuestionPayload } from '../quiz/types';
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
      metrics.increment(METRIC.CONNECTIONS_TOTAL);

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
    const started = Date.now();
    try {
      const validated = joinQuizSchema.parse(data);
      const { quizId, username, userId } = validated;

      const session = this.quizManager.getOrCreateSession(quizId);
      const { participant, isReconnect } = this.joinOrReconnectParticipant(session, username, userId);

      this.roomManager.joinRoom(socket, quizId, participant.userId, participant.username);

      // Only wire session events once per session
      this.wireSessionEvents(quizId, session);

      await this.ensureLeaderboardEntry(quizId, participant);

      const joinEvent = isReconnect ? 'participant_reconnected' : 'participant_joined';
      socket.to(quizId).emit(joinEvent, {
        userId: participant.userId,
        username: participant.username,
        participantCount: session.participantCount,
      });

      metrics.increment(METRIC.JOINS_TOTAL, 1, { kind: isReconnect ? 'reconnect' : 'new' });

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
        isReconnect,
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
    } finally {
      metrics.recordHistogram(METRIC.JOIN_LATENCY_MS, Date.now() - started);
    }
  }

  private async handleSubmitAnswer(
    socket: TypedSocket,
    data: AnswerSubmission,
    callback: (response: SubmitAnswerResponse) => void,
  ): Promise<void> {
    const started = Date.now();
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

      metrics.increment(METRIC.ANSWERS_SUBMITTED);
      if (result.correct) metrics.increment(METRIC.CORRECT_ANSWERS);

      if (result.pointsEarned > 0) {
        try {
          await this.leaderboard.updateScore(
            validated.quizId,
            connection.userId,
            connection.username,
            result.pointsEarned,
          );
        } catch (err) {
          // Surface runtime Redis (or store) failure without rolling back the
          // in-memory participant score — that's already been applied. We log,
          // emit an error metric, and still return success so the participant
          // sees their points; a later broadcast will reconcile.
          metrics.increment(METRIC.REDIS_ERRORS, 1, { op: 'updateScore' });
          logger.error('Leaderboard updateScore failed', { error: (err as Error).message });
        }
      }

      this.scheduleLeaderboardBroadcast(validated.quizId);
      callback({ success: true, result });
    } catch (err) {
      const error = this.toAppError(err);
      logger.error('Submit answer failed', { error: error.message });
      callback({ success: false, error: error.message, errorCode: error.code });
    } finally {
      metrics.recordHistogram(METRIC.ANSWER_LATENCY_MS, Date.now() - started);
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

    metrics.increment(METRIC.QUIZZES_CREATED);

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
      metrics.increment(METRIC.QUIZZES_COMPLETED);
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

  private joinOrReconnectParticipant(
    session: QuizSession,
    username: string,
    userId?: string,
  ): { participant: Participant; isReconnect: boolean } {
    if (!userId) {
      return { participant: session.addParticipant(username), isReconnect: false };
    }

    const participant = session.reconnectParticipant(userId);
    if (!participant) {
      throw new AppError(ErrorCode.USER_NOT_IN_QUIZ, 'Previous participant was not found for this quiz');
    }

    if (participant.username !== username) {
      throw new AppError(ErrorCode.USER_NOT_IN_QUIZ, 'Previous participant does not match this username');
    }

    return { participant, isReconnect: true };
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

  /**
   * Throttled broadcast — at most once per configured interval.
   *
   * Each socket in the room receives the top-N leaderboard plus, when they are
   * ranked below the cutoff, their own rank in `selfRank`. This keeps payloads
   * small for hundreds of participants while still giving every user visible
   * progress feedback.
   */
  private scheduleLeaderboardBroadcast(quizId: string): void {
    this.pendingLeaderboardUpdates.add(quizId);
    if (this.leaderboardBroadcastTimers.has(quizId)) return;

    const timer = setTimeout(async () => {
      const started = Date.now();
      this.leaderboardBroadcastTimers.delete(quizId);
      this.pendingLeaderboardUpdates.delete(quizId);

      try {
        const leaderboard = await this.leaderboard.getLeaderboard(quizId, 20);
        await this.emitLeaderboardToRoom(quizId, leaderboard);
      } catch (err) {
        metrics.increment(METRIC.REDIS_ERRORS, 1, { op: 'getLeaderboard' });
        logger.error('Failed to broadcast leaderboard', { error: (err as Error).message });
      } finally {
        metrics.recordHistogram(METRIC.LEADERBOARD_BROADCAST_MS, Date.now() - started);
      }
    }, config.leaderboardBroadcastIntervalMs);

    this.leaderboardBroadcastTimers.set(quizId, timer);
  }

  /**
   * Send per-socket leaderboard updates so users outside the top-N still see
   * their own rank. Top-N entries are identical across sockets; only the
   * `selfRank` attachment differs.
   */
  private async emitLeaderboardToRoom(quizId: string, top: Leaderboard): Promise<void> {
    const topIds = new Set(top.entries.map((e) => e.userId));
    const room = this.roomManager.getConnectionsForQuiz(quizId);

    await Promise.all(
      room.map(async (conn) => {
        let selfRank;
        if (!topIds.has(conn.userId)) {
          try {
            selfRank = (await this.leaderboard.getUserRank(quizId, conn.userId)) || undefined;
          } catch (err) {
            metrics.increment(METRIC.REDIS_ERRORS, 1, { op: 'getUserRank' });
            logger.debug('getUserRank failed — omitting selfRank', { error: (err as Error).message });
          }
        }

        this.io.to(conn.socketId).emit('leaderboard_update', { ...top, selfRank });
      }),
    );
  }

  // ─── Disconnect Handling ──────────────────────────────────────────────────

  private handleDisconnect(socket: TypedSocket): void {
    metrics.increment(METRIC.DISCONNECTIONS_TOTAL);

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
