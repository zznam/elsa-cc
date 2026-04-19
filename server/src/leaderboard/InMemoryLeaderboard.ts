/**
 * InMemoryLeaderboard — In-memory leaderboard implementation.
 *
 * Serves as the default/fallback when Redis is not available.
 * Uses a sorted array maintained on each update for O(n log n) ranking.
 * Suitable for development, testing, and small-scale deployments.
 */

import type { LeaderboardEntry, Leaderboard } from '../quiz/types';
import type { ILeaderboardStore } from './LeaderboardService';
import { createLogger } from '../utils/logger';

const logger = createLogger('InMemoryLeaderboard');

interface UserData {
  userId: string;
  username: string;
  score: number;
}

export class InMemoryLeaderboard implements ILeaderboardStore {
  /** Map of quizId → Map of userId → UserData */
  private leaderboards: Map<string, Map<string, UserData>> = new Map();

  async updateScore(
    quizId: string,
    userId: string,
    username: string,
    scoreIncrement: number,
  ): Promise<void> {
    let quizBoard = this.leaderboards.get(quizId);
    if (!quizBoard) {
      quizBoard = new Map();
      this.leaderboards.set(quizId, quizBoard);
    }

    const existing = quizBoard.get(userId);
    if (existing) {
      existing.score += scoreIncrement;
    } else {
      quizBoard.set(userId, { userId, username, score: scoreIncrement });
    }

    logger.debug('Score updated', { quizId, userId, scoreIncrement });
  }

  async getTopN(quizId: string, topN: number = 10): Promise<LeaderboardEntry[]> {
    const quizBoard = this.leaderboards.get(quizId);
    if (!quizBoard) return [];

    const sorted = Array.from(quizBoard.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, topN)
      .map((user, index) => ({
        userId: user.userId,
        username: user.username,
        score: user.score,
        rank: index + 1,
      }));

    return sorted;
  }

  async getUserRank(quizId: string, userId: string): Promise<LeaderboardEntry | null> {
    const quizBoard = this.leaderboards.get(quizId);
    if (!quizBoard) return null;

    const sorted = Array.from(quizBoard.values()).sort((a, b) => b.score - a.score);

    const index = sorted.findIndex((u) => u.userId === userId);
    if (index === -1) return null;

    return {
      userId: sorted[index].userId,
      username: sorted[index].username,
      score: sorted[index].score,
      rank: index + 1,
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
    this.leaderboards.delete(quizId);
    logger.debug('Leaderboard removed', { quizId });
  }
}
