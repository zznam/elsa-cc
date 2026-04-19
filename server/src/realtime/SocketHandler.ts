/**
 * SocketHandler — Socket.IO event handlers for real-time quiz interaction.
 *
 * This is the main entry point for all WebSocket communication.
 * It coordinates between QuizManager, LeaderboardService, and RoomManager
 * to handle the full real-time quiz flow.
 */

import type { Server, Socket } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from './events';
import type { ILeaderboardStore } from '../leaderboard/LeaderboardService';
import { QuizManager } from '../quiz/QuizManager';
import { RoomManager } from './RoomManager';
import { createLogger } from '../utils/logger';
import { AppError } from '../utils/errors';
import { config } from '../config';
import { listQuizzes } from '../data/mockQuizzes';

const logger = createLogger('SocketHandler');

type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents>;
type TypedServer = Server<ClientToServerEvents, ServerToClientEvents>;

/** Rate limiter: track last answer time per user */
const answerTimestamps: Map<string, number> = new Map();

export class SocketHandler {
  private io: TypedServer;
  private quizManager: QuizManager;
  private leaderboard: ILeaderboardStore;
  private roomManager: RoomManager;

  /** Throttle leaderboard broadcasts per quiz */
  private leaderboardBroadcastTimers: Map<string, NodeJS.Timeout> = new Map();
  private pendingLeaderboardUpdates: Set<string> = new Set();

  constructor(
    io: TypedServer,
    quizManager: QuizManager,
    leaderboard: ILeaderboardStore,
    roomManager: RoomManager,
  ) {
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
      this.handleJoinQuiz(socket, data, callback);
    });

    socket.on('submit_answer', (data, callback) => {
      this.handleSubmitAnswer(socket, data, callback);
    });

    socket.on('start_quiz', (data, callback) => {
      this.handleStartQuiz(socket, data, callback);
    });

    socket.on('get_leaderboard', (data, callback) => {
      this.handleGetLeaderboard(socket, data, callback);
    });
  }

  // ─── Event Handlers ──────────────────────────────────────────────────────

  private handleJoinQuiz(
    socket: TypedSocket,
    data: { quizId: string; username: string },
    callback: (response: any) => void,
  ): void {
    try {
      const { quizId, username } = data;

      if (!quizId || !username || username.trim().length === 0) {
        callback({ success: false, error: 'Quiz ID and username are required' });
        return;
      }

      if (username.trim().length > 20) {
        callback({ success: false, error: 'Username must be 20 characters or less' });
        return;
      }

      const session = this.quizManager.getOrCreateSession(quizId);
      const participant = session.addParticipant(username.trim());

      // Join the Socket.IO room
      this.roomManager.joinRoom(socket, quizId, participant.userId, participant.username);

      // Wire up session events for this quiz (idempotent — only on first participant)
      this.wireSessionEvents(quizId, session);

      // Notify other participants
      socket.to(quizId).emit('participant_joined', {
        userId: participant.userId,
        username: participant.username,
        participantCount: session.participantCount,
      });

      // Get participant list for the response
      const participants = session.getParticipants().map((p) => ({
        userId: p.userId,
        username: p.username,
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
        quizTitle: session.quiz.title,
        participants,
        state: session.state,
        currentQuestion: session.getCurrentQuestionPayload(),
      });
    } catch (err) {
      const error = err instanceof AppError ? err : new AppError('INTERNAL_ERROR' as any, 'Internal server error');
      logger.error('Join quiz failed', { error: error.message, quizId: data.quizId });
      callback({ success: false, error: error.message, errorCode: error.code });
    }
  }

  private handleSubmitAnswer(
    socket: TypedSocket,
    data: { quizId: string; questionId: string; selectedOptionIndex: number; clientTimestamp: number },
    callback: (response: any) => void,
  ): void {
    try {
      const connection = this.roomManager.getConnection(socket.id);
      if (!connection) {
        callback({ success: false, error: 'Not connected to a quiz' });
        return;
      }

      // Rate limiting
      const now = Date.now();
      const lastAnswer = answerTimestamps.get(connection.userId);
      const minInterval = 1000 / config.maxAnswersPerSecond;
      if (lastAnswer && now - lastAnswer < minInterval) {
        callback({ success: false, error: 'Too fast! Please wait before submitting again.', errorCode: 'RATE_LIMITED' });
        return;
      }
      answerTimestamps.set(connection.userId, now);

      const session = this.quizManager.getSession(data.quizId);
      if (!session) {
        callback({ success: false, error: 'Quiz session not found' });
        return;
      }

      const result = session.submitAnswer(connection.userId, {
        quizId: data.quizId,
        questionId: data.questionId,
        selectedOptionIndex: data.selectedOptionIndex,
        clientTimestamp: data.clientTimestamp,
      });

      // Update leaderboard
      if (result.pointsEarned > 0) {
        this.leaderboard
          .updateScore(data.quizId, connection.userId, connection.username, result.pointsEarned)
          .then(() => {
            this.scheduleLeaderboardBroadcast(data.quizId);
          })
          .catch((err) => {
            logger.error('Failed to update leaderboard', { error: (err as Error).message });
          });
      }

      callback({ success: true, result });
    } catch (err) {
      const error = err instanceof AppError ? err : new AppError('INTERNAL_ERROR' as any, 'Internal server error');
      logger.error('Submit answer failed', { error: error.message });
      callback({ success: false, error: error.message, errorCode: error.code });
    }
  }

  private handleStartQuiz(
    socket: TypedSocket,
    data: { quizId: string },
    callback: (response: any) => void,
  ): void {
    try {
      const session = this.quizManager.getSession(data.quizId);
      if (!session) {
        callback({ success: false, error: 'Quiz session not found' });
        return;
      }

      session.start();
      callback({ success: true });
    } catch (err) {
      const error = err instanceof AppError ? err : new AppError('INTERNAL_ERROR' as any, 'Internal server error');
      logger.error('Start quiz failed', { error: error.message });
      callback({ success: false, error: error.message, errorCode: error.code });
    }
  }

  private handleGetLeaderboard(
    socket: TypedSocket,
    data: { quizId: string },
    callback: (response: any) => void,
  ): void {
    this.leaderboard
      .getLeaderboard(data.quizId)
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

  private wireSessionEvents(quizId: string, session: any): void {
    if (this.wiredSessions.has(quizId)) return;
    this.wiredSessions.add(quizId);

    session.on('quizStarted', () => {
      this.io.to(quizId).emit('quiz_started', {
        quizId,
        totalQuestions: session.totalQuestions,
      });
    });

    session.on('questionStarted', (payload: any) => {
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

  // ─── Leaderboard Broadcasting ─────────────────────────────────────────────

  /**
   * Throttled leaderboard broadcast to avoid flooding clients.
   * Broadcasts at most once per configured interval.
   */
  private scheduleLeaderboardBroadcast(quizId: string): void {
    this.pendingLeaderboardUpdates.add(quizId);

    if (this.leaderboardBroadcastTimers.has(quizId)) {
      return; // Already scheduled
    }

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
