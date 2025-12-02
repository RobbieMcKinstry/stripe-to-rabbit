/**
 * Repository interfaces for Stripe domain model.
 *
 * These interfaces define the contracts that your application must implement
 * to integrate with the Stripe business logic layer. The library provides
 * the business logic (webhook processing, state management), and you provide
 * the persistence layer via these repositories.
 *
 * ## Design Philosophy
 *
 * This follows the **Repository Pattern** with **Dependency Inversion**:
 * - The business logic depends on these interfaces (abstractions)
 * - Your application provides concrete implementations (Drizzle, Prisma, raw SQL, etc.)
 * - Database-agnostic: Works with Postgres, MySQL, MongoDB, DynamoDB, etc.
 *
 * ## Example Usage
 *
 * ```typescript
 * import { BillableEntityRepository } from '@yourlib/domain/repositories';
 * import { db } from './db';
 * import { users } from './schema';
 *
 * class DrizzleBillableEntityRepository implements BillableEntityRepository {
 *   async findByStripeCustomerId(customerId: string) {
 *     return db.query.users.findFirst({
 *       where: eq(users.stripe_customer_id, customerId)
 *     });
 *   }
 *
 *   async updateStripeCustomerId(entityId: string, customerId: string) {
 *     await db.update(users)
 *       .set({ stripe_customer_id: customerId })
 *       .where(eq(users.id, entityId));
 *   }
 * }
 * ```
 */

import type { BillableEntity, Subscription, SubscriptionStatus } from './types';
import type Stripe from 'stripe';

/**
 * Repository for managing billable entities (users, organizations, accounts).
 *
 * This repository handles the mapping between your application's entities
 * (users, organizations, etc.) and Stripe customers.
 *
 * **Key Responsibilities:**
 * - Look up entities by Stripe customer ID (for webhook processing)
 * - Update Stripe customer ID on entities (after creating Stripe customer)
 * - Optionally create entities from Stripe webhooks (if needed)
 */
export interface BillableEntityRepository {
  /**
   * Find an entity by its Stripe customer ID.
   *
   * Called when processing webhooks to determine which user/org the event belongs to.
   *
   * @param stripeCustomerId - Stripe customer ID (e.g., "cus_xxxxxxxxxxxxx")
   * @returns The entity's ID in your system, or null if not found
   *
   * @example
   * ```typescript
   * // In webhook handler
   * const event = stripe.webhooks.constructEvent(...);
   * const customerId = event.data.object.customer;
   * const entityId = await repo.findByStripeCustomerId(customerId);
   * if (!entityId) {
   *   console.error('Unknown customer:', customerId);
   *   return;
   * }
   * ```
   */
  findByStripeCustomerId(stripeCustomerId: string): Promise<string | null>;

  /**
   * Update an entity's Stripe customer ID.
   *
   * Called after creating a Stripe customer to link it to your entity.
   *
   * @param entityId - Your system's entity ID (user ID, org ID, etc.)
   * @param stripeCustomerId - Stripe customer ID to associate
   *
   * @example
   * ```typescript
   * // After creating Stripe customer
   * const customer = await stripe.customers.create({ email: user.email });
   * await repo.updateStripeCustomerId(user.id, customer.id);
   * ```
   */
  updateStripeCustomerId(entityId: string, stripeCustomerId: string): Promise<void>;

  /**
   * Optional: Create an entity from a Stripe webhook.
   *
   * Some applications create users automatically when receiving certain
   * Stripe events (e.g., Checkout completed). If you don't need this,
   * you can omit this method or throw NotImplementedError.
   *
   * @param stripeCustomer - Stripe customer object from webhook
   * @returns The created entity's ID
   *
   * @example
   * ```typescript
   * // In checkout.session.completed handler
   * const session = event.data.object;
   * const entityId = await repo.ensureEntityExists({
   *   id: session.customer,
   *   email: session.customer_email,
   *   metadata: session.metadata,
   * });
   * ```
   */
  ensureEntityExists?(stripeCustomer: Stripe.Customer): Promise<string>;
}

/**
 * Repository for managing subscription records.
 *
 * This repository handles CRUD operations for subscription data that's
 * synced from Stripe webhooks.
 *
 * **Key Responsibilities:**
 * - Create subscription records when customer subscribes
 * - Update subscription status/price when changed in Stripe
 * - Query subscription state for access control
 * - Handle idempotent updates (webhooks can arrive multiple times)
 */
export interface SubscriptionRepository {
  /**
   * Create or update a subscription from a Stripe subscription object.
   *
   * This method should be **idempotent** - calling it multiple times with
   * the same data should be safe. Webhooks can be delivered more than once.
   *
   * @param params - Subscription data from Stripe
   *
   * @example
   * ```typescript
   * // In customer.subscription.created handler
   * const subscription = event.data.object;
   * await repo.upsertSubscription({
   *   stripeSubscriptionId: subscription.id,
   *   entityId: await getEntityId(subscription.customer),
   *   stripePriceId: subscription.items.data[0].price.id,
   *   status: subscription.status,
   *   currentPeriodStart: new Date(subscription.current_period_start * 1000),
   *   currentPeriodEnd: new Date(subscription.current_period_end * 1000),
   *   cancelAtPeriodEnd: subscription.cancel_at_period_end,
   *   trialEnd: subscription.trial_end ? new Date(subscription.trial_end * 1000) : null,
   * });
   * ```
   */
  upsertSubscription(params: {
    stripeSubscriptionId: string;
    entityId: string;
    stripePriceId: string;
    status: SubscriptionStatus;
    currentPeriodStart: Date;
    currentPeriodEnd: Date;
    cancelAtPeriodEnd: boolean;
    trialEnd?: Date | null;
    quantity?: number;
  }): Promise<void>;

