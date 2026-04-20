/**
 * Application configuration management.
 * Centralizes all configuration with sensible defaults for local development.
 */

export interface AppConfig {
  /** Server port */
  port: number;
  /** Redis connection URL (optional — falls back to in-memory if not set) */
  redisUrl: string | null;
  /** Log level */
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  /** CORS origin for Socket.IO */
  corsOrigin: string;
  /** Maximum participants per quiz session */
  maxParticipantsPerQuiz: number;
  /** Leaderboard broadcast throttle interval (ms) */
  leaderboardBroadcastIntervalMs: number;
  /** Quiz session timeout (ms) — auto-cleanup after inactivity */
  sessionTimeoutMs: number;
  /** Rate limit: max answer submissions per second per user */
  maxAnswersPerSecond: number;
  /** Enable Socket.IO Redis adapter for multi-node broadcasts (requires REDIS_URL) */
  useRedisAdapter: boolean;
}

export function loadConfig(): AppConfig {
  return {
    port: parseInt(process.env.PORT || '3000', 10),
    redisUrl: process.env.REDIS_URL || null,
    logLevel: (process.env.LOG_LEVEL as AppConfig['logLevel']) || 'info',
    corsOrigin: process.env.CORS_ORIGIN || '*',
    maxParticipantsPerQuiz: parseInt(process.env.MAX_PARTICIPANTS || '100', 10),
    leaderboardBroadcastIntervalMs: parseInt(process.env.LEADERBOARD_INTERVAL || '500', 10),
    sessionTimeoutMs: parseInt(process.env.SESSION_TIMEOUT || '3600000', 10), // 1 hour
    maxAnswersPerSecond: parseInt(process.env.MAX_ANSWERS_PER_SEC || '2', 10),
    useRedisAdapter: process.env.USE_REDIS_ADAPTER === '1' || process.env.USE_REDIS_ADAPTER === 'true',
  };
}

/** Singleton config instance */
export const config = loadConfig();
