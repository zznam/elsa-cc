/**
 * RoomManager — Maps quiz sessions to Socket.IO rooms.
 *
 * Manages the relationship between user socket connections and quiz sessions,
 * handling joins, disconnections, and reconnections.
 */

import type { Socket } from 'socket.io';
import { createLogger } from '../utils/logger';

const logger = createLogger('RoomManager');

export interface UserConnection {
  socketId: string;
  userId: string;
  username: string;
  quizId: string;
}

export class RoomManager {
  /** Socket ID → UserConnection */
  private connections: Map<string, UserConnection> = new Map();
  /** User ID → Socket ID (powers targeted emits like selfRank) */
  private userToSocket: Map<string, string> = new Map();
  /** Quiz ID → set of socket IDs in that room */
  private quizToSockets: Map<string, Set<string>> = new Map();

  joinRoom(socket: Socket, quizId: string, userId: string, username: string): void {
    socket.join(quizId);

    // If a previous socket for this user is still tracked (stale reconnect),
    // evict it so we keep a single authoritative mapping per user.
    const previousSocketId = this.userToSocket.get(userId);
    if (previousSocketId && previousSocketId !== socket.id) {
      this.removeConnection(previousSocketId);
    }

    const connection: UserConnection = {
      socketId: socket.id,
      userId,
      username,
      quizId,
    };

    this.connections.set(socket.id, connection);
    this.userToSocket.set(userId, socket.id);

    let roomSockets = this.quizToSockets.get(quizId);
    if (!roomSockets) {
      roomSockets = new Set();
      this.quizToSockets.set(quizId, roomSockets);
    }
    roomSockets.add(socket.id);

    logger.info('User joined room', {
      socketId: socket.id,
      userId,
      username,
      quizId,
    });
  }

  /** Returns the connection info for cleanup if the socket was tracked. */
  leaveRoom(socketId: string): UserConnection | undefined {
    const connection = this.removeConnection(socketId);
    if (connection) {
      logger.info('User left room', {
        socketId,
        userId: connection.userId,
        quizId: connection.quizId,
      });
    }
    return connection;
  }

  private removeConnection(socketId: string): UserConnection | undefined {
    const connection = this.connections.get(socketId);
    if (!connection) return undefined;

    this.connections.delete(socketId);
    // Only clear the user→socket mapping if it still points here — a newer
    // reconnection may have already overwritten it.
    if (this.userToSocket.get(connection.userId) === socketId) {
      this.userToSocket.delete(connection.userId);
    }

    const roomSockets = this.quizToSockets.get(connection.quizId);
    if (roomSockets) {
      roomSockets.delete(socketId);
      if (roomSockets.size === 0) this.quizToSockets.delete(connection.quizId);
    }

    return connection;
  }

  getConnection(socketId: string): UserConnection | undefined {
    return this.connections.get(socketId);
  }

  getSocketIdForUser(userId: string): string | undefined {
    return this.userToSocket.get(userId);
  }

  getQuizIdForSocket(socketId: string): string | undefined {
    return this.connections.get(socketId)?.quizId;
  }

  /** All active connections in a quiz room — used for per-socket emits. */
  getConnectionsForQuiz(quizId: string): UserConnection[] {
    const sockets = this.quizToSockets.get(quizId);
    if (!sockets) return [];
    const out: UserConnection[] = [];
    for (const socketId of sockets) {
      const conn = this.connections.get(socketId);
      if (conn) out.push(conn);
    }
    return out;
  }

  getActiveConnectionCount(): number {
    return this.connections.size;
  }
}
