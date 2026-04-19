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

  /** Returns the connection info for cleanup if the socket was tracked. */
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


  getConnection(socketId: string): UserConnection | undefined {
    return this.connections.get(socketId);
  }


  getSocketIdForUser(userId: string): string | undefined {
    return this.userToSocket.get(userId);
  }


  getQuizIdForSocket(socketId: string): string | undefined {
    return this.connections.get(socketId)?.quizId;
  }


  getActiveConnectionCount(): number {
    return this.connections.size;
  }
}
