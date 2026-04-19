/**
 * Metrics collection for monitoring and observability.
 * In production, these would be exposed as Prometheus metrics.
 * For this implementation, they're tracked in-memory and exposed via HTTP.
 */

import { createLogger } from '../utils/logger';

const logger = createLogger('Metrics');

interface MetricPoint {
  value: number;
  timestamp: number;
}

class MetricsCollector {
  private counters: Map<string, number> = new Map();
  private gauges: Map<string, number> = new Map();
  private histograms: Map<string, number[]> = new Map();


  increment(name: string, value: number = 1): void {
    const current = this.counters.get(name) || 0;
    this.counters.set(name, current + value);
  }


  setGauge(name: string, value: number): void {
    this.gauges.set(name, value);
  }


  recordHistogram(name: string, value: number): void {
    const values = this.histograms.get(name) || [];
    values.push(value);
    // Cap at 1000 values to avoid unbounded growth
    if (values.length > 1000) {
      values.shift();
    }
    this.histograms.set(name, values);
  }


  getAll(): Record<string, unknown> {
    const result: Record<string, unknown> = {
      counters: Object.fromEntries(this.counters),
      gauges: Object.fromEntries(this.gauges),
      histograms: {} as Record<string, unknown>,
    };
    const histograms = result.histograms as Record<string, unknown>;
    for (const [name, values] of this.histograms.entries()) {
      const sorted = [...values].sort((a, b) => a - b);
      histograms[name] = {
        count: sorted.length,
        min: sorted[0],
        max: sorted[sorted.length - 1],
        avg: Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length),
        p50: sorted[Math.floor(sorted.length * 0.5)],
        p95: sorted[Math.floor(sorted.length * 0.95)],
        p99: sorted[Math.floor(sorted.length * 0.99)],
      };
    }

    return result;
  }


  reset(): void {
    this.counters.clear();
    this.gauges.clear();
    this.histograms.clear();
  }
}

/** Global metrics instance */
export const metrics = new MetricsCollector();

// Metric names as constants to prevent typos
export const METRIC = {
  CONNECTIONS_TOTAL: 'connections_total',
  DISCONNECTIONS_TOTAL: 'disconnections_total',
  ANSWERS_SUBMITTED: 'answers_submitted',
  CORRECT_ANSWERS: 'correct_answers',
  QUIZZES_CREATED: 'quizzes_created',
  QUIZZES_COMPLETED: 'quizzes_completed',
  ACTIVE_CONNECTIONS: 'active_connections',
  ACTIVE_SESSIONS: 'active_sessions',
  ANSWER_LATENCY_MS: 'answer_latency_ms',
  LEADERBOARD_BROADCAST_MS: 'leaderboard_broadcast_ms',
};
