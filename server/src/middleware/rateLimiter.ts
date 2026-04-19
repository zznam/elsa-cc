/**
 * Rate limiter middleware for Socket.IO events.
 * Uses a sliding window approach to limit answer submissions per user.
 */

import { createLogger } from '../utils/logger';

const logger = createLogger('RateLimiter');

interface RateLimitEntry {
  timestamps: number[];
}

export class RateLimiter {
  private entries: Map<string, RateLimitEntry> = new Map();
  private readonly maxRequests: number;
  private readonly windowMs: number;

  /**
   * @param maxRequests - Maximum number of requests allowed in the window
   * @param windowMs - Time window in milliseconds
   */
  constructor(maxRequests: number = 2, windowMs: number = 1000) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;

    // Prevent unbounded memory growth from stale entries
    setInterval(() => {
      this.cleanup();
    }, 60000);
  }

  /** Check if a request from the given key is within the rate limit. */
  isAllowed(key: string): boolean {
    const now = Date.now();
    let entry = this.entries.get(key);

    if (!entry) {
      entry = { timestamps: [] };
      this.entries.set(key, entry);
    }

    entry.timestamps = entry.timestamps.filter((t) => now - t < this.windowMs);

    if (entry.timestamps.length >= this.maxRequests) {
      logger.warn('Rate limited', { key, count: entry.timestamps.length });
      return false;
    }

    entry.timestamps.push(now);
    return true;
  }


  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.entries.entries()) {
      entry.timestamps = entry.timestamps.filter((t) => now - t < this.windowMs);
      if (entry.timestamps.length === 0) {
        this.entries.delete(key);
      }
    }
  }
}
