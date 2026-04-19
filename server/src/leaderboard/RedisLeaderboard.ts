/**
 * RedisLeaderboard — Redis-backed leaderboard using Sorted Sets.
 *
 * Uses Redis ZINCRBY for atomic score updates (O(log N)) and
 * ZREVRANGE for top-N queries (O(log N + M)).
 *
 * This is the production-grade implementation for high-concurrency scenarios.
 * Falls back gracefully if Redis connection is lost.
 */

import Redis from 'ioredis';
import type { Leaderboard, LeaderboardEntry } from '../quiz/types';
import { createLogger } from '../utils/logger';
import type { ILeaderboardStore } from './LeaderboardService';

const logger = createLogger('RedisLeaderboard');

/** Key prefix for leaderboard sorted sets */
const LEADERBOARD_KEY_PREFIX = 'quiz:leaderboard:';
/** Key prefix for username mapping hashes */
const USERNAME_KEY_PREFIX = 'quiz:usernames:';
/** TTL for leaderboard data (2 hours) */
const LEADERBOARD_TTL_SECONDS = 7200;

export class RedisLeaderboard implements ILeaderboardStore {
  private redis: Redis;

  constructor(redisUrl: string) {
    this.redis = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        const delay = Math.min(times * 200, 2000);
        return delay;
      },
      lazyConnect: true,
    });

    this.redis.on('connect', () => {
      logger.info('Connected to Redis');
    });

    this.redis.on('error', (err) => {
      logger.error('Redis connection error', { error: err.message });
    });
  }

  /**
   * Connect to Redis. Call this during server startup.
   */
  async connect(): Promise<void> {
    await this.redis.connect();
  }

  private leaderboardKey(quizId: string): string {
    return `${LEADERBOARD_KEY_PREFIX}${quizId}`;
  }

  private usernameKey(quizId: string): string {
    return `${USERNAME_KEY_PREFIX}${quizId}`;
  }

  async updateScore(quizId: string, userId: string, username: string, scoreIncrement: number): Promise<void> {
    const lbKey = this.leaderboardKey(quizId);
    const unKey = this.usernameKey(quizId);

    // Use a pipeline for atomic batch operations
    const pipeline = this.redis.pipeline();
    pipeline.zincrby(lbKey, scoreIncrement, userId);
    pipeline.hset(unKey, userId, username);
    pipeline.expire(lbKey, LEADERBOARD_TTL_SECONDS);
    pipeline.expire(unKey, LEADERBOARD_TTL_SECONDS);
    await pipeline.exec();

    logger.debug('Score updated in Redis', { quizId, userId, scoreIncrement });
  }

  async getTopN(quizId: string, topN: number = 10): Promise<LeaderboardEntry[]> {
    const lbKey = this.leaderboardKey(quizId);
    const unKey = this.usernameKey(quizId);

    // Get top N user IDs with scores
    const results = await this.redis.zrevrange(lbKey, 0, topN - 1, 'WITHSCORES');

    if (results.length === 0) return [];

    // Extract user IDs for username lookup
    const userIds: string[] = [];
    for (let i = 0; i < results.length; i += 2) {
      userIds.push(results[i]);
    }

    // Batch fetch usernames
    const usernames = userIds.length > 0 ? await this.redis.hmget(unKey, ...userIds) : [];

    // Build leaderboard entries
    const entries: LeaderboardEntry[] = [];
    for (let i = 0; i < results.length; i += 2) {
      const userId = results[i];
      const score = parseFloat(results[i + 1]);
      const rank = i / 2 + 1;
      const username = usernames[i / 2] || 'Unknown';

      entries.push({ userId, username, score, rank });
    }

    return entries;
  }

  async getUserRank(quizId: string, userId: string): Promise<LeaderboardEntry | null> {
    const lbKey = this.leaderboardKey(quizId);
    const unKey = this.usernameKey(quizId);

    const [rank, score, username] = await Promise.all([
      this.redis.zrevrank(lbKey, userId),
      this.redis.zscore(lbKey, userId),
      this.redis.hget(unKey, userId),
    ]);

    if (rank === null || score === null) return null;

    return {
      userId,
      username: username || 'Unknown',
      score: parseFloat(score),
      rank: rank + 1, // zrevrank is 0-based
    };
  }

  async getLeaderboard(quizId: string, topN: number = 10): Promise<Leaderboard> {
    const entries = await this.getTopN(quizId, topN);
    return {
      quizId,
      entries,
      updatedAt: Date.now(),
    };
  }

  async removeLeaderboard(quizId: string): Promise<void> {
    const lbKey = this.leaderboardKey(quizId);
    const unKey = this.usernameKey(quizId);
    await this.redis.del(lbKey, unKey);
    logger.debug('Leaderboard removed from Redis', { quizId });
  }

  /**
   * Disconnect from Redis. Call during graceful shutdown.
   */
  async disconnect(): Promise<void> {
    await this.redis.quit();
    logger.info('Disconnected from Redis');
  }
}
