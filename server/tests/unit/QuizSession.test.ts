import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { QuizSession } from '../../src/quiz/QuizSession';
import type { Quiz } from '../../src/quiz/types';

const mockQuiz: Quiz = {
  id: 'test-quiz',
  title: 'Test Quiz',
  description: 'A test quiz',
  questions: [
    { id: 'q1', word: 'Test1', prompt: 'Q1?', options: ['A', 'B', 'C', 'D'], correctOptionIndex: 0, timeLimitSeconds: 10, difficulty: 'easy' },
    { id: 'q2', word: 'Test2', prompt: 'Q2?', options: ['A', 'B', 'C', 'D'], correctOptionIndex: 1, timeLimitSeconds: 10, difficulty: 'medium' },
  ],
};

describe('QuizSession', () => {
  let session: QuizSession;

  beforeEach(() => {
    session = new QuizSession(mockQuiz, 10);
  });

  afterEach(() => {
    session.destroy();
  });

  describe('participant management', () => {
    it('should add participants', () => {
      const p = session.addParticipant('Alice');
      expect(p.username).toBe('Alice');
      expect(p.userId).toBeTruthy();
      expect(session.participantCount).toBe(1);
    });

    it('should reject duplicate usernames', () => {
      session.addParticipant('Alice');
      expect(() => session.addParticipant('Alice')).toThrow();
    });

    it('should reject when full', () => {
      const small = new QuizSession(mockQuiz, 1);
      small.addParticipant('Alice');
      expect(() => small.addParticipant('Bob')).toThrow();
      small.destroy();
    });

    it('should handle disconnect/reconnect', () => {
      const p = session.addParticipant('Alice');
      session.disconnectParticipant(p.userId);
      expect(session.getParticipant(p.userId)?.isConnected).toBe(false);

      session.reconnectParticipant(p.userId);
      expect(session.getParticipant(p.userId)?.isConnected).toBe(true);
    });
  });

  describe('lifecycle', () => {
    it('should start in WAITING state', () => {
      expect(session.state).toBe('WAITING');
    });

    it('should transition to ACTIVE on start', () => {
      session.addParticipant('Alice');
      session.start();
      expect(session.state).toBe('ACTIVE');
    });

    it('should reject double start', () => {
      session.addParticipant('Alice');
      session.start();
      expect(() => session.start()).toThrow();
    });

    it('should emit quizStarted event', () => {
      let started = false;
      session.on('quizStarted', () => { started = true; });
      session.addParticipant('Alice');
      session.start();
      expect(started).toBe(true);
    });

    it('should emit questionStarted on start', () => {
      let questionData: any = null;
      session.on('questionStarted', (data) => { questionData = data; });
      session.addParticipant('Alice');
      session.start();
      expect(questionData).toBeTruthy();
      expect(questionData.questionId).toBe('q1');
      expect(questionData.questionNumber).toBe(1);
    });
  });

  describe('answer submission', () => {
    it('should score correct answers', () => {
      const p = session.addParticipant('Alice');
      session.start();
      const result = session.submitAnswer(p.userId, {
        quizId: 'test-quiz', questionId: 'q1', selectedOptionIndex: 0, clientTimestamp: Date.now(),
      });
      expect(result.correct).toBe(true);
      expect(result.pointsEarned).toBeGreaterThan(0);
    });

    it('should reject duplicate answers', () => {
      const p = session.addParticipant('Alice');
      session.start();
      session.submitAnswer(p.userId, { quizId: 'test-quiz', questionId: 'q1', selectedOptionIndex: 0, clientTimestamp: Date.now() });
      expect(() => session.submitAnswer(p.userId, { quizId: 'test-quiz', questionId: 'q1', selectedOptionIndex: 1, clientTimestamp: Date.now() })).toThrow();
    });

    it('should reject answers from non-participants', () => {
      session.addParticipant('Alice');
      session.start();
      expect(() => session.submitAnswer('unknown', { quizId: 'test-quiz', questionId: 'q1', selectedOptionIndex: 0, clientTimestamp: Date.now() })).toThrow();
    });
  });
});
