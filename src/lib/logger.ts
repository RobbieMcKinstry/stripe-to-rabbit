import { configure, getConsoleSink } from '@logtape/logtape';
import { getPrettySink } from '@logtape/pretty';
import { config } from '@/config';

// Map our log levels to LogTape log levels
const logLevelMap = {
  debug: 'debug',
  info: 'info',
  warning: 'warning',
  error: 'error',
  fatal: 'fatal',
} as const;

/**
 * Initialize LogTape with pretty console logging
 */
export function initializeLogger() {
  const logLevel = logLevelMap[config.LOG_LEVEL];

  configure({
    sinks: {
      console: getPrettySink({
        // Use colored output in development
        colors: config.NODE_ENV === 'development',
      }),
    },
    filters: {},
    loggers: [
      {
        category: ['stripe-to-rabbit'],
        level: logLevel,
        sinks: ['console'],
      },
      {
        category: ['stripe-to-rabbit', 'config'],
        level: logLevel,
        sinks: ['console'],
      },
      {
        category: ['stripe-to-rabbit', 'rabbitmq'],
        level: logLevel,
        sinks: ['console'],
      },
      {
        category: ['stripe-to-rabbit', 'webhook'],
        level: logLevel,
        sinks: ['console'],
      },
      {
        category: ['stripe-to-rabbit', 'app'],
        level: logLevel,
        sinks: ['console'],
      },
    ],
  });
}

// Initialize the logger when this module is imported
if (typeof window === 'undefined') {
  // Only initialize on the server side
  initializeLogger();
}
