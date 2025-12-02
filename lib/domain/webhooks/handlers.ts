/**
 * Webhook event handlers for Stripe domain model.
 *
 * These handlers process Stripe webhook events and update your database
 * using the repository interfaces. They handle:
 * - Subscription lifecycle (created, updated, deleted)
 * - Idempotency (prevent duplicate processing)
 * - Error handling and logging
 * - Entity lookup and validation
 *
 * ## Usage
 *
 * ```typescript
 * import Stripe from 'stripe';
 * import { handleWebhookEvent } from '@yourlib/domain/webhooks';
 * import { billableRepo, subscriptionRepo, idempotencyRepo } from './repositories';
 *
 * const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
 *
 * export async function POST(request: Request) {
 *   const signature = request.headers.get('stripe-signature')!;
 *   const event = stripe.webhooks.constructEvent(
 *     await request.text(),
 *     signature,
 *     process.env.STRIPE_WEBHOOK_SECRET!
 *   );
 *
 *   await handleWebhookEvent(event, {
 *     billableRepo,
 *     subscriptionRepo,
 *     idempotencyRepo,
 *   });
 *
 *   return new Response('OK', { status: 200 });
 * }
 * ```
 */

import type Stripe from 'stripe';
import type {
  BillableEntityRepository,
  SubscriptionRepository,
  IdempotencyRepository,
} from '../repositories';
import type { SubscriptionStatus } from '../types';

/**
 * Context passed to all webhook handlers.
 */
export interface WebhookHandlerContext {
  billableRepo: BillableEntityRepository;
  subscriptionRepo: SubscriptionRepository;
  idempotencyRepo: IdempotencyRepository;
  logger?: WebhookLogger;
}

/**
 * Logger interface for webhook processing.
 */
export interface WebhookLogger {
  info(message: string, metadata?: Record<string, unknown>): void;
  warn(message: string, metadata?: Record<string, unknown>): void;
  error(message: string, error?: Error, metadata?: Record<string, unknown>): void;
}

/**
 * Result of processing a webhook event.
 */
export interface WebhookHandlerResult {
  /**
   * Whether the event was processed successfully.
   */
  success: boolean;

  /**
   * Whether the event was skipped (e.g., already processed, unknown customer).
   */
  skipped: boolean;

  /**
   * Reason for skipping, if applicable.
   */
  skipReason?: string;

  /**
   * Error that occurred during processing, if any.
   */
  error?: Error;
}

/**
 * Default console logger.
 */
const defaultLogger: WebhookLogger = {
  info: (message, metadata) => console.log(message, metadata),
  warn: (message, metadata) => console.warn(message, metadata),
  error: (message, error, metadata) => console.error(message, error, metadata),
};

/**
 * Main webhook event dispatcher.
 *
 * Handles idempotency checking, event routing, and error handling.
 *
 * @param event - Stripe webhook event
 * @param context - Handler context with repositories
 * @returns Result of processing the event
 *
 * @example
 * ```typescript
 * const result = await handleWebhookEvent(event, {
 *   billableRepo,
 *   subscriptionRepo,
 *   idempotencyRepo,
 * });
 *
 * if (!result.success) {
 *   console.error('Webhook processing failed:', result.error);
 * }
 * ```
 */
export async function handleWebhookEvent(
  event: Stripe.Event,
  context: WebhookHandlerContext
): Promise<WebhookHandlerResult> {
  const logger = context.logger ?? defaultLogger;

  // Check idempotency first
  if (await context.idempotencyRepo.isProcessed(event.id)) {
    logger.info('Event already processed, skipping', {
      eventId: event.id,
      eventType: event.type,
    });

    return {
      success: true,
      skipped: true,
      skipReason: 'already_processed',
    };
  }

  try {
    // Route to appropriate handler based on event type
    let processed = false;

    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        await handleSubscriptionCreatedOrUpdated(event, context);
        processed = true;
        break;

      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event, context);
        processed = true;
        break;

      // Add more event types as needed
      default:
        logger.info('Unhandled event type, skipping', {
          eventId: event.id,
          eventType: event.type,
        });
        break;
    }

    // Mark as processed only if we handled it
    if (processed) {
      await context.idempotencyRepo.markProcessed(event.id);

      logger.info('Event processed successfully', {
        eventId: event.id,
        eventType: event.type,
      });
    }

    return {
      success: true,
      skipped: !processed,
      skipReason: processed ? undefined : 'unhandled_event_type',
    };
  } catch (error) {
    logger.error('Error processing webhook event', error as Error, {
      eventId: event.id,
      eventType: event.type,
    });

    return {
      success: false,
      skipped: false,
      error: error as Error,
    };
  }
}

