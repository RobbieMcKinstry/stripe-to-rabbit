import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StripeEventWorker } from './stripe-event-worker';
import type { RabbitMQConsumerConfig } from './types';
import type Stripe from 'stripe';
import type * as amqp from 'amqplib';

// Mock amqplib
vi.mock('amqplib', () => ({
  connect: vi.fn(),
}));

// Mock LogTape
vi.mock('@logtape/logtape', () => ({
  getLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  })),
}));

// Test implementation of StripeEventWorker
class TestStripeEventWorker extends StripeEventWorker {
  public handleCustomerCreatedCalled = false;
  public handlePaymentIntentSucceededCalled = false;
  public lastCustomerEvent: Stripe.CustomerCreatedEvent | null = null;
  public lastPaymentIntentEvent: Stripe.PaymentIntentSucceededEvent | null = null;

  protected async handleCustomerCreated(event: Stripe.CustomerCreatedEvent): Promise<void> {
    this.handleCustomerCreatedCalled = true;
    this.lastCustomerEvent = event;
  }

  protected async handlePaymentIntentSucceeded(event: Stripe.PaymentIntentSucceededEvent): Promise<void> {
    this.handlePaymentIntentSucceededCalled = true;
    this.lastPaymentIntentEvent = event;
  }
}

describe('StripeEventWorker', () => {
  let mockChannel: any;
  let mockConnection: any;
  let config: RabbitMQConsumerConfig;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Create mock channel
    mockChannel = {
      assertQueue: vi.fn().mockResolvedValue(undefined),
      prefetch: vi.fn().mockResolvedValue(undefined),
      consume: vi.fn().mockResolvedValue(undefined),
      ack: vi.fn(),
      nack: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    };

    // Create mock connection
    mockConnection = {
      createChannel: vi.fn().mockResolvedValue(mockChannel),
      on: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    };

    // Mock amqplib.connect
    const amqplib = await import('amqplib');
    vi.mocked(amqplib.connect).mockResolvedValue(mockConnection);

    // Default config
    config = {
      hostname: 'localhost',
      port: 5672,
      username: 'guest',
      password: 'guest',
      queue: 'test.queue',
      prefetchCount: 1,
    };
  });

  afterEach(async () => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should create a new instance with config', () => {
      const worker = new TestStripeEventWorker(config);
      expect(worker).toBeInstanceOf(StripeEventWorker);
      expect(worker).toBeInstanceOf(TestStripeEventWorker);
    });

    it('should initialize with empty stats', () => {
      const worker = new TestStripeEventWorker(config);
      const stats = worker.getStats();
      expect(stats.messagesConsumed).toBe(0);
      expect(stats.messagesAcknowledged).toBe(0);
      expect(stats.messagesRejected).toBe(0);
      expect(stats.totalErrors).toBe(0);
      expect(stats.startTime).toBeInstanceOf(Date);
    });
  });

  describe('consume', () => {
    it('should connect to RabbitMQ and start consuming', async () => {
      const worker = new TestStripeEventWorker(config);

      // Start consuming (don't await as it runs forever)
      const consumePromise = worker.consume();

      // Wait a bit for connection
      await new Promise((resolve) => setTimeout(resolve, 10));

      const amqplib = await import('amqplib');
      expect(amqplib.connect).toHaveBeenCalledWith(
        expect.stringContaining('amqp://guest:guest@localhost:5672'),
        expect.objectContaining({
          heartbeat: 60,
          timeout: 10000,
        })
      );

      expect(mockChannel.prefetch).toHaveBeenCalledWith(1);
      expect(mockChannel.assertQueue).toHaveBeenCalledWith('test.queue', { durable: true });
      expect(mockChannel.consume).toHaveBeenCalledWith(
        'test.queue',
        expect.any(Function),
        { noAck: false }
      );

      await worker.close();
    });

    it('should use SSL when configured', async () => {
      const sslConfig = { ...config, useSSL: true };
      const worker = new TestStripeEventWorker(sslConfig);

      const consumePromise = worker.consume();
      await new Promise((resolve) => setTimeout(resolve, 10));

      const amqplib = await import('amqplib');
      expect(amqplib.connect).toHaveBeenCalledWith(
        expect.stringContaining('amqps://'),
        expect.any(Object)
      );

      await worker.close();
    });

    it('should use custom vhost', async () => {
      const vhostConfig = { ...config, vhost: '/custom' };
      const worker = new TestStripeEventWorker(vhostConfig);

      const consumePromise = worker.consume();
      await new Promise((resolve) => setTimeout(resolve, 10));

      const amqplib = await import('amqplib');
      expect(amqplib.connect).toHaveBeenCalledWith(
        expect.stringContaining('/custom'),
        expect.any(Object)
      );

      await worker.close();
    });

    it('should use custom prefetch count', async () => {
      const prefetchConfig = { ...config, prefetchCount: 10 };
      const worker = new TestStripeEventWorker(prefetchConfig);

      const consumePromise = worker.consume();
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockChannel.prefetch).toHaveBeenCalledWith(10);

      await worker.close();
    });
  });

  describe('message processing', () => {
    it('should process customer.created event', async () => {
      const worker = new TestStripeEventWorker(config);

      // Create a mock customer.created event
      const customerEvent: Stripe.CustomerCreatedEvent = {
        id: 'evt_test_123',
        object: 'event',
        type: 'customer.created',
        created: Date.now() / 1000,
        livemode: false,
        pending_webhooks: 0,
        request: null,
        api_version: '2025-01-27.acacia',
        data: {
          object: {
            id: 'cus_test_123',
            object: 'customer',
            email: 'test@example.com',
          } as Stripe.Customer,
        },
      };

      // Start consuming
      const consumePromise = worker.consume();
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Get the consumer callback
      const consumerCallback = mockChannel.consume.mock.calls[0][1];

      // Create a mock message
      const mockMessage = {
        content: Buffer.from(JSON.stringify(customerEvent)),
        properties: { messageId: 'msg_123' },
        fields: {},
      };

      // Process the message
      await consumerCallback(mockMessage);

      // Verify handler was called
      expect(worker.handleCustomerCreatedCalled).toBe(true);
      expect(worker.lastCustomerEvent).toEqual(customerEvent);

      // Verify message was acknowledged
      expect(mockChannel.ack).toHaveBeenCalledWith(mockMessage);

      // Verify stats
      const stats = worker.getStats();
      expect(stats.messagesConsumed).toBe(1);
      expect(stats.messagesAcknowledged).toBe(1);
      expect(stats.messagesRejected).toBe(0);
      expect(stats.totalErrors).toBe(0);
      expect(stats.lastMessageTime).toBeInstanceOf(Date);

      await worker.close();
    });

    it('should process payment_intent.succeeded event', async () => {
      const worker = new TestStripeEventWorker(config);

      const paymentIntentEvent: Stripe.PaymentIntentSucceededEvent = {
        id: 'evt_test_456',
        object: 'event',
        type: 'payment_intent.succeeded',
        created: Date.now() / 1000,
        livemode: false,
        pending_webhooks: 0,
        request: null,
        api_version: '2025-01-27.acacia',
        data: {
          object: {
            id: 'pi_test_456',
            object: 'payment_intent',
            amount: 1000,
            currency: 'usd',
            status: 'succeeded',
          } as Stripe.PaymentIntent,
        },
      };

      const consumePromise = worker.consume();
      await new Promise((resolve) => setTimeout(resolve, 10));

      const consumerCallback = mockChannel.consume.mock.calls[0][1];
      const mockMessage = {
        content: Buffer.from(JSON.stringify(paymentIntentEvent)),
        properties: { messageId: 'msg_456' },
        fields: {},
      };

      await consumerCallback(mockMessage);

      expect(worker.handlePaymentIntentSucceededCalled).toBe(true);
      expect(worker.lastPaymentIntentEvent).toEqual(paymentIntentEvent);
      expect(mockChannel.ack).toHaveBeenCalledWith(mockMessage);

      await worker.close();
    });

    it('should handle malformed JSON by nacking the message', async () => {
      const worker = new TestStripeEventWorker(config);

      const consumePromise = worker.consume();
      await new Promise((resolve) => setTimeout(resolve, 10));

      const consumerCallback = mockChannel.consume.mock.calls[0][1];
      const mockMessage = {
        content: Buffer.from('invalid json{'),
        properties: { messageId: 'msg_bad' },
        fields: {},
      };

      await consumerCallback(mockMessage);

      // Message should be nacked and requeued
      expect(mockChannel.nack).toHaveBeenCalledWith(mockMessage, false, true);

      // Stats should reflect error
      const stats = worker.getStats();
      expect(stats.messagesConsumed).toBe(1);
      expect(stats.messagesRejected).toBe(1);
      expect(stats.totalErrors).toBe(1);

      await worker.close();
    });

    it('should handle null messages gracefully', async () => {
      const worker = new TestStripeEventWorker(config);

      const consumePromise = worker.consume();
      await new Promise((resolve) => setTimeout(resolve, 10));

      const consumerCallback = mockChannel.consume.mock.calls[0][1];

      // Call with null message (consumer cancelled)
      await consumerCallback(null);

      // Should not crash or ack/nack anything
      expect(mockChannel.ack).not.toHaveBeenCalled();
      expect(mockChannel.nack).not.toHaveBeenCalled();

      await worker.close();
    });

    it('should process multiple messages in sequence', async () => {
      const worker = new TestStripeEventWorker(config);

      const consumePromise = worker.consume();
      await new Promise((resolve) => setTimeout(resolve, 10));

      const consumerCallback = mockChannel.consume.mock.calls[0][1];

      // Process 3 messages
      for (let i = 0; i < 3; i++) {
        const event: Stripe.CustomerCreatedEvent = {
          id: `evt_test_${i}`,
          object: 'event',
          type: 'customer.created',
          created: Date.now() / 1000,
          livemode: false,
          pending_webhooks: 0,
          request: null,
          api_version: '2025-01-27.acacia',
          data: {
            object: {
              id: `cus_test_${i}`,
              object: 'customer',
            } as Stripe.Customer,
          },
        };

        const mockMessage = {
          content: Buffer.from(JSON.stringify(event)),
          properties: { messageId: `msg_${i}` },
          fields: {},
        };

        await consumerCallback(mockMessage);
      }

      const stats = worker.getStats();
      expect(stats.messagesConsumed).toBe(3);
      expect(stats.messagesAcknowledged).toBe(3);

      await worker.close();
    });
  });

  describe('close', () => {
    it('should close channel and connection', async () => {
      const worker = new TestStripeEventWorker(config);

      const consumePromise = worker.consume();
      await new Promise((resolve) => setTimeout(resolve, 10));

      await worker.close();

      expect(mockChannel.close).toHaveBeenCalled();
      expect(mockConnection.close).toHaveBeenCalled();
    });

    it('should handle close when not connected', async () => {
      const worker = new TestStripeEventWorker(config);

      // Close without connecting
      await expect(worker.close()).resolves.not.toThrow();
    });
  });

  describe('getStats', () => {
    it('should return a copy of stats (not the original)', () => {
      const worker = new TestStripeEventWorker(config);
      const stats1 = worker.getStats();
      const stats2 = worker.getStats();

      expect(stats1).not.toBe(stats2); // Different objects
      expect(stats1).toEqual(stats2); // But equal content
    });
  });

  describe('default event handlers', () => {
    it('should acknowledge events with no custom handler', async () => {
      // Use base StripeEventWorker without overriding any handlers
      class NoOpWorker extends StripeEventWorker {}

      const worker = new NoOpWorker(config);

      const consumePromise = worker.consume();
      await new Promise((resolve) => setTimeout(resolve, 10));

      const consumerCallback = mockChannel.consume.mock.calls[0][1];

      // Send an event with no custom handler
      const event: Stripe.InvoiceCreatedEvent = {
        id: 'evt_invoice',
        object: 'event',
        type: 'invoice.created',
        created: Date.now() / 1000,
        livemode: false,
        pending_webhooks: 0,
        request: null,
        api_version: '2025-01-27.acacia',
        data: {
          object: {
            id: 'in_test',
            object: 'invoice',
          } as Stripe.Invoice,
        },
      };

      const mockMessage = {
        content: Buffer.from(JSON.stringify(event)),
        properties: { messageId: 'msg_invoice' },
        fields: {},
      };

      await consumerCallback(mockMessage);

      // Should still acknowledge even though no custom logic
      expect(mockChannel.ack).toHaveBeenCalledWith(mockMessage);

      await worker.close();
    });
  });

  describe('error handling in custom handlers', () => {
    it('should nack message if custom handler throws error', async () => {
      class ErrorWorker extends StripeEventWorker {
        protected async handleCustomerCreated(event: Stripe.CustomerCreatedEvent): Promise<void> {
          throw new Error('Handler error');
        }
      }

      const worker = new ErrorWorker(config);

      const consumePromise = worker.consume();
      await new Promise((resolve) => setTimeout(resolve, 10));

      const consumerCallback = mockChannel.consume.mock.calls[0][1];

      const event: Stripe.CustomerCreatedEvent = {
        id: 'evt_test',
        object: 'event',
        type: 'customer.created',
        created: Date.now() / 1000,
        livemode: false,
        pending_webhooks: 0,
        request: null,
        api_version: '2025-01-27.acacia',
        data: {
          object: {
            id: 'cus_test',
            object: 'customer',
          } as Stripe.Customer,
        },
      };

      const mockMessage = {
        content: Buffer.from(JSON.stringify(event)),
        properties: { messageId: 'msg_error' },
        fields: {},
      };

      await consumerCallback(mockMessage);

      // Should nack and requeue
      expect(mockChannel.nack).toHaveBeenCalledWith(mockMessage, false, true);

      const stats = worker.getStats();
      expect(stats.totalErrors).toBe(1);
      expect(stats.messagesRejected).toBe(1);

      await worker.close();
    });
  });
});
