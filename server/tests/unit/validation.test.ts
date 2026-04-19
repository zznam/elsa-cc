import { describe, it, expect } from 'vitest';
import { joinQuizSchema, submitAnswerSchema, startQuizSchema, getLeaderboardSchema, validate } from '../../src/middleware/validation';

describe('Zod validation schemas', () => {
  describe('joinQuizSchema', () => {
    it('should accept valid join data', () => {
      const result = joinQuizSchema.parse({ quizId: 'vocab-101', username: 'Alice' });
      expect(result.quizId).toBe('vocab-101');
      expect(result.username).toBe('Alice');
    });

    it('should reject empty quizId', () => {
      expect(() => joinQuizSchema.parse({ quizId: '', username: 'Alice' })).toThrow();
    });

    it('should reject empty username', () => {
      expect(() => joinQuizSchema.parse({ quizId: 'vocab-101', username: '' })).toThrow();
    });

    it('should reject username longer than 20 chars', () => {
      expect(() => joinQuizSchema.parse({ quizId: 'vocab-101', username: 'A'.repeat(21) })).toThrow();
    });

    it('should trim whitespace from username', () => {
      const result = joinQuizSchema.parse({ quizId: 'vocab-101', username: '  Alice  ' });
      expect(result.username).toBe('Alice');
    });

    it('should reject quizId longer than 50 chars', () => {
      expect(() => joinQuizSchema.parse({ quizId: 'x'.repeat(51), username: 'Alice' })).toThrow();
    });
  });

  describe('submitAnswerSchema', () => {
    it('should accept valid answer submission', () => {
      const result = submitAnswerSchema.parse({
        quizId: 'vocab-101',
        questionId: 'q1',
        selectedOptionIndex: 2,
        clientTimestamp: Date.now(),
      });
      expect(result.selectedOptionIndex).toBe(2);
    });

    it('should reject negative option index', () => {
      expect(() => submitAnswerSchema.parse({
        quizId: 'vocab-101',
        questionId: 'q1',
        selectedOptionIndex: -1,
        clientTimestamp: Date.now(),
      })).toThrow();
    });

    it('should reject non-integer option index', () => {
      expect(() => submitAnswerSchema.parse({
        quizId: 'vocab-101',
        questionId: 'q1',
        selectedOptionIndex: 1.5,
        clientTimestamp: Date.now(),
      })).toThrow();
    });

    it('should reject missing fields', () => {
      expect(() => submitAnswerSchema.parse({ quizId: 'vocab-101' })).toThrow();
    });
  });

  describe('startQuizSchema', () => {
    it('should accept valid start data', () => {
      const result = startQuizSchema.parse({ quizId: 'vocab-101' });
      expect(result.quizId).toBe('vocab-101');
    });

    it('should reject empty quizId', () => {
      expect(() => startQuizSchema.parse({ quizId: '' })).toThrow();
    });
  });

  describe('getLeaderboardSchema', () => {
    it('should accept valid leaderboard request', () => {
      const result = getLeaderboardSchema.parse({ quizId: 'vocab-101' });
      expect(result.quizId).toBe('vocab-101');
    });
  });

  describe('validate helper', () => {
    it('should return validated data on success', () => {
      const result = validate(startQuizSchema, { quizId: 'test' });
      expect(result.quizId).toBe('test');
    });

    it('should throw on invalid data', () => {
      expect(() => validate(startQuizSchema, { quizId: '' })).toThrow();
    });
  });
});
