import { env } from '../config/env.js';

const LOG_LEVELS = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

const currentLevelPriority = LOG_LEVELS[env.LOG_LEVEL] ?? LOG_LEVELS.info;

function formatLog(level, message, context = {}) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    service: 'adpilot-backend',
    level,
    environment: env.NODE_ENV,
    message,
    ...context,
  };

  if (env.NODE_ENV === 'development') {
    const colorMap = {
      trace: '\x1b[90m',
      debug: '\x1b[36m',
      info: '\x1b[32m',
      warn: '\x1b[33m',
      error: '\x1b[31m',
      fatal: '\x1b[35m',
    };
    const reset = '\x1b[0m';
    const color = colorMap[level] || reset;
    const contextStr = Object.keys(context).length ? ` ${JSON.stringify(context)}` : '';
    return `${color}[${logEntry.timestamp}] [${level.toUpperCase()}]${reset} ${message}${contextStr}`;
  }

  return JSON.stringify(logEntry);
}

export const logger = {
  trace: (message, context) => {
    if (LOG_LEVELS.trace >= currentLevelPriority) {
      console.log(formatLog('trace', message, context));
    }
  },
  debug: (message, context) => {
    if (LOG_LEVELS.debug >= currentLevelPriority) {
      console.debug(formatLog('debug', message, context));
    }
  },
  info: (message, context) => {
    if (LOG_LEVELS.info >= currentLevelPriority) {
      console.info(formatLog('info', message, context));
    }
  },
  warn: (message, context) => {
    if (LOG_LEVELS.warn >= currentLevelPriority) {
      console.warn(formatLog('warn', message, context));
    }
  },
  error: (message, context) => {
    if (LOG_LEVELS.error >= currentLevelPriority) {
      console.error(formatLog('error', message, context));
    }
  },
  fatal: (message, context) => {
    if (LOG_LEVELS.fatal >= currentLevelPriority) {
      console.error(formatLog('fatal', message, context));
    }
  },
};