  /**
   * Get the active subscription for an entity.
   *
   * Returns the subscription with status 'active' or 'trialing'.
   * Returns null if no active subscription exists.
   *
   * Used for access control: "Does this user have an active subscription?"
   *
   * @param entityId - Your system's entity ID
   * @returns Active subscription or null
   *
   * @example
   * ```typescript
   * // Middleware for protected routes
   * const subscription = await repo.getActiveSubscription(userId);
   * if (!subscription) {
   *   return res.status(403).json({ error: 'Subscription required' });
   * }
   * if (subscription.stripePriceId !== PRICE_ID_PRO) {
   *   return res.status(403).json({ error: 'Pro plan required' });
   * }
   * ```
   */
  getActiveSubscription(entityId: string): Promise<Subscription | null>;

  /**
   * Get a subscription by its Stripe subscription ID.
   *
   * Used when processing webhooks to look up existing subscriptions.
   *
   * @param stripeSubscriptionId - Stripe subscription ID
   * @returns Subscription or null if not found
   */
  getByStripeId(stripeSubscriptionId: string): Promise<Subscription | null>;

  /**
   * Cancel a subscription (mark as canceled).
   *
   * Called when receiving customer.subscription.deleted webhook.
   *
   * @param stripeSubscriptionId - Stripe subscription ID to cancel
   *
   * @example
   * ```typescript
   * // In customer.subscription.deleted handler
   * await repo.cancelSubscription(event.data.object.id);
   * ```
   */
  cancelSubscription(stripeSubscriptionId: string): Promise<void>;

  /**
   * Optional: Get all subscriptions for an entity.
   *
   * Use this if your application supports multiple subscriptions per customer.
   * For simple apps with one subscription per customer, you can omit this.
   *
   * @param entityId - Your system's entity ID
   * @returns Array of subscriptions (empty if none)
   */
  getAllForEntity?(entityId: string): Promise<Subscription[]>;
}

/**
 * Repository for idempotency tracking.
 *
 * Ensures webhook events are processed exactly once, even if Stripe
 * sends the same event multiple times (which happens).
 *
 * **Key Responsibilities:**
 * - Track which webhook events have been processed
 * - Prevent duplicate processing of the same event
 * - Optional: Clean up old processed events (after 30+ days)
 */
export interface IdempotencyRepository {
  /**
   * Check if a webhook event has already been processed.
   *
   * Call this BEFORE processing any webhook to prevent duplicates.
   *
   * @param eventId - Stripe event ID (e.g., "evt_xxxxxxxxxxxxx")
   * @returns true if already processed, false if new
   *
   * @example
   * ```typescript
   * // In webhook handler
   * const event = stripe.webhooks.constructEvent(...);
   *
   * if (await idempotencyRepo.isProcessed(event.id)) {
   *   console.log('Event already processed, skipping');
   *   return; // Return 200 to acknowledge receipt
   * }
   *
   * // Process event...
   * await handleSubscriptionUpdated(event);
   *
   * // Mark as processed
   * await idempotencyRepo.markProcessed(event.id);
   * ```
   */
  isProcessed(eventId: string): Promise<boolean>;

  /**
   * Mark a webhook event as processed.
   *
   * Call this AFTER successfully processing a webhook event.
   *
   * **Important:** Only mark as processed after the transaction commits.
   * If using database transactions, mark processed within the same transaction.
   *
   * @param eventId - Stripe event ID
   * @param processedAt - Optional timestamp (defaults to now)
   *
   * @example
   * ```typescript
   * // With database transaction
   * await db.transaction(async (tx) => {
   *   await subscriptionRepo.upsertSubscription(...);
   *   await idempotencyRepo.markProcessed(event.id);
   * });
   * ```
   */
  markProcessed(eventId: string, processedAt?: Date): Promise<void>;

  /**
   * Optional: Clean up old processed events.
   *
   * Stripe recommends keeping event IDs for at least 30 days to handle
   * retries, but you can clean up older ones to prevent unbounded growth.
   *
   * @param olderThan - Delete events processed before this date
   *
   * @example
   * ```typescript
   * // In a scheduled job (daily)
   * const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
   * await idempotencyRepo.cleanupOldEvents(thirtyDaysAgo);
   * ```
   */
  cleanupOldEvents?(olderThan: Date): Promise<number>;
}

/**
 * Optional: Repository for payment tracking.
 *
 * For applications that need to track one-time payments separately from
 * subscriptions (e.g., for invoicing, refunds, audit trails).
 *
 * Most subscription-based SaaS don't need this - subscription tracking
 * is usually sufficient. Implement this if you have:
 * - One-time purchases in addition to subscriptions
 * - Need for payment audit trails
 * - Refund workflows
 */
export interface PaymentRepository {
  /**
   * Record a payment attempt (successful or failed).
   *
   * @param params - Payment data from Stripe
   */
  recordPayment(params: {
    stripePaymentIntentId: string;
    entityId: string;
    amount: number;
    currency: string;
    status: 'succeeded' | 'failed' | 'processing';
    stripeChargeId?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<void>;

  /**
   * Update payment status (e.g., from processing to succeeded).
   *
   * @param stripePaymentIntentId - Payment intent ID
   * @param status - New status
   */
  updatePaymentStatus(
    stripePaymentIntentId: string,
    status: 'succeeded' | 'failed' | 'processing'
  ): Promise<void>;

  /**
   * Get payment by Stripe payment intent ID.
   *
   * @param stripePaymentIntentId - Payment intent ID
   */
  getByStripeId(stripePaymentIntentId: string): Promise<{
    id: string;
    status: string;
    amount: number;
  } | null>;
}
