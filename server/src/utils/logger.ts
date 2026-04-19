/**
 * Structured logger utility.
 * Provides consistent JSON logging with correlation IDs and log levels.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

class Logger {
  private minLevel: number;
  private context: string;

  constructor(context: string, level: LogLevel = 'info') {
    this.context = context;
    this.minLevel = LOG_LEVELS[level];
  }

  private log(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
    if (LOG_LEVELS[level] < this.minLevel) return;

    const entry = {
      timestamp: new Date().toISOString(),
      level,
      context: this.context,
      message,
      ...meta,
    };

    const output = JSON.stringify(entry);

    switch (level) {
      case 'error':
        console.error(output);
        break;
      case 'warn':
        console.warn(output);
        break;
      default:
        console.log(output);
    }
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    this.log('debug', message, meta);
  }

  info(message: string, meta?: Record<string, unknown>): void {
    this.log('info', message, meta);
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    this.log('warn', message, meta);
  }

  error(message: string, meta?: Record<string, unknown>): void {
    this.log('error', message, meta);
  }

  child(context: string): Logger {
    return new Logger(`${this.context}:${context}`, this.levelName());
  }

  private levelName(): LogLevel {
    return (Object.entries(LOG_LEVELS).find(([, v]) => v === this.minLevel)?.[0] as LogLevel) || 'info';
  }
}

export function createLogger(context: string, level?: LogLevel): Logger {
  return new Logger(context, level || (process.env.LOG_LEVEL as LogLevel) || 'info');
}

export { Logger };
