/**
 * RoomManager — Maps quiz sessions to Socket.IO rooms.
 *
 * Manages the relationship between user socket connections and quiz sessions,
 * handling joins, disconnections, and reconnections.
 */

import type { Socket } from 'socket.io';
import { createLogger } from '../utils/logger';

const logger = createLogger('RoomManager');

interface UserConnection {
  socketId: string;
  userId: string;
  username: string;
  quizId: string;
}

export class RoomManager {
  /** Socket ID → UserConnection */
  private connections: Map<string, UserConnection> = new Map();
  /** User ID → Socket ID (for reconnection) */
  private userToSocket: Map<string, string> = new Map();

  /**
   * Add a user to a quiz room.
   */
  joinRoom(socket: Socket, quizId: string, userId: string, username: string): void {
    socket.join(quizId);

    const connection: UserConnection = {
      socketId: socket.id,
      userId,
      username,
      quizId,
    };

    this.connections.set(socket.id, connection);
    this.userToSocket.set(userId, socket.id);

    logger.info('User joined room', {
      socketId: socket.id,
      userId,
      username,
      quizId,
    });
  }

  /**
   * Remove a user when they disconnect.
   * Returns the connection info for cleanup.
   */
  leaveRoom(socketId: string): UserConnection | undefined {
    const connection = this.connections.get(socketId);
    if (connection) {
      this.connections.delete(socketId);
      this.userToSocket.delete(connection.userId);

      logger.info('User left room', {
        socketId,
        userId: connection.userId,
        quizId: connection.quizId,
      });
    }
    return connection;
  }

  /**
   * Get the connection info for a socket.
   */
  getConnection(socketId: string): UserConnection | undefined {
    return this.connections.get(socketId);
  }

  /**
   * Get the socket ID for a user (for reconnection).
   */
  getSocketIdForUser(userId: string): string | undefined {
    return this.userToSocket.get(userId);
  }

  /**
   * Get the room name (quiz ID) for a socket.
   */
  getQuizIdForSocket(socketId: string): string | undefined {
    return this.connections.get(socketId)?.quizId;
  }

  /**
   * Get all active connections count.
   */
  getActiveConnectionCount(): number {
    return this.connections.size;
  }
}
