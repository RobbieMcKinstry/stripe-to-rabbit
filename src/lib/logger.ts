import { configure, getConsoleSink } from '@logtape/logtape';
import { getPrettyFormatter } from '@logtape/pretty';
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
      console: getConsoleSink({
        formatter: getPrettyFormatter({
          // Use colored output in development
          colors: config.NODE_ENV === 'development',
        }),
      }),
    },
    filters: {},
    loggers: [
      {
        category: ['stripe-to-rabbit'],
        lowestLevel: logLevel,
        sinks: ['console'],
      },
      {
        category: ['stripe-to-rabbit', 'config'],
        lowestLevel: logLevel,
        sinks: ['console'],
      },
      {
        category: ['stripe-to-rabbit', 'rabbitmq'],
        lowestLevel: logLevel,
        sinks: ['console'],
      },
      {
        category: ['stripe-to-rabbit', 'webhook'],
        lowestLevel: logLevel,
        sinks: ['console'],
      },
      {
        category: ['stripe-to-rabbit', 'app'],
        lowestLevel: logLevel,
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
