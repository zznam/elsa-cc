/**
 * Server Entry Point — Real-Time Vocabulary Quiz Server
 *
 * Sets up Express HTTP server with Socket.IO WebSocket support.
 * Serves the demo client as static files and provides health/metrics endpoints.
 * Handles graceful shutdown.
 */

import { createServer } from 'node:http';
import path from 'node:path';
import { createAdapter } from '@socket.io/redis-adapter';
import express from 'express';
import Redis from 'ioredis';
import { Server } from 'socket.io';
import { config } from './config';
import { listQuizzes } from './data/mockQuizzes';
import { InMemoryLeaderboard } from './leaderboard/InMemoryLeaderboard';
import type { ILeaderboardStore } from './leaderboard/LeaderboardService';
import { RedisLeaderboard } from './leaderboard/RedisLeaderboard';
import { createHealthCheck } from './monitoring/healthcheck';
import { metrics } from './monitoring/metrics';
import { QuizManager } from './quiz/QuizManager';
import { RoomManager } from './realtime/RoomManager';
import { SocketHandler } from './realtime/SocketHandler';
import { createLogger } from './utils/logger';

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

  // ─── Socket.IO Redis Adapter (multi-node broadcasts) ──────────────────
  // Opt-in via USE_REDIS_ADAPTER=1 and REDIS_URL. Single-node remains default.
  let adapterPub: Redis | null = null;
  let adapterSub: Redis | null = null;

  if (config.useRedisAdapter && config.redisUrl) {
    try {
      adapterPub = new Redis(config.redisUrl);
      adapterSub = adapterPub.duplicate();
      io.adapter(createAdapter(adapterPub, adapterSub));
      logger.info('Socket.IO Redis adapter enabled');
    } catch (err) {
      logger.warn('Failed to enable Socket.IO Redis adapter — continuing single-node', {
        error: (err as Error).message,
      });
      adapterPub?.disconnect();
      adapterSub?.disconnect();
      adapterPub = null;
      adapterSub = null;
    }
  }

  const socketHandler = new SocketHandler(io, quizManager, leaderboard, roomManager);
  socketHandler.setup();

  // ─── HTTP Routes ──────────────────────────────────────────────────────
  app.get('/health', createHealthCheck(quizManager, roomManager));

  app.get('/metrics', async (_req, res) => {
    // Refresh gauges that are cheap to compute on-demand.
    const quizMetrics = quizManager.getMetrics();
    metrics.setGauge('quiz_active_sessions', quizMetrics.activeSessions);
    metrics.setGauge('quiz_active_participants', quizMetrics.totalParticipants);
    metrics.setGauge('quiz_active_connections', roomManager.getActiveConnectionCount());

    try {
      res.setHeader('Content-Type', metrics.contentType());
      res.send(await metrics.render());
    } catch (err) {
      logger.error('Failed to render metrics', { error: (err as Error).message });
      res.status(500).send('metrics_render_failed');
    }
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
    logger.info(
      `📋 Available quizzes: ${listQuizzes()
        .map((q) => q.id)
        .join(', ')}`,
    );
    logger.info(`🏥 Health check: http://localhost:${config.port}/health`);
  });

  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal} — shutting down gracefully`);

    io.close();

    quizManager.destroy();

    if (leaderboard instanceof RedisLeaderboard) {
      await (leaderboard as RedisLeaderboard).disconnect();
    }

    if (adapterPub) await adapterPub.quit().catch(() => {});
    if (adapterSub) await adapterSub.quit().catch(() => {});

    httpServer.close(() => {
      logger.info('Server shut down successfully');
      process.exit(0);
    });

    // Prevent hanging if close callbacks stall; `.unref()` keeps the timer
    // from blocking the event loop if shutdown completes first.
    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.error('Fatal error during startup', { error: err.message, stack: err.stack });
  process.exit(1);
});
