import { afterEach, describe, expect, it } from 'vitest';
import { QuizManager } from '../../src/quiz/QuizManager';

describe('QuizManager', () => {
  let manager: QuizManager;

  afterEach(() => {
    manager?.destroy();
  });

  describe('getOrCreateSession', () => {
    it('should create a new session for a valid quiz ID', () => {
      manager = new QuizManager();
      const session = manager.getOrCreateSession('vocab-101');
      expect(session).toBeTruthy();
      expect(session.quiz.id).toBe('vocab-101');
      expect(session.state).toBe('WAITING');
    });

    it('should return the same session on subsequent calls', () => {
      manager = new QuizManager();
      const s1 = manager.getOrCreateSession('vocab-101');
      const s2 = manager.getOrCreateSession('vocab-101');
      expect(s1.sessionId).toBe(s2.sessionId);
    });

    it('should throw for non-existent quiz ID', () => {
      manager = new QuizManager();
      expect(() => manager.getOrCreateSession('nonexistent')).toThrow();
    });

    it('should create a new session after the previous one finishes', () => {
      manager = new QuizManager();
      const s1 = manager.getOrCreateSession('vocab-101');
      const _p = s1.addParticipant('TestUser');
      s1.start();

      // Manually set state to FINISHED via the internal mechanism
      // by answering all questions — simulate by destroying and re-requesting
      s1.destroy();
      // Force state for testing
      (s1 as any)._state = 'FINISHED';

      const s2 = manager.getOrCreateSession('vocab-101');
      expect(s2.sessionId).not.toBe(s1.sessionId);
    });
  });

  describe('getSession', () => {
    it('should return undefined for non-existent session', () => {
      manager = new QuizManager();
      expect(manager.getSession('nonexistent')).toBeUndefined();
    });

    it('should return existing session', () => {
      manager = new QuizManager();
      const created = manager.getOrCreateSession('vocab-101');
      const retrieved = manager.getSession('vocab-101');
      expect(retrieved?.sessionId).toBe(created.sessionId);
    });
  });

  describe('getMetrics', () => {
    it('should report zero when no sessions exist', () => {
      manager = new QuizManager();
      const metrics = manager.getMetrics();
      expect(metrics.activeSessions).toBe(0);
      expect(metrics.totalParticipants).toBe(0);
    });

    it('should count sessions and participants', () => {
      manager = new QuizManager();
      const session = manager.getOrCreateSession('vocab-101');
      session.addParticipant('Alice');
      session.addParticipant('Bob');

      const metrics = manager.getMetrics();
      expect(metrics.activeSessions).toBe(1);
      expect(metrics.totalParticipants).toBe(2);
    });
  });

  describe('destroy', () => {
    it('should clean up all sessions', () => {
      manager = new QuizManager();
      manager.getOrCreateSession('vocab-101');
      manager.getOrCreateSession('vocab-201');
      manager.destroy();

      expect(manager.getSession('vocab-101')).toBeUndefined();
      expect(manager.getSession('vocab-201')).toBeUndefined();
    });
  });
});
