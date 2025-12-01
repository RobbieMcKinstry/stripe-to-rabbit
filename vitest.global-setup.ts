import { execSync, spawn, ChildProcess } from 'child_process';
import { resolve } from 'path';

let devServer: ChildProcess | null = null;

export async function setup() {
  console.log('Starting Next.js dev server for tests...');

  // Start the Next.js dev server with test environment variables
  devServer = spawn('pnpm', ['dev'], {
    cwd: resolve(__dirname),
    stdio: 'pipe',
    env: {
      ...process.env,
      NODE_ENV: 'development',
      PORT: '3000',
      // Test Stripe configuration
      STRIPE_SECRET_KEY: 'sk_test_1234567890',
      STRIPE_WEBHOOK_SECRET: 'whsec_test_secret_12345678901234567890123456789012',
      // Test RabbitMQ configuration (using localhost for tests)
      RABBITMQ_HOST: 'localhost',
      RABBITMQ_PORT: '5672',
      RABBITMQ_USER: 'guest',
      RABBITMQ_PASSWORD: 'guest',
      RABBITMQ_VHOST: '/',
      RABBITMQ_EXCHANGE: 'stripe.events.test',
      RABBITMQ_QUEUE: 'stripe.webhooks.test',
      RABBITMQ_ROUTING_KEY: 'stripe.webhook.test',
    },
  });

  // Wait for the server to be ready
  await waitForServer('http://localhost:3000', 60000);

  console.log('Next.js dev server is ready');
}

export async function teardown() {
  console.log('Shutting down Next.js dev server...');

  if (devServer) {
    devServer.kill('SIGTERM');
    devServer = null;
  }

  console.log('Next.js dev server stopped');
}

async function waitForServer(url: string, timeout: number): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    try {
      const response = await fetch(url);
      if (response.ok || response.status === 404) {
        // Server is responding (404 is fine, means server is up)
        return;
      }
    } catch (error) {
      // Server not ready yet, continue waiting
    }

    // Wait 500ms before trying again
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`Server at ${url} did not start within ${timeout}ms`);
}
