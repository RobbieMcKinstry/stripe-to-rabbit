import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getRabbitMQClient, closeRabbitMQClient } from './rabbitmq';
import type Stripe from 'stripe';

// Mock amqplib
vi.mock('amqplib', () => ({
  default: {
    connect: vi.fn(),
  },
}));

// Mock config
vi.mock('@/config', () => ({
  config: {
    RABBITMQ_EXCHANGE: 'test.events',
    RABBITMQ_EXCHANGE_TYPE: 'topic',
    RABBITMQ_QUEUE: 'test.webhooks',
    RABBITMQ_ROUTING_KEY: 'test.webhook',
    RABBITMQ_HEARTBEAT: '60',
    RABBITMQ_CONNECTION_TIMEOUT: '10000',
  },
  getRabbitMQConnectionUrl: vi.fn(() => 'amqp://test:test@localhost:5672/'),
}));

describe('RabbitMQ Client', () => {
  let mockChannel: any;
  let mockConnection: any;

  beforeEach(async () => {
    // Reset modules to ensure clean state
    vi.resetModules();

    // Create mock channel with all required methods
    mockChannel = {
      assertExchange: vi.fn().mockResolvedValue(undefined),
      assertQueue: vi.fn().mockResolvedValue(undefined),
      bindQueue: vi.fn().mockResolvedValue(undefined),
      publish: vi.fn().mockReturnValue(true),
      close: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
    };

    // Create mock connection
    mockConnection = {
      createChannel: vi.fn().mockResolvedValue(mockChannel),
      close: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
    };

    // Mock amqplib.connect
    const amqp = await import('amqplib');
    vi.mocked(amqp.default.connect).mockResolvedValue(mockConnection as any);
  });

  afterEach(async () => {
    await closeRabbitMQClient();
  });

  it('should create a singleton instance', () => {
    const client1 = getRabbitMQClient();
    const client2 = getRabbitMQClient();

    expect(client1).toBe(client2);
  });

  it('should establish connection and configure exchange/queue on first publish', async () => {
    const client = getRabbitMQClient();

    const mockEvent: Stripe.Event = {
      id: 'evt_test_123',
      type: 'customer.created',
      created: 1234567890,
      data: { object: {} },
      livemode: false,
      object: 'event',
      pending_webhooks: 0,
      request: null,
      api_version: '2025-01-27.acacia',
    };

    await client.publishStripeEvent(mockEvent);

    // Verify connection was established
    const amqp = await import('amqplib');
    expect(amqp.default.connect).toHaveBeenCalledWith(
      'amqp://test:test@localhost:5672/',
      expect.objectContaining({
        heartbeat: 60,
        timeout: 10000,
      })
    );

    // Verify channel creation
    expect(mockConnection.createChannel).toHaveBeenCalled();

    // Verify exchange assertion
    expect(mockChannel.assertExchange).toHaveBeenCalledWith('test.events', 'topic', {
      durable: true,
    });

    // Verify queue assertion
    expect(mockChannel.assertQueue).toHaveBeenCalledWith('test.webhooks', {
      durable: true,
    });

    // Verify queue binding
    expect(mockChannel.bindQueue).toHaveBeenCalledWith(
      'test.webhooks',
      'test.events',
      'test.webhook'
    );
  });

  it('should publish event to RabbitMQ with correct routing key', async () => {
    const client = getRabbitMQClient();

    const mockEvent: Stripe.Event = {
      id: 'evt_test_456',
      type: 'payment_intent.succeeded',
      created: 1234567890,
      data: { object: {} },
      livemode: false,
      object: 'event',
      pending_webhooks: 0,
      request: null,
      api_version: '2025-01-27.acacia',
    };

    await client.publishStripeEvent(mockEvent);

    // Verify publish was called with correct parameters
    expect(mockChannel.publish).toHaveBeenCalledWith(
      'test.events',
      'stripe.webhook.payment_intent.succeeded',
      expect.any(Buffer),
      expect.objectContaining({
        persistent: true,
        contentType: 'application/json',
        timestamp: expect.any(Number),
        messageId: 'evt_test_456',
        type: 'payment_intent.succeeded',
        headers: {
          'x-stripe-event-id': 'evt_test_456',
          'x-stripe-event-type': 'payment_intent.succeeded',
        },
      })
    );

    // Verify message content
    const publishCall = vi.mocked(mockChannel.publish).mock.calls[0];
    const messageBuffer = publishCall[2] as Buffer;
    const message = JSON.parse(messageBuffer.toString());

    expect(message).toEqual(
      expect.objectContaining({
        id: 'evt_test_456',
        type: 'payment_intent.succeeded',
        created: 1234567890,
      })
    );
  });

  it('should throw error when channel buffer is full', async () => {
    mockChannel.publish.mockReturnValue(false);

    const client = getRabbitMQClient();

    const mockEvent: Stripe.Event = {
      id: 'evt_test_789',
      type: 'customer.deleted',
      created: 1234567890,
      data: { object: {} },
      livemode: false,
      object: 'event',
      pending_webhooks: 0,
      request: null,
      api_version: '2025-01-27.acacia',
    };

    await expect(client.publishStripeEvent(mockEvent)).rejects.toThrow(
      'Failed to publish message to RabbitMQ (channel buffer full)'
    );
  });

  it('should reuse existing connection for subsequent publishes', async () => {
    const client = getRabbitMQClient();

    const mockEvent: Stripe.Event = {
      id: 'evt_test_1',
      type: 'customer.created',
      created: 1234567890,
      data: { object: {} },
      livemode: false,
      object: 'event',
      pending_webhooks: 0,
      request: null,
      api_version: '2025-01-27.acacia',
    };

    await client.publishStripeEvent(mockEvent);
    await client.publishStripeEvent(mockEvent);

    const amqp = await import('amqplib');
    // Connection should only be called once
    expect(amqp.default.connect).toHaveBeenCalledTimes(1);
  });

  it('should close connection properly', async () => {
    const client = getRabbitMQClient();

    const mockEvent: Stripe.Event = {
      id: 'evt_test_close',
      type: 'customer.created',
      created: 1234567890,
      data: { object: {} },
      livemode: false,
      object: 'event',
      pending_webhooks: 0,
      request: null,
      api_version: '2025-01-27.acacia',
    };

    await client.publishStripeEvent(mockEvent);
    await client.close();

    expect(mockChannel.close).toHaveBeenCalled();
    expect(mockConnection.close).toHaveBeenCalled();
  });
});
