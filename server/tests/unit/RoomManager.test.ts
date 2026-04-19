import { describe, it, expect, vi } from 'vitest';
import { RoomManager } from '../../src/realtime/RoomManager';

function createMockSocket(id: string) {
  return {
    id,
    join: vi.fn(),
  } as any;
}

describe('RoomManager', () => {
  it('should track a connection after joinRoom', () => {
    const rm = new RoomManager();
    const socket = createMockSocket('sock-1');

    rm.joinRoom(socket, 'quiz-1', 'user-1', 'Alice');

    expect(socket.join).toHaveBeenCalledWith('quiz-1');
    const conn = rm.getConnection('sock-1');
    expect(conn?.userId).toBe('user-1');
    expect(conn?.quizId).toBe('quiz-1');
    expect(conn?.username).toBe('Alice');
  });

  it('should return undefined for unknown socket', () => {
    const rm = new RoomManager();
    expect(rm.getConnection('unknown')).toBeUndefined();
  });

  it('should remove connection on leaveRoom', () => {
    const rm = new RoomManager();
    const socket = createMockSocket('sock-1');
    rm.joinRoom(socket, 'quiz-1', 'user-1', 'Alice');

    const conn = rm.leaveRoom('sock-1');
    expect(conn?.userId).toBe('user-1');
    expect(rm.getConnection('sock-1')).toBeUndefined();
  });

  it('should return undefined when leaving unknown socket', () => {
    const rm = new RoomManager();
    expect(rm.leaveRoom('unknown')).toBeUndefined();
  });

  it('should map userId to socketId for reconnection', () => {
    const rm = new RoomManager();
    const socket = createMockSocket('sock-1');
    rm.joinRoom(socket, 'quiz-1', 'user-1', 'Alice');

    expect(rm.getSocketIdForUser('user-1')).toBe('sock-1');
    expect(rm.getSocketIdForUser('unknown')).toBeUndefined();
  });

  it('should return quizId for a given socket', () => {
    const rm = new RoomManager();
    const socket = createMockSocket('sock-1');
    rm.joinRoom(socket, 'quiz-1', 'user-1', 'Alice');

    expect(rm.getQuizIdForSocket('sock-1')).toBe('quiz-1');
    expect(rm.getQuizIdForSocket('unknown')).toBeUndefined();
  });

  it('should count active connections', () => {
    const rm = new RoomManager();
    expect(rm.getActiveConnectionCount()).toBe(0);

    rm.joinRoom(createMockSocket('s1'), 'q1', 'u1', 'Alice');
    rm.joinRoom(createMockSocket('s2'), 'q1', 'u2', 'Bob');
    expect(rm.getActiveConnectionCount()).toBe(2);

    rm.leaveRoom('s1');
    expect(rm.getActiveConnectionCount()).toBe(1);
  });
});
