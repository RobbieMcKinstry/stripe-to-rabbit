import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock logger to avoid initialization issues
vi.mock('@/lib/logger', () => ({
  initializeLogger: vi.fn(),
}));

describe('Config Module', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    // Create a fresh copy of process.env
    process.env = { ...originalEnv };
    // Clear all env vars that might interfere with tests
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.RABBITMQ_HOST;
    delete process.env.RABBITMQ_USER;
    delete process.env.RABBITMQ_PASSWORD;
    delete process.env.RABBITMQ_USE_SSL;
    delete process.env.RABBITMQ_PORT;
    delete process.env.RABBITMQ_VHOST;
    delete process.env.RABBITMQ_HEARTBEAT;
    delete process.env.RABBITMQ_CONNECTION_TIMEOUT;
    delete process.env.NODE_ENV;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should validate required environment variables', async () => {
    // Set required environment variables
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_123';
    process.env.RABBITMQ_HOST = 'localhost';
    process.env.RABBITMQ_USER = 'guest';
    process.env.RABBITMQ_PASSWORD = 'password';

    const { config } = await import('./index');

    expect(config.STRIPE_SECRET_KEY).toBe('sk_test_123');
    expect(config.STRIPE_WEBHOOK_SECRET).toBe('whsec_123');
    expect(config.RABBITMQ_HOST).toBe('localhost');
    expect(config.RABBITMQ_USER).toBe('guest');
    expect(config.RABBITMQ_PASSWORD).toBe('password');
  });

  it('should apply default values for optional environment variables', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_123';
    process.env.RABBITMQ_HOST = 'localhost';
    process.env.RABBITMQ_USER = 'guest';
    process.env.RABBITMQ_PASSWORD = 'password';

    const { config } = await import('./index');

    expect(config.NODE_ENV).toBe('development');
    expect(config.PORT).toBe('3000');
    expect(config.LOG_LEVEL).toBe('info');
    expect(config.RABBITMQ_PORT).toBe('5672');
    expect(config.RABBITMQ_VHOST).toBe('/');
    expect(config.RABBITMQ_EXCHANGE).toBe('stripe.events');
    expect(config.RABBITMQ_EXCHANGE_TYPE).toBe('topic');
    expect(config.RABBITMQ_QUEUE).toBe('stripe.webhooks');
    expect(config.RABBITMQ_ROUTING_KEY).toBe('stripe.webhook');
    expect(config.RABBITMQ_USE_SSL).toBe(false);
    expect(config.RABBITMQ_CONNECTION_TIMEOUT).toBe('10000');
    expect(config.RABBITMQ_HEARTBEAT).toBe('60');
  });

  it('should throw error when required environment variable is missing', async () => {
    // Missing STRIPE_SECRET_KEY
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_123';
    process.env.RABBITMQ_HOST = 'localhost';
    process.env.RABBITMQ_USER = 'guest';
    process.env.RABBITMQ_PASSWORD = 'password';

    await expect(async () => {
      await import('./index');
    }).rejects.toThrow();
  });

  it('should build RabbitMQ connection URL correctly', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_123';
    process.env.RABBITMQ_HOST = 'rabbitmq.example.com';
    process.env.RABBITMQ_PORT = '5672';
    process.env.RABBITMQ_USER = 'testuser';
    process.env.RABBITMQ_PASSWORD = 'testpass';
    process.env.RABBITMQ_VHOST = '/test';
    process.env.RABBITMQ_USE_SSL = 'false';

    const { getRabbitMQConnectionUrl } = await import('./index');

    const url = getRabbitMQConnectionUrl();
    expect(url).toBe('amqp://testuser:testpass@rabbitmq.example.com:5672%2Ftest');
  });

  it('should use amqps protocol when SSL is enabled', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_123';
    process.env.RABBITMQ_HOST = 'rabbitmq.example.com';
    process.env.RABBITMQ_USER = 'testuser';
    process.env.RABBITMQ_PASSWORD = 'testpass';
    process.env.RABBITMQ_USE_SSL = 'true';

    const { getRabbitMQConnectionUrl } = await import('./index');

    const url = getRabbitMQConnectionUrl();
    expect(url).toContain('amqps://');
  });

  it('should return correct RabbitMQ connection config', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_123';
    process.env.RABBITMQ_HOST = 'rabbitmq.example.com';
    process.env.RABBITMQ_PORT = '5673';
    process.env.RABBITMQ_USER = 'testuser';
    process.env.RABBITMQ_PASSWORD = 'testpass';
    process.env.RABBITMQ_VHOST = '/custom';
    process.env.RABBITMQ_HEARTBEAT = '30';
    process.env.RABBITMQ_CONNECTION_TIMEOUT = '5000';
    process.env.RABBITMQ_USE_SSL = 'false';

    const { getRabbitMQConnectionConfig } = await import('./index');

    const connectionConfig = getRabbitMQConnectionConfig();

    expect(connectionConfig).toEqual({
      protocol: 'amqp',
      hostname: 'rabbitmq.example.com',
      port: 5673,
      username: 'testuser',
      password: 'testpass',
      vhost: '/custom',
      heartbeat: 30,
      connectionTimeout: 5000,
    });
  });
});
