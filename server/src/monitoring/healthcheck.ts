/**
 * Health check endpoint.
 * Returns server status and basic metrics.
 */

import type { Request, Response } from 'express';
import type { QuizManager } from '../quiz/QuizManager';
import type { RoomManager } from '../realtime/RoomManager';

export function createHealthCheck(quizManager: QuizManager, roomManager: RoomManager) {
  return (_req: Request, res: Response) => {
    const metrics = quizManager.getMetrics();

    res.json({
      status: 'healthy',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      metrics: {
        activeSessions: metrics.activeSessions,
        totalParticipants: metrics.totalParticipants,
        activeConnections: roomManager.getActiveConnectionCount(),
        memoryUsage: {
          rss: `${Math.round(process.memoryUsage().rss / 1024 / 1024)}MB`,
          heapUsed: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`,
        },
      },
    });
  };
}
