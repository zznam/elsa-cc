/**
 * LeaderboardService — Interface and factory for leaderboard implementations.
 *
 * Uses the Strategy pattern to allow swapping between Redis and in-memory
 * implementations without changing the consuming code.
 */

import type { Leaderboard, LeaderboardEntry } from '../quiz/types';

/**
 * Interface for leaderboard storage backends.
 * Both Redis and in-memory implementations conform to this contract.
 */
export interface ILeaderboardStore {
  /**
   * Update (increment) a user's score in the leaderboard.
   * @param quizId - Quiz session identifier
   * @param userId - User identifier
   * @param username - Display name
   * @param scoreIncrement - Points to add
   */
  updateScore(quizId: string, userId: string, username: string, scoreIncrement: number): Promise<void>;

  /**
   * Get the top N entries from the leaderboard.
   * @param quizId - Quiz session identifier
   * @param topN - Number of top entries to return (default: 10)
   */
  getTopN(quizId: string, topN?: number): Promise<LeaderboardEntry[]>;

  /**
   * Get a specific user's rank and score.
   * @param quizId - Quiz session identifier
   * @param userId - User identifier
   */
  getUserRank(quizId: string, userId: string): Promise<LeaderboardEntry | null>;

  /**
   * Get the full leaderboard object.
   */
  getLeaderboard(quizId: string, topN?: number): Promise<Leaderboard>;

  /**
   * Remove a leaderboard (cleanup after quiz ends).
   */
  removeLeaderboard(quizId: string): Promise<void>;
}
