/**
 * Server Entry Point — Real-Time Vocabulary Quiz Server
 *
 * Sets up Express HTTP server with Socket.IO WebSocket support.
 * Serves the demo client as static files and provides health/metrics endpoints.
 * Handles graceful shutdown.
 */

import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';

import { config } from './config';
import { createLogger } from './utils/logger';
import { QuizManager } from './quiz/QuizManager';
import { InMemoryLeaderboard } from './leaderboard/InMemoryLeaderboard';
import { RedisLeaderboard } from './leaderboard/RedisLeaderboard';
import type { ILeaderboardStore } from './leaderboard/LeaderboardService';
import { RoomManager } from './realtime/RoomManager';
import { SocketHandler } from './realtime/SocketHandler';
import { createHealthCheck } from './monitoring/healthcheck';
import { metrics } from './monitoring/metrics';
import { listQuizzes } from './data/mockQuizzes';

const logger = createLogger('Server');

async function main(): Promise<void> {
  // ─── Express Setup ─────────────────────────────────────────────────────
  const app = express();
  const httpServer = createServer(app);

  const clientPath = path.join(__dirname, '../../client');
  app.use(express.static(clientPath));

  // ─── Leaderboard Store ─────────────────────────────────────────────────
  let leaderboard: ILeaderboardStore;

  if (config.redisUrl) {
    logger.info('Connecting to Redis', { url: config.redisUrl });
    const redisLeaderboard = new RedisLeaderboard(config.redisUrl);
    try {
      await redisLeaderboard.connect();
      leaderboard = redisLeaderboard;
      logger.info('Using Redis leaderboard');
    } catch (err) {
      logger.warn('Redis connection failed — falling back to in-memory', {
        error: (err as Error).message,
      });
      leaderboard = new InMemoryLeaderboard();
    }
  } else {
    logger.info('No REDIS_URL configured — using in-memory leaderboard');
    leaderboard = new InMemoryLeaderboard();
  }

  // ─── Core Services ─────────────────────────────────────────────────────
  const quizManager = new QuizManager();
  const roomManager = new RoomManager();

  // ─── Socket.IO Setup ──────────────────────────────────────────────────
  const io = new Server(httpServer, {
    cors: {
      origin: config.corsOrigin,
      methods: ['GET', 'POST'],
    },
    pingInterval: 25000,
    pingTimeout: 60000,
    // Prefer WebSocket but fall back to polling for restrictive networks
    transports: ['websocket', 'polling'],
  });

  const socketHandler = new SocketHandler(io, quizManager, leaderboard, roomManager);
  socketHandler.setup();

  // ─── HTTP Routes ──────────────────────────────────────────────────────
  app.get('/health', createHealthCheck(quizManager, roomManager));

  app.get('/metrics', (_req, res) => {
    res.json(metrics.getAll());
  });

  app.get('/api/quizzes', (_req, res) => {
    res.json(listQuizzes());
  });

  // ─── Start Server ─────────────────────────────────────────────────────
  httpServer.listen(config.port, () => {
    logger.info(`🚀 Quiz server running on http://localhost:${config.port}`, {
      port: config.port,
      leaderboardType: config.redisUrl ? 'redis' : 'in-memory',
    });
    logger.info(`📋 Available quizzes: ${listQuizzes().map((q) => q.id).join(', ')}`);
    logger.info(`🏥 Health check: http://localhost:${config.port}/health`);
  });

  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal} — shutting down gracefully`);

    io.close();

    quizManager.destroy();

    if (leaderboard instanceof RedisLeaderboard) {
      await (leaderboard as RedisLeaderboard).disconnect();
    }

    httpServer.close(() => {
      logger.info('Server shut down successfully');
      process.exit(0);
    });

    // Prevent hanging if close callbacks stall
    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.error('Fatal error during startup', { error: err.message, stack: err.stack });
  process.exit(1);
});
