import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RateLimiter } from '../../src/middleware/rateLimiter';

describe('RateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should allow requests within the limit', () => {
    const limiter = new RateLimiter(2, 1000);
    expect(limiter.isAllowed('user-1')).toBe(true);
    expect(limiter.isAllowed('user-1')).toBe(true);
  });

  it('should deny requests exceeding the limit', () => {
    const limiter = new RateLimiter(2, 1000);
    expect(limiter.isAllowed('user-1')).toBe(true);
    expect(limiter.isAllowed('user-1')).toBe(true);
    expect(limiter.isAllowed('user-1')).toBe(false);
  });

  it('should reset after the time window elapses', () => {
    const limiter = new RateLimiter(1, 1000);
    expect(limiter.isAllowed('user-1')).toBe(true);
    expect(limiter.isAllowed('user-1')).toBe(false);

    vi.advanceTimersByTime(1001);

    expect(limiter.isAllowed('user-1')).toBe(true);
  });

  it('should track users independently', () => {
    const limiter = new RateLimiter(1, 1000);
    expect(limiter.isAllowed('user-1')).toBe(true);
    expect(limiter.isAllowed('user-2')).toBe(true);
    expect(limiter.isAllowed('user-1')).toBe(false);
    expect(limiter.isAllowed('user-2')).toBe(false);
  });

  it('should handle the default configuration', () => {
    const limiter = new RateLimiter();
    expect(limiter.isAllowed('user-1')).toBe(true);
    expect(limiter.isAllowed('user-1')).toBe(true);
    expect(limiter.isAllowed('user-1')).toBe(false);
  });
});
