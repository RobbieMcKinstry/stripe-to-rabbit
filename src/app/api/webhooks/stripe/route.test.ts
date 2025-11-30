import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST, GET } from './route';
import { NextRequest } from 'next/server';

// Mock dependencies
vi.mock('stripe', () => {
  const mockStripe = {
    webhooks: {
      constructEvent: vi.fn(),
    },
  };
  return {
    default: vi.fn(() => mockStripe),
  };
});

vi.mock('@/config', () => ({
  config: {
    STRIPE_SECRET_KEY: 'sk_test_123',
    STRIPE_WEBHOOK_SECRET: 'whsec_123',
    STRIPE_API_VERSION: '2025-01-27.acacia',
  },
}));

vi.mock('@/lib/rabbitmq', () => ({
  getRabbitMQClient: vi.fn(() => ({
    publishStripeEvent: vi.fn().mockResolvedValue(undefined),
  })),
}));

describe('Stripe Webhook Route Handler', () => {
  const mockEventId = 'evt_test_123';
  const mockEventType = 'customer.created';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('POST /api/webhooks/stripe', () => {
    it('should successfully process a valid webhook', async () => {
      const mockEvent = {
        id: mockEventId,
        type: mockEventType,
        created: 1234567890,
        data: { object: {} },
        livemode: false,
        object: 'event',
        pending_webhooks: 0,
        request: null,
        api_version: '2025-01-27.acacia',
      };

      const Stripe = (await import('stripe')).default;
      const mockStripeInstance = new Stripe('sk_test_123', {} as any);
      vi.mocked(mockStripeInstance.webhooks.constructEvent).mockReturnValue(mockEvent as any);

      const mockRequest = {
        text: vi.fn().mockResolvedValue('{"test": "data"}'),
        headers: new Headers({
          'stripe-signature': 'test-signature',
        }),
      } as unknown as NextRequest;

      const response = await POST(mockRequest);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({
        received: true,
        eventId: mockEventId,
        eventType: mockEventType,
      });
    });

    it('should return 400 when stripe-signature header is missing', async () => {
      const mockRequest = {
        text: vi.fn().mockResolvedValue('{"test": "data"}'),
        headers: new Headers(),
      } as unknown as NextRequest;

      const response = await POST(mockRequest);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data).toEqual({
        error: 'Missing stripe-signature header',
      });
    });

    it('should return 400 when signature verification fails', async () => {
      const Stripe = (await import('stripe')).default;
      const mockStripeInstance = new Stripe('sk_test_123', {} as any);
      vi.mocked(mockStripeInstance.webhooks.constructEvent).mockImplementation(() => {
        throw new Error('Invalid signature');
      });

      const mockRequest = {
        text: vi.fn().mockResolvedValue('{"test": "data"}'),
        headers: new Headers({
          'stripe-signature': 'invalid-signature',
        }),
      } as unknown as NextRequest;

      const response = await POST(mockRequest);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain('Webhook signature verification failed');
    });

    it('should return 500 when RabbitMQ publishing fails', async () => {
      const mockEvent = {
        id: mockEventId,
        type: mockEventType,
        created: 1234567890,
        data: { object: {} },
        livemode: false,
        object: 'event',
        pending_webhooks: 0,
        request: null,
        api_version: '2025-01-27.acacia',
      };

      const Stripe = (await import('stripe')).default;
      const mockStripeInstance = new Stripe('sk_test_123', {} as any);
      vi.mocked(mockStripeInstance.webhooks.constructEvent).mockReturnValue(mockEvent as any);

      const { getRabbitMQClient } = await import('@/lib/rabbitmq');
      vi.mocked(getRabbitMQClient).mockReturnValue({
        publishStripeEvent: vi.fn().mockRejectedValue(new Error('RabbitMQ error')),
      } as any);

      const mockRequest = {
        text: vi.fn().mockResolvedValue('{"test": "data"}'),
        headers: new Headers({
          'stripe-signature': 'test-signature',
        }),
      } as unknown as NextRequest;

      const response = await POST(mockRequest);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data).toEqual({
        error: 'Failed to process webhook event',
      });
    });

    it('should return 500 on unexpected errors', async () => {
      const mockRequest = {
        text: vi.fn().mockRejectedValue(new Error('Unexpected error')),
        headers: new Headers({
          'stripe-signature': 'test-signature',
        }),
      } as unknown as NextRequest;

      const response = await POST(mockRequest);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data).toEqual({
        error: 'Internal server error',
      });
    });
  });

  describe('GET /api/webhooks/stripe', () => {
    it('should return health check status', async () => {
      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({
        status: 'ok',
        message: 'Stripe webhook endpoint is ready',
        timestamp: expect.any(String),
      });
    });

    it('should return valid ISO timestamp', async () => {
      const response = await GET();
      const data = await response.json();

      const timestamp = new Date(data.timestamp);
      expect(timestamp.toISOString()).toBe(data.timestamp);
    });
  });
});
