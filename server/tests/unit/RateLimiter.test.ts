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

  it('should handle a rapid flood of requests accurately', () => {
    const limiter = new RateLimiter(5, 1000);
    let allowedCount = 0;
    
    // Simulate 50 requests in a tight loop
    for (let i = 0; i < 50; i++) {
      if (limiter.isAllowed('flooder')) {
        allowedCount++;
      }
    }
    
    // Only the first 5 should be allowed
    expect(allowedCount).toBe(5);
  });

  it('should handle the default configuration', () => {
    const limiter = new RateLimiter();
    expect(limiter.isAllowed('user-1')).toBe(true);
    expect(limiter.isAllowed('user-1')).toBe(true);
    expect(limiter.isAllowed('user-1')).toBe(false);
  });
});
