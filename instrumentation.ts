/**
 * Next.js instrumentation file for server-side initialization
 * This file is automatically called when the server starts
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Initialize LogTape for server-side logging
    const { initializeLogger } = await import('./src/lib/logger');
    initializeLogger();
  }
}
