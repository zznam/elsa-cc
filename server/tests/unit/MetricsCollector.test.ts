import { beforeEach, describe, expect, it } from 'vitest';
import { METRIC, metrics } from '../../src/monitoring/metrics';

import { beforeEach, describe, expect, it } from 'vitest';
import { METRIC, metrics } from '../../src/monitoring/metrics';

describe('MetricsCollector', () => {
  beforeEach(() => {
    metrics.reset();
  });

  const getMetric = async (name: string) => {
    // @ts-ignore - registry is private but we need it for testing
    const json = await metrics.registry.getMetricsAsJSON();
    return json.find((m: any) => m.name === name);
  };

  const getMetricValue = async (name: string) => {
    const metric = await getMetric(name);
    return metric?.values[0]?.value;
  };

  describe('counters', () => {
    it('should increment counters', async () => {
      metrics.increment(METRIC.CONNECTIONS_TOTAL);
      metrics.increment(METRIC.CONNECTIONS_TOTAL);
      metrics.increment(METRIC.CONNECTIONS_TOTAL, 3);

      const val = await getMetricValue(METRIC.CONNECTIONS_TOTAL);
      expect(val).toBe(5);
    });

    it('should start at 0 for new counters', async () => {
      // prom-client will not register dynamically without explicit creation.
      // But we can check an existing one.
      metrics.increment(METRIC.ANSWERS_SUBMITTED);
      const val = await getMetricValue(METRIC.ANSWERS_SUBMITTED);
      expect(val).toBe(1);
    });
  });

  describe('gauges', () => {
    it('should set gauge values', async () => {
      metrics.setGauge(METRIC.ACTIVE_CONNECTIONS, 42);
      const val = await getMetricValue(METRIC.ACTIVE_CONNECTIONS);
      expect(val).toBe(42);
    });

    it('should overwrite gauge values', async () => {
      metrics.setGauge(METRIC.ACTIVE_SESSIONS, 10);
      metrics.setGauge(METRIC.ACTIVE_SESSIONS, 5);
      const val = await getMetricValue(METRIC.ACTIVE_SESSIONS);
      expect(val).toBe(5);
    });
  });

  describe('histograms', () => {
    it('should record histogram values and compute buckets', async () => {
      for (let i = 1; i <= 100; i++) {
        metrics.recordHistogram(METRIC.ANSWER_LATENCY_MS, i);
      }

      const metric = await getMetric(METRIC.ANSWER_LATENCY_MS);
      const countVal = metric?.values.find((v: any) => v.metricName === `${METRIC.ANSWER_LATENCY_MS}_count`)?.value;
      const sumVal = metric?.values.find((v: any) => v.metricName === `${METRIC.ANSWER_LATENCY_MS}_sum`)?.value;

      expect(countVal).toBe(100);
      expect(sumVal).toBe(5050); // sum of 1 to 100
    });
  });

  describe('reset', () => {
    it('should clear all metrics', async () => {
      metrics.increment(METRIC.ANSWERS_SUBMITTED);
      metrics.setGauge(METRIC.ACTIVE_CONNECTIONS, 10);
      metrics.recordHistogram(METRIC.ANSWER_LATENCY_MS, 50);
      
      metrics.reset();

      // prom-client resetMetrics clears the values but keeps the definitions
      const val = await getMetricValue(METRIC.ANSWERS_SUBMITTED);
      expect(val).toBe(0);
    });
  });
});
