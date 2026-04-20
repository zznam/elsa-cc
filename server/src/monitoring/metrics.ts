/**
 * Metrics collection backed by `prom-client`.
 *
 * Exposes counters, gauges, and histograms in Prometheus text exposition
 * format via `metrics.render()`. Thin wrapper keeps call sites ergonomic
 * and lets tests reset state deterministically.
 */

import {
  Counter,
  type CounterConfiguration,
  Gauge,
  type GaugeConfiguration,
  Histogram,
  type HistogramConfiguration,
  type LabelValues,
  Registry,
  collectDefaultMetrics,
} from 'prom-client';

/** Metric names as constants to prevent typos. */
export const METRIC = {
  CONNECTIONS_TOTAL: 'quiz_connections_total',
  DISCONNECTIONS_TOTAL: 'quiz_disconnections_total',
  JOINS_TOTAL: 'quiz_joins_total',
  ANSWERS_SUBMITTED: 'quiz_answers_submitted_total',
  CORRECT_ANSWERS: 'quiz_correct_answers_total',
  QUIZZES_CREATED: 'quiz_sessions_created_total',
  QUIZZES_COMPLETED: 'quiz_sessions_completed_total',
  REDIS_ERRORS: 'quiz_redis_errors_total',
  ACTIVE_CONNECTIONS: 'quiz_active_connections',
  ACTIVE_SESSIONS: 'quiz_active_sessions',
  ACTIVE_PARTICIPANTS: 'quiz_active_participants',
  ANSWER_LATENCY_MS: 'quiz_answer_latency_ms',
  LEADERBOARD_BROADCAST_MS: 'quiz_leaderboard_broadcast_ms',
  JOIN_LATENCY_MS: 'quiz_join_latency_ms',
} as const;

/** Latency buckets tuned for sub-second, real-time event work (in ms). */
const LATENCY_BUCKETS_MS = [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000];

class MetricsRegistry {
  private registry: Registry;
  private counters: Map<string, Counter<string>> = new Map();
  private gauges: Map<string, Gauge<string>> = new Map();
  private histograms: Map<string, Histogram<string>> = new Map();

  constructor() {
    this.registry = new Registry();
    this.bootstrap();
  }

  private bootstrap(): void {
    collectDefaultMetrics({ register: this.registry });

    this.counter({ name: METRIC.CONNECTIONS_TOTAL, help: 'Socket.IO connections accepted' });
    this.counter({ name: METRIC.DISCONNECTIONS_TOTAL, help: 'Socket.IO disconnections observed' });
    this.counter({ name: METRIC.JOINS_TOTAL, help: 'Quiz joins', labelNames: ['kind'] });
    this.counter({ name: METRIC.ANSWERS_SUBMITTED, help: 'Answers submitted by clients' });
    this.counter({ name: METRIC.CORRECT_ANSWERS, help: 'Answers scored correct server-side' });
    this.counter({ name: METRIC.QUIZZES_CREATED, help: 'Quiz sessions created' });
    this.counter({ name: METRIC.QUIZZES_COMPLETED, help: 'Quiz sessions reaching FINISHED' });
    this.counter({ name: METRIC.REDIS_ERRORS, help: 'Runtime Redis failures', labelNames: ['op'] });

    this.gauge({ name: METRIC.ACTIVE_CONNECTIONS, help: 'Currently connected sockets' });
    this.gauge({ name: METRIC.ACTIVE_SESSIONS, help: 'In-flight quiz sessions' });
    this.gauge({ name: METRIC.ACTIVE_PARTICIPANTS, help: 'Participants across all sessions' });

    this.histogram({
      name: METRIC.ANSWER_LATENCY_MS,
      help: 'Server time between question start and answer receipt',
      buckets: LATENCY_BUCKETS_MS,
    });
    this.histogram({
      name: METRIC.LEADERBOARD_BROADCAST_MS,
      help: 'Time spent fetching + emitting leaderboard updates',
      buckets: LATENCY_BUCKETS_MS,
    });
    this.histogram({
      name: METRIC.JOIN_LATENCY_MS,
      help: 'Time to service a join_quiz event',
      buckets: LATENCY_BUCKETS_MS,
    });
  }

  private counter(config: CounterConfiguration<string>): void {
    const c = new Counter({ ...config, registers: [this.registry] });
    this.counters.set(config.name, c);
  }

  private gauge(config: GaugeConfiguration<string>): void {
    const g = new Gauge({ ...config, registers: [this.registry] });
    this.gauges.set(config.name, g);
  }

  private histogram(config: HistogramConfiguration<string>): void {
    const h = new Histogram({ ...config, registers: [this.registry] });
    this.histograms.set(config.name, h);
  }

  increment(name: string, value: number = 1, labels?: LabelValues<string>): void {
    const counter = this.counters.get(name);
    if (!counter) return;
    if (labels) counter.inc(labels, value);
    else counter.inc(value);
  }

  setGauge(name: string, value: number, labels?: LabelValues<string>): void {
    const gauge = this.gauges.get(name);
    if (!gauge) return;
    if (labels) gauge.set(labels, value);
    else gauge.set(value);
  }

  recordHistogram(name: string, value: number, labels?: LabelValues<string>): void {
    const histogram = this.histograms.get(name);
    if (!histogram) return;
    if (labels) histogram.observe(labels, value);
    else histogram.observe(value);
  }

  /** Prometheus text exposition format (for /metrics scrape endpoint). */
  async render(): Promise<string> {
    return this.registry.metrics();
  }

  contentType(): string {
    return this.registry.contentType;
  }

  /** Test-only: reset all metrics to zero without losing metric registration. */
  reset(): void {
    this.registry.resetMetrics();
  }
}

/** Singleton registry used everywhere. */
export const metrics = new MetricsRegistry();
