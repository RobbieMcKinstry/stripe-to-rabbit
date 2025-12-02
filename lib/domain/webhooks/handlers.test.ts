/**
 * Tests for webhook event handlers.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type Stripe from 'stripe';
import type {
  BillableEntityRepository,
  SubscriptionRepository,
  IdempotencyRepository,
} from '../repositories';
import type { WebhookLogger } from './handlers';
import {
  handleWebhookEvent,
  handleSubscriptionCreatedOrUpdated,
  handleSubscriptionDeleted,
  createTransactionContext,
} from './handlers';

describe('Webhook Handlers', () => {
  // Mock repositories
  let mockBillableRepo: BillableEntityRepository;
  let mockSubscriptionRepo: SubscriptionRepository;
  let mockIdempotencyRepo: IdempotencyRepository;
  let mockLogger: WebhookLogger;

  beforeEach(() => {
    // Reset mocks before each test
    mockBillableRepo = {
      findByStripeCustomerId: vi.fn(),
      updateStripeCustomerId: vi.fn(),
    };

    mockSubscriptionRepo = {
      upsertSubscription: vi.fn(),
      getActiveSubscription: vi.fn(),
      getByStripeId: vi.fn(),
      cancelSubscription: vi.fn(),
      getAllForEntity: vi.fn(),
    };

    mockIdempotencyRepo = {
      isProcessed: vi.fn().mockResolvedValue(false), // Default: not processed
      markProcessed: vi.fn(),
      cleanupOldEvents: vi.fn(),
    };

    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
  });

  describe('handleWebhookEvent', () => {
    it('skips already processed events', async () => {
      // Mock event as already processed
      vi.mocked(mockIdempotencyRepo.isProcessed).mockResolvedValue(true);

      const event: Stripe.Event = {
        id: 'evt_test_123',
        type: 'customer.subscription.created',
        data: { object: {} as Stripe.Subscription },
      } as Stripe.Event;

      const result = await handleWebhookEvent(event, {
        billableRepo: mockBillableRepo,
        subscriptionRepo: mockSubscriptionRepo,
        idempotencyRepo: mockIdempotencyRepo,
        logger: mockLogger,
      });

      expect(result.success).toBe(true);
      expect(result.skipped).toBe(true);
      expect(result.skipReason).toBe('already_processed');
      expect(mockIdempotencyRepo.isProcessed).toHaveBeenCalledWith('evt_test_123');
      expect(mockIdempotencyRepo.markProcessed).not.toHaveBeenCalled();
    });

    it('processes subscription.created events', async () => {
      const event: Stripe.Event = {
        id: 'evt_test_123',
        type: 'customer.subscription.created',
        data: {
          object: {
            id: 'sub_123',
            customer: 'cus_123',
            status: 'active',
            items: {
              data: [
                {
                  price: { id: 'price_123' },
                  quantity: 1,
                },
              ],
            },
            current_period_start: 1609459200, // 2021-01-01
            current_period_end: 1612137600, // 2021-02-01
            cancel_at_period_end: false,
            trial_end: null,
          } as any,
        },
      } as Stripe.Event;

      vi.mocked(mockBillableRepo.findByStripeCustomerId).mockResolvedValue('user-123');

      const result = await handleWebhookEvent(event, {
        billableRepo: mockBillableRepo,
        subscriptionRepo: mockSubscriptionRepo,
        idempotencyRepo: mockIdempotencyRepo,
        logger: mockLogger,
      });

      expect(result.success).toBe(true);
      expect(result.skipped).toBe(false);
      expect(mockBillableRepo.findByStripeCustomerId).toHaveBeenCalledWith('cus_123');
      expect(mockSubscriptionRepo.upsertSubscription).toHaveBeenCalledWith({
        stripeSubscriptionId: 'sub_123',
        entityId: 'user-123',
        stripePriceId: 'price_123',
        status: 'active',
        currentPeriodStart: new Date(1609459200 * 1000),
        currentPeriodEnd: new Date(1612137600 * 1000),
        cancelAtPeriodEnd: false,
        trialEnd: null,
        quantity: 1,
      });
      expect(mockIdempotencyRepo.markProcessed).toHaveBeenCalledWith('evt_test_123');
    });

    it('processes subscription.updated events', async () => {
      const event: Stripe.Event = {
        id: 'evt_test_456',
        type: 'customer.subscription.updated',
        data: {
          object: {
            id: 'sub_123',
            customer: 'cus_123',
            status: 'trialing',
            items: {
              data: [
                {
                  price: { id: 'price_pro' },
                  quantity: 5,
                },
              ],
            },
            current_period_start: 1609459200,
            current_period_end: 1612137600,
            cancel_at_period_end: true,
            trial_end: 1610064000, // Trial ends 2021-01-08
          } as any,
        },
      } as Stripe.Event;

      vi.mocked(mockBillableRepo.findByStripeCustomerId).mockResolvedValue('user-456');

      const result = await handleWebhookEvent(event, {
        billableRepo: mockBillableRepo,
        subscriptionRepo: mockSubscriptionRepo,
        idempotencyRepo: mockIdempotencyRepo,
        logger: mockLogger,
      });

      expect(result.success).toBe(true);
      expect(mockSubscriptionRepo.upsertSubscription).toHaveBeenCalledWith(
        expect.objectContaining({
          stripeSubscriptionId: 'sub_123',
          entityId: 'user-456',
          stripePriceId: 'price_pro',
          status: 'trialing',
          cancelAtPeriodEnd: true,
          quantity: 5,
        })
      );
    });

    it('processes subscription.deleted events', async () => {
      const event: Stripe.Event = {
        id: 'evt_test_789',
        type: 'customer.subscription.deleted',
        data: {
          object: {
            id: 'sub_123',
          } as any,
        },
      } as Stripe.Event;

      const result = await handleWebhookEvent(event, {
        billableRepo: mockBillableRepo,
        subscriptionRepo: mockSubscriptionRepo,
        idempotencyRepo: mockIdempotencyRepo,
        logger: mockLogger,
      });

      expect(result.success).toBe(true);
      expect(mockSubscriptionRepo.cancelSubscription).toHaveBeenCalledWith('sub_123');
      expect(mockIdempotencyRepo.markProcessed).toHaveBeenCalledWith('evt_test_789');
    });

    it('skips unhandled event types', async () => {
      const event: Stripe.Event = {
        id: 'evt_test_unhandled',
        type: 'payment_intent.succeeded',
        data: { object: {} as any },
      } as Stripe.Event;

      const result = await handleWebhookEvent(event, {
        billableRepo: mockBillableRepo,
        subscriptionRepo: mockSubscriptionRepo,
        idempotencyRepo: mockIdempotencyRepo,
        logger: mockLogger,
      });

      expect(result.success).toBe(true);
      expect(result.skipped).toBe(true);
      expect(result.skipReason).toBe('unhandled_event_type');
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Unhandled event type, skipping',
        expect.objectContaining({
          eventType: 'payment_intent.succeeded',
        })
      );
    });

    it('handles unknown customers gracefully', async () => {
      const event: Stripe.Event = {
        id: 'evt_unknown_customer',
        type: 'customer.subscription.created',
        data: {
          object: {
            id: 'sub_123',
            customer: 'cus_unknown',
            status: 'active',
            items: { data: [{ price: { id: 'price_123' }, quantity: 1 }] },
            current_period_start: 1609459200,
            current_period_end: 1612137600,
            cancel_at_period_end: false,
            trial_end: null,
          } as any,
        },
      } as Stripe.Event;

      // Customer not found in database
      vi.mocked(mockBillableRepo.findByStripeCustomerId).mockResolvedValue(null);

      const result = await handleWebhookEvent(event, {
        billableRepo: mockBillableRepo,
        subscriptionRepo: mockSubscriptionRepo,
        idempotencyRepo: mockIdempotencyRepo,
        logger: mockLogger,
      });

      expect(result.success).toBe(true);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Unknown customer, skipping subscription event',
        expect.objectContaining({
          customerId: 'cus_unknown',
        })
      );
      expect(mockSubscriptionRepo.upsertSubscription).not.toHaveBeenCalled();
      // Should still mark as processed to avoid retries
      expect(mockIdempotencyRepo.markProcessed).toHaveBeenCalledWith('evt_unknown_customer');
    });

    it('handles errors during processing', async () => {
      const event: Stripe.Event = {
        id: 'evt_error',
        type: 'customer.subscription.created',
        data: {
          object: {
            id: 'sub_123',
            customer: 'cus_123',
            status: 'active',
            items: { data: [{ price: { id: 'price_123' }, quantity: 1 }] },
            current_period_start: 1609459200,
            current_period_end: 1612137600,
            cancel_at_period_end: false,
            trial_end: null,
          } as any,
        },
      } as Stripe.Event;

      vi.mocked(mockBillableRepo.findByStripeCustomerId).mockResolvedValue('user-123');
      const testError = new Error('Database error');
      vi.mocked(mockSubscriptionRepo.upsertSubscription).mockRejectedValue(testError);

      const result = await handleWebhookEvent(event, {
        billableRepo: mockBillableRepo,
        subscriptionRepo: mockSubscriptionRepo,
        idempotencyRepo: mockIdempotencyRepo,
        logger: mockLogger,
      });

      expect(result.success).toBe(false);
      expect(result.skipped).toBe(false);
      expect(result.error).toBe(testError);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error processing webhook event',
        testError,
        expect.objectContaining({
          eventId: 'evt_error',
          eventType: 'customer.subscription.created',
        })
      );
      // Should NOT mark as processed on error
      expect(mockIdempotencyRepo.markProcessed).not.toHaveBeenCalled();
    });

    it('handles customer objects (not just IDs)', async () => {
      const event: Stripe.Event = {
        id: 'evt_customer_object',
        type: 'customer.subscription.created',
        data: {
          object: {
            id: 'sub_123',
            customer: {
              id: 'cus_123',
              email: 'test@example.com',
            } as Stripe.Customer,
            status: 'active',
            items: { data: [{ price: { id: 'price_123' }, quantity: 1 }] },
            current_period_start: 1609459200,
            current_period_end: 1612137600,
            cancel_at_period_end: false,
            trial_end: null,
          } as any,
        },
      } as Stripe.Event;

      vi.mocked(mockBillableRepo.findByStripeCustomerId).mockResolvedValue('user-123');

      await handleWebhookEvent(event, {
        billableRepo: mockBillableRepo,
        subscriptionRepo: mockSubscriptionRepo,
        idempotencyRepo: mockIdempotencyRepo,
        logger: mockLogger,
      });

      expect(mockBillableRepo.findByStripeCustomerId).toHaveBeenCalledWith('cus_123');
    });
  });

  describe('handleSubscriptionCreatedOrUpdated', () => {
    it('throws error when subscription has no price', async () => {
      const event: Stripe.Event = {
        id: 'evt_no_price',
        type: 'customer.subscription.created',
        data: {
          object: {
            id: 'sub_123',
            customer: 'cus_123',
            status: 'active',
            items: { data: [] }, // No items!
            current_period_start: 1609459200,
            current_period_end: 1612137600,
            cancel_at_period_end: false,
            trial_end: null,
          } as any,
        },
      } as Stripe.Event;

      vi.mocked(mockBillableRepo.findByStripeCustomerId).mockResolvedValue('user-123');

      await expect(
        handleSubscriptionCreatedOrUpdated(event, {
          billableRepo: mockBillableRepo,
          subscriptionRepo: mockSubscriptionRepo,
          idempotencyRepo: mockIdempotencyRepo,
          logger: mockLogger,
        })
      ).rejects.toThrow('Subscription sub_123 has no price ID');
    });
  });

  describe('handleSubscriptionDeleted', () => {
    it('cancels subscription in repository', async () => {
      const event: Stripe.Event = {
        id: 'evt_deleted',
        type: 'customer.subscription.deleted',
        data: {
          object: {
            id: 'sub_to_cancel',
          } as any,
        },
      } as Stripe.Event;

      await handleSubscriptionDeleted(event, {
        billableRepo: mockBillableRepo,
        subscriptionRepo: mockSubscriptionRepo,
        idempotencyRepo: mockIdempotencyRepo,
        logger: mockLogger,
      });

      expect(mockSubscriptionRepo.cancelSubscription).toHaveBeenCalledWith('sub_to_cancel');
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Subscription canceled',
        expect.objectContaining({
          subscriptionId: 'sub_to_cancel',
        })
      );
    });
  });

  describe('createTransactionContext', () => {
    it('creates a context with provided repositories', () => {
      const mockTx = { some: 'transaction' };

      const context = createTransactionContext(mockTx, {
        billableRepo: mockBillableRepo,
        subscriptionRepo: mockSubscriptionRepo,
        idempotencyRepo: mockIdempotencyRepo,
      });

      expect(context.billableRepo).toBe(mockBillableRepo);
      expect(context.subscriptionRepo).toBe(mockSubscriptionRepo);
      expect(context.idempotencyRepo).toBe(mockIdempotencyRepo);
      expect(context.logger).toBeDefined();
    });

    it('accepts custom logger', () => {
      const mockTx = { some: 'transaction' };
      const customLogger: WebhookLogger = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };

      const context = createTransactionContext(
        mockTx,
        {
          billableRepo: mockBillableRepo,
          subscriptionRepo: mockSubscriptionRepo,
          idempotencyRepo: mockIdempotencyRepo,
        },
        customLogger
      );

      expect(context.logger).toBe(customLogger);
    });
  });

  describe('Idempotency', () => {
    it('checks idempotency before processing', async () => {
      const event: Stripe.Event = {
        id: 'evt_idempotency_test',
        type: 'customer.subscription.created',
        data: {
          object: {
            id: 'sub_123',
            customer: 'cus_123',
            status: 'active',
            items: { data: [{ price: { id: 'price_123' }, quantity: 1 }] },
            current_period_start: 1609459200,
            current_period_end: 1612137600,
            cancel_at_period_end: false,
            trial_end: null,
          } as any,
        },
      } as Stripe.Event;

      vi.mocked(mockBillableRepo.findByStripeCustomerId).mockResolvedValue('user-123');

      await handleWebhookEvent(event, {
        billableRepo: mockBillableRepo,
        subscriptionRepo: mockSubscriptionRepo,
        idempotencyRepo: mockIdempotencyRepo,
        logger: mockLogger,
      });

      // isProcessed should be called FIRST
      expect(mockIdempotencyRepo.isProcessed).toHaveBeenCalledWith('evt_idempotency_test');

      // markProcessed should be called LAST (after processing)
      expect(mockIdempotencyRepo.markProcessed).toHaveBeenCalledWith('evt_idempotency_test');

      // Verify order: isProcessed → findByStripeCustomerId → upsertSubscription → markProcessed
      const isProcessedOrder = vi.mocked(mockIdempotencyRepo.isProcessed).mock
        .invocationCallOrder[0];
      const findCustomerOrder = vi.mocked(mockBillableRepo.findByStripeCustomerId).mock
        .invocationCallOrder[0];
      const upsertOrder = vi.mocked(mockSubscriptionRepo.upsertSubscription).mock
        .invocationCallOrder[0];
      const markProcessedOrder = vi.mocked(mockIdempotencyRepo.markProcessed).mock
        .invocationCallOrder[0];

      expect(isProcessedOrder).toBeLessThan(findCustomerOrder!);
      expect(findCustomerOrder).toBeLessThan(upsertOrder!);
      expect(upsertOrder).toBeLessThan(markProcessedOrder!);
    });
  });
});