/**
 * Handle subscription.created and subscription.updated events.
 *
 * Creates or updates a subscription record in the database.
 *
 * @param event - Stripe webhook event
 * @param context - Handler context
 */
export async function handleSubscriptionCreatedOrUpdated(
  event: Stripe.Event,
  context: WebhookHandlerContext
): Promise<void> {
  const logger = context.logger ?? defaultLogger;
  const subscription: Stripe.Subscription = event.data.object as Stripe.Subscription;

  // Find which entity this subscription belongs to
  const customerId =
    typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id;

  const entityId = await context.billableRepo.findByStripeCustomerId(customerId);

  if (!entityId) {
    logger.warn('Unknown customer, skipping subscription event', {
      eventId: event.id,
      customerId,
      subscriptionId: subscription.id,
    });

    // Still mark as processed to avoid retrying
    await context.idempotencyRepo.markProcessed(event.id);
    return;
  }

  // Get the price ID from the first subscription item
  const priceId = subscription.items.data[0]?.price.id;

  if (!priceId) {
    logger.error('Subscription has no price ID', undefined, {
      eventId: event.id,
      subscriptionId: subscription.id,
    });
    throw new Error(`Subscription ${subscription.id} has no price ID`);
  }

  // Upsert the subscription
  await context.subscriptionRepo.upsertSubscription({
    stripeSubscriptionId: subscription.id,
    entityId,
    stripePriceId: priceId,
    status: subscription.status as SubscriptionStatus,
    // @ts-expect-error - Stripe webhook objects have these properties at runtime
    currentPeriodStart: new Date(subscription.current_period_start * 1000),
    // @ts-expect-error - Stripe webhook objects have these properties at runtime
    currentPeriodEnd: new Date(subscription.current_period_end * 1000),
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    trialEnd: subscription.trial_end ? new Date(subscription.trial_end * 1000) : null,
    quantity: subscription.items.data[0]?.quantity,
  });

  logger.info('Subscription upserted', {
    eventId: event.id,
    subscriptionId: subscription.id,
    entityId,
    status: subscription.status,
    priceId,
  });
}

/**
 * Handle subscription.deleted events.
 *
 * Marks a subscription as canceled in the database.
 *
 * @param event - Stripe webhook event
 * @param context - Handler context
 */
export async function handleSubscriptionDeleted(
  event: Stripe.Event,
  context: WebhookHandlerContext
): Promise<void> {
  const logger = context.logger ?? defaultLogger;
  const subscription: Stripe.Subscription = event.data.object as Stripe.Subscription;

  await context.subscriptionRepo.cancelSubscription(subscription.id);

  logger.info('Subscription canceled', {
    eventId: event.id,
    subscriptionId: subscription.id,
  });
}

/**
 * Helper to create a transaction-aware handler context.
 *
 * Use this when you want to process webhooks within a database transaction.
 *
 * @example
 * ```typescript
 * await db.transaction(async (tx) => {
 *   const txContext = createTransactionContext(tx, {
 *     billableRepo: new DrizzleBillableEntityRepository(tx, users),
 *     subscriptionRepo: new DrizzleSubscriptionRepository(tx, subscriptions),
 *     idempotencyRepo: new DrizzleIdempotencyRepository(tx, webhookEvents),
 *   });
 *
 *   await handleWebhookEvent(event, txContext);
 * });
 * ```
 */
export function createTransactionContext<T>(
  tx: T,
  repos: Omit<WebhookHandlerContext, 'logger'>,
  logger?: WebhookLogger
): WebhookHandlerContext {
  return {
    ...repos,
    logger: logger ?? defaultLogger,
  };
}
