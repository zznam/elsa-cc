import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryLeaderboard } from '../../src/leaderboard/InMemoryLeaderboard';

describe('InMemoryLeaderboard', () => {
  let lb: InMemoryLeaderboard;

  beforeEach(() => {
    lb = new InMemoryLeaderboard();
  });

  it('should update and retrieve scores', async () => {
    await lb.updateScore('quiz1', 'u1', 'Alice', 100);
    await lb.updateScore('quiz1', 'u2', 'Bob', 200);

    const entries = await lb.getTopN('quiz1');
    expect(entries).toHaveLength(2);
    expect(entries[0].username).toBe('Bob');
    expect(entries[0].score).toBe(200);
    expect(entries[0].rank).toBe(1);
  });

  it('should include participants initialized with zero points', async () => {
    await lb.updateScore('quiz1', 'u1', 'Alice', 0);
    await lb.updateScore('quiz1', 'u2', 'Bob', 100);

    const entries = await lb.getTopN('quiz1');
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.username)).toContain('Alice');
    expect(entries.find((e) => e.username === 'Alice')?.score).toBe(0);
  });

  it('should increment scores', async () => {
    await lb.updateScore('quiz1', 'u1', 'Alice', 100);
    await lb.updateScore('quiz1', 'u1', 'Alice', 50);

    const entries = await lb.getTopN('quiz1');
    expect(entries[0].score).toBe(150);
  });

  it('should return top N entries', async () => {
    for (let i = 0; i < 15; i++) {
      await lb.updateScore('quiz1', `u${i}`, `User${i}`, i * 10);
    }
    const top5 = await lb.getTopN('quiz1', 5);
    expect(top5).toHaveLength(5);
    expect(top5[0].score).toBe(140);
  });

  it('should get user rank', async () => {
    await lb.updateScore('quiz1', 'u1', 'Alice', 300);
    await lb.updateScore('quiz1', 'u2', 'Bob', 200);
    await lb.updateScore('quiz1', 'u3', 'Charlie', 100);

    const rank = await lb.getUserRank('quiz1', 'u2');
    expect(rank?.rank).toBe(2);
    expect(rank?.score).toBe(200);
  });

  it('should return null for unknown user', async () => {
    const rank = await lb.getUserRank('quiz1', 'unknown');
    expect(rank).toBeNull();
  });

  it('should remove leaderboard', async () => {
    await lb.updateScore('quiz1', 'u1', 'Alice', 100);
    await lb.removeLeaderboard('quiz1');
    const entries = await lb.getTopN('quiz1');
    expect(entries).toHaveLength(0);
  });

  it('should return full leaderboard object', async () => {
    await lb.updateScore('quiz1', 'u1', 'Alice', 100);
    const board = await lb.getLeaderboard('quiz1');
    expect(board.quizId).toBe('quiz1');
    expect(board.entries).toHaveLength(1);
    expect(board.updatedAt).toBeGreaterThan(0);
  });

  it('should isolate quizzes', async () => {
    await lb.updateScore('quiz1', 'u1', 'Alice', 100);
    await lb.updateScore('quiz2', 'u2', 'Bob', 200);
    const q1 = await lb.getTopN('quiz1');
    expect(q1).toHaveLength(1);
    expect(q1[0].username).toBe('Alice');
  });
});
