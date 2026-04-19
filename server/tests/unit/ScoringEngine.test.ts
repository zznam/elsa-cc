import { describe, expect, it } from 'vitest';
import { ScoringEngine } from '../../src/quiz/ScoringEngine';
import type { Question } from '../../src/quiz/types';

const makeQuestion = (overrides?: Partial<Question>): Question => ({
  id: 'q1',
  word: 'Test',
  prompt: 'Test question',
  options: ['A', 'B', 'C', 'D'],
  correctOptionIndex: 1,
  timeLimitSeconds: 15,
  difficulty: 'medium',
  ...overrides,
});

describe('ScoringEngine', () => {
  const engine = new ScoringEngine();

  describe('calculateScore', () => {
    it('should return 0 points for incorrect answer', () => {
      const result = engine.calculateScore(makeQuestion(), 0, 5000, 0, 0);
      expect(result.correct).toBe(false);
      expect(result.pointsEarned).toBe(0);
      expect(result.currentStreak).toBe(0);
      expect(result.totalScore).toBe(0);
    });

    it('should award base points for correct answer', () => {
      const result = engine.calculateScore(makeQuestion(), 1, 15000, 0, 0);
      expect(result.correct).toBe(true);
      expect(result.basePoints).toBe(200); // medium difficulty
      expect(result.pointsEarned).toBeGreaterThan(0);
    });

    it('should award difficulty-based points', () => {
      const easy = engine.calculateScore(makeQuestion({ difficulty: 'easy' }), 1, 15000, 0, 0);
      const hard = engine.calculateScore(makeQuestion({ difficulty: 'hard' }), 1, 15000, 0, 0);
      expect(easy.basePoints).toBe(100);
      expect(hard.basePoints).toBe(300);
    });

    it('should give higher time bonus for faster answers', () => {
      const fast = engine.calculateScore(makeQuestion(), 1, 1000, 0, 0);
      const slow = engine.calculateScore(makeQuestion(), 1, 14000, 0, 0);
      expect(fast.timeBonus).toBeGreaterThan(slow.timeBonus);
    });

    it('should give maximum time bonus for instant answer', () => {
      const result = engine.calculateScore(makeQuestion(), 1, 0, 0, 0);
      expect(result.timeBonus).toBe(100); // 50% of 200 base
    });

    it('should give zero time bonus at time limit', () => {
      const result = engine.calculateScore(makeQuestion(), 1, 15000, 0, 0);
      expect(result.timeBonus).toBe(0);
    });

    it('should handle responses submitted slightly after the time limit (lag)', () => {
      const result = engine.calculateScore(makeQuestion(), 1, 15005, 0, 0);
      expect(result.timeBonus).toBe(0); // Should clamp to 0, not negative
      expect(result.pointsEarned).toBeGreaterThanOrEqual(result.basePoints);
    });

    it('should handle instant responses at exactly 0ms', () => {
      const result = engine.calculateScore(makeQuestion(), 1, 0, 0, 0);
      expect(result.timeBonus).toBe(100); // 50% of 200 base
      expect(result.pointsEarned).toBe(320); // 200 (base) + 100 (time) + 20 (streak 1)
    });

    it('should increase streak on correct answer', () => {
      const result = engine.calculateScore(makeQuestion(), 1, 5000, 2, 0);
      expect(result.currentStreak).toBe(3);
    });

    it('should reset streak on incorrect answer', () => {
      const result = engine.calculateScore(makeQuestion(), 0, 5000, 5, 0);
      expect(result.currentStreak).toBe(0);
    });

    it('should cap streak bonus at 50%', () => {
      const result = engine.calculateScore(makeQuestion(), 1, 15000, 10, 0);
      expect(result.streakBonus).toBe(100); // 50% of 200
    });

    it('should accumulate total score', () => {
      const result = engine.calculateScore(makeQuestion(), 1, 15000, 0, 500);
      expect(result.totalScore).toBe(500 + result.pointsEarned);
    });

    it('should include correct answer index in result', () => {
      const result = engine.calculateScore(makeQuestion({ correctOptionIndex: 2 }), 2, 5000, 0, 0);
      expect(result.correctOptionIndex).toBe(2);
    });
  });

  describe('isValidOptionIndex', () => {
    const question = makeQuestion();

    it('should accept valid indices', () => {
      expect(engine.isValidOptionIndex(question, 0)).toBe(true);
      expect(engine.isValidOptionIndex(question, 3)).toBe(true);
    });

    it('should reject negative indices', () => {
      expect(engine.isValidOptionIndex(question, -1)).toBe(false);
    });

    it('should reject out of range indices', () => {
      expect(engine.isValidOptionIndex(question, 4)).toBe(false);
    });

    it('should reject non-integer indices', () => {
      expect(engine.isValidOptionIndex(question, 1.5)).toBe(false);
    });
  });
});
