import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { once as onceEvent } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { io, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const PORT = 3300 + Math.floor(Math.random() * 1000);
const BASE_URL = `http://127.0.0.1:${PORT}`;

let serverProcess: ChildProcessWithoutNullStreams;
const serverOutput: string[] = [];
const sockets: Socket[] = [];

function connectSocket(): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = io(BASE_URL, {
      transports: ['websocket'],
      reconnection: false,
    });

    sockets.push(socket);
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });
}

function emitWithAck<TResponse>(socket: Socket, event: string, data: unknown): Promise<TResponse> {
  return new Promise((resolve) => {
    socket.emit(event, data, resolve);
  });
}

function onceSocket<TPayload>(socket: Socket, event: string): Promise<TPayload> {
  return new Promise((resolve) => {
    socket.once(event, resolve);
  });
}

async function waitForHealth(): Promise<void> {
  const deadline = Date.now() + 10000;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE_URL}/health`);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await delay(100);
  }

  throw new Error(`Server did not become healthy. Output:\n${serverOutput.join('')}`);
}

interface JoinResponse {
  success: boolean;
  userId: string;
  isHost: boolean;
  error?: string;
}

interface GenericResponse {
  success: boolean;
  error?: string;
}

interface QuestionPayload {
  questionId: string;
}

interface SubmitAnswerResponse {
  success: boolean;
  result: {
    correct: boolean;
    pointsEarned: number;
  };
  error?: string;
}

interface LeaderboardResponse {
  success: boolean;
  leaderboard: {
    entries: Array<{
      username: string;
      score: number;
    }>;
  };
  error?: string;
}

beforeAll(async () => {
  serverProcess = spawn(process.execPath, ['dist/index.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(PORT),
      LOG_LEVEL: 'error',
      REDIS_URL: '',
    },
  });

  serverProcess.stdout.on('data', (chunk) => serverOutput.push(chunk.toString()));
  serverProcess.stderr.on('data', (chunk) => serverOutput.push(chunk.toString()));

  await waitForHealth();
});

afterAll(async () => {
  for (const socket of sockets) {
    socket.disconnect();
  }

  if (serverProcess.exitCode === null) {
    serverProcess.kill('SIGINT');
    await Promise.race([onceEvent(serverProcess, 'exit'), delay(5000)]);
  }
});

describe('real-time quiz e2e', () => {
  it('runs join, host start, scoring, leaderboard, and reconnect through real sockets', async () => {
    const alice = await connectSocket();
    const bob = await connectSocket();

    const aliceJoin = await emitWithAck<JoinResponse>(alice, 'join_quiz', {
      quizId: 'vocab-101',
      username: 'Alice',
    });
    const bobJoin = await emitWithAck<JoinResponse>(bob, 'join_quiz', {
      quizId: 'vocab-101',
      username: 'Bob',
    });

    expect(aliceJoin.success).toBe(true);
    expect(aliceJoin.isHost).toBe(true);
    expect(bobJoin.success).toBe(true);
    expect(bobJoin.isHost).toBe(false);

    const bobStart = await emitWithAck<GenericResponse>(bob, 'start_quiz', { quizId: 'vocab-101' });
    expect(bobStart.success).toBe(false);

    const questions = Promise.all([
      onceSocket<QuestionPayload>(alice, 'question'),
      onceSocket<QuestionPayload>(bob, 'question'),
    ]);
    const aliceStart = await emitWithAck<GenericResponse>(alice, 'start_quiz', { quizId: 'vocab-101' });
    expect(aliceStart.success).toBe(true);

    const [question] = await questions;
    expect(question.questionId).toBe('q1');

    const aliceAnswer = await emitWithAck<SubmitAnswerResponse>(alice, 'submit_answer', {
      quizId: 'vocab-101',
      questionId: question.questionId,
      selectedOptionIndex: 1,
      clientTimestamp: Date.now(),
    });
    const bobAnswer = await emitWithAck<SubmitAnswerResponse>(bob, 'submit_answer', {
      quizId: 'vocab-101',
      questionId: question.questionId,
      selectedOptionIndex: 0,
      clientTimestamp: Date.now(),
    });

    expect(aliceAnswer.success).toBe(true);
    expect(aliceAnswer.result.correct).toBe(true);
    expect(aliceAnswer.result.pointsEarned).toBeGreaterThan(0);
    expect(bobAnswer.success).toBe(true);
    expect(bobAnswer.result.correct).toBe(false);
    expect(bobAnswer.result.pointsEarned).toBe(0);

    await delay(650);
    const leaderboard = await emitWithAck<LeaderboardResponse>(alice, 'get_leaderboard', { quizId: 'vocab-101' });
    expect(leaderboard.success).toBe(true);
    expect(leaderboard.leaderboard.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ username: 'Alice' }),
        expect.objectContaining({ username: 'Bob', score: 0 }),
      ]),
    );

    alice.disconnect();
    await delay(100);

    const aliceReconnect = await connectSocket();
    const reconnect = await emitWithAck<JoinResponse>(aliceReconnect, 'join_quiz', {
      quizId: 'vocab-101',
      username: 'Alice',
      userId: aliceJoin.userId,
    });

    expect(reconnect.success).toBe(true);
    expect(reconnect.userId).toBe(aliceJoin.userId);
    expect(reconnect.isHost).toBe(true);
  });
});
