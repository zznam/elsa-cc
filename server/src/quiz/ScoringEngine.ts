/**
 * ScoringEngine — Handles answer validation and score calculation.
 *
 * Scoring formula:
 *   - Base points: Determined by question difficulty (easy: 100, medium: 200, hard: 300)
 *   - Time bonus: Up to 50% extra based on how quickly the user answered
 *   - Streak bonus: +10% per consecutive correct answer (capped at +50%)
 *   - Incorrect answers: 0 points, streak reset
 *
 * All scoring is server-side to prevent cheating.
 */

import type { Question, ScoreResult } from './types';
import { createLogger } from '../utils/logger';

const logger = createLogger('ScoringEngine');

/** Base points by difficulty level */
const DIFFICULTY_POINTS: Record<string, number> = {
  easy: 100,
  medium: 200,
  hard: 300,
};

/** Maximum time bonus multiplier (50% of base points) */
const MAX_TIME_BONUS_MULTIPLIER = 0.5;

/** Streak bonus per consecutive correct answer (10%) */
const STREAK_BONUS_PER_CORRECT = 0.1;

/** Maximum streak bonus multiplier (50% of base points) */
const MAX_STREAK_BONUS_MULTIPLIER = 0.5;

export class ScoringEngine {
  /**
   * Calculate the score for a submitted answer.
   *
   * @param question - The question being answered
   * @param selectedOptionIndex - The user's selected answer (0-based index)
   * @param responseTimeMs - Time taken to answer in milliseconds
   * @param currentStreak - User's current correct answer streak
   * @param currentTotalScore - User's current total score
   * @returns ScoreResult with breakdown of points earned
   */
  calculateScore(
    question: Question,
    selectedOptionIndex: number,
    responseTimeMs: number,
    currentStreak: number,
    currentTotalScore: number,
  ): ScoreResult {
    const correct = selectedOptionIndex === question.correctOptionIndex;

    if (!correct) {
      logger.debug('Incorrect answer', {
        questionId: question.id,
        selected: selectedOptionIndex,
        correct: question.correctOptionIndex,
      });

      return {
        correct: false,
        pointsEarned: 0,
        basePoints: 0,
        timeBonus: 0,
        streakBonus: 0,
        currentStreak: 0,
        totalScore: currentTotalScore,
        correctOptionIndex: question.correctOptionIndex,
      };
    }

    // Calculate base points
    const basePoints = DIFFICULTY_POINTS[question.difficulty] || DIFFICULTY_POINTS.medium;

    // Calculate time bonus: faster answers get more bonus points
    const timeLimitMs = question.timeLimitSeconds * 1000;
    const clampedResponseTime = Math.max(0, Math.min(responseTimeMs, timeLimitMs));
    const timeRatio = 1 - clampedResponseTime / timeLimitMs; // 1 = instant, 0 = at limit
    const timeBonus = Math.round(basePoints * MAX_TIME_BONUS_MULTIPLIER * timeRatio);

    // Calculate streak bonus
    const newStreak = currentStreak + 1;
    const streakMultiplier = Math.min(
      newStreak * STREAK_BONUS_PER_CORRECT,
      MAX_STREAK_BONUS_MULTIPLIER,
    );
    const streakBonus = Math.round(basePoints * streakMultiplier);

    const pointsEarned = basePoints + timeBonus + streakBonus;
    const totalScore = currentTotalScore + pointsEarned;

    logger.debug('Score calculated', {
      questionId: question.id,
      basePoints,
      timeBonus,
      streakBonus,
      pointsEarned,
      totalScore,
      responseTimeMs,
      streak: newStreak,
    });

    return {
      correct: true,
      pointsEarned,
      basePoints,
      timeBonus,
      streakBonus,
      currentStreak: newStreak,
      totalScore,
      correctOptionIndex: question.correctOptionIndex,
    };
  }

  /**
   * Validate that a selected option index is valid for the given question.
   */
  isValidOptionIndex(question: Question, selectedOptionIndex: number): boolean {
    return (
      Number.isInteger(selectedOptionIndex) &&
      selectedOptionIndex >= 0 &&
      selectedOptionIndex < question.options.length
    );
  }
}
