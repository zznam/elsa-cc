import { describe, it, expect, beforeEach } from 'vitest';
import { metrics, METRIC } from '../../src/monitoring/metrics';

describe('MetricsCollector', () => {
  beforeEach(() => {
    metrics.reset();
  });

  describe('counters', () => {
    it('should increment counters', () => {
      metrics.increment(METRIC.CONNECTIONS_TOTAL);
      metrics.increment(METRIC.CONNECTIONS_TOTAL);
      metrics.increment(METRIC.CONNECTIONS_TOTAL, 3);

      const all = metrics.getAll();
      const counters = all.counters as Record<string, number>;
      expect(counters[METRIC.CONNECTIONS_TOTAL]).toBe(5);
    });

    it('should start at 0 for new counters', () => {
      metrics.increment('new_counter');
      const all = metrics.getAll();
      const counters = all.counters as Record<string, number>;
      expect(counters['new_counter']).toBe(1);
    });
  });

  describe('gauges', () => {
    it('should set gauge values', () => {
      metrics.setGauge(METRIC.ACTIVE_CONNECTIONS, 42);
      const all = metrics.getAll();
      const gauges = all.gauges as Record<string, number>;
      expect(gauges[METRIC.ACTIVE_CONNECTIONS]).toBe(42);
    });

    it('should overwrite gauge values', () => {
      metrics.setGauge(METRIC.ACTIVE_SESSIONS, 10);
      metrics.setGauge(METRIC.ACTIVE_SESSIONS, 5);
      const all = metrics.getAll();
      const gauges = all.gauges as Record<string, number>;
      expect(gauges[METRIC.ACTIVE_SESSIONS]).toBe(5);
    });
  });

  describe('histograms', () => {
    it('should record histogram values and compute percentiles', () => {
      for (let i = 1; i <= 100; i++) {
        metrics.recordHistogram(METRIC.ANSWER_LATENCY_MS, i);
      }

      const all = metrics.getAll();
      const histograms = all.histograms as Record<string, any>;
      const latency = histograms[METRIC.ANSWER_LATENCY_MS];

      expect(latency.count).toBe(100);
      expect(latency.min).toBe(1);
      expect(latency.max).toBe(100);
      expect(latency.p50).toBe(51);
      expect(latency.p95).toBe(96);
    });
  });

  describe('reset', () => {
    it('should clear all metrics', () => {
      metrics.increment(METRIC.ANSWERS_SUBMITTED);
      metrics.setGauge(METRIC.ACTIVE_CONNECTIONS, 10);
      metrics.recordHistogram(METRIC.ANSWER_LATENCY_MS, 50);
      metrics.reset();

      const all = metrics.getAll();
      expect(Object.keys(all.counters as object)).toHaveLength(0);
      expect(Object.keys(all.gauges as object)).toHaveLength(0);
      expect(Object.keys(all.histograms as object)).toHaveLength(0);
    });
  });
});
