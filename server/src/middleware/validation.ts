/**
 * Input validation schemas using Zod.
 * Validates all incoming WebSocket event payloads.
 */

import { z } from 'zod';

export const joinQuizSchema = z.object({
  quizId: z.string().min(1, 'Quiz ID is required').max(50),
  username: z.string().min(1, 'Username is required').max(20, 'Username must be 20 characters or less').trim(),
  userId: z.string().uuid().optional(),
});

export const submitAnswerSchema = z.object({
  quizId: z.string().min(1),
  questionId: z.string().min(1),
  selectedOptionIndex: z.number().int().min(0).max(10),
  clientTimestamp: z.number().positive(),
});

export const startQuizSchema = z.object({
  quizId: z.string().min(1),
});

export const getLeaderboardSchema = z.object({
  quizId: z.string().min(1),
});

/**
 * Validate data against a schema.
 * @returns The validated data or throws a validation error
 */
export function validate<T>(schema: z.ZodSchema<T>, data: unknown): T {
  return schema.parse(data);
}
