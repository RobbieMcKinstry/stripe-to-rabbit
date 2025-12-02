// @ts-nocheck
/**
 * Complete webhook integration example.
 *
 * This example shows how to integrate the Stripe domain model with a Next.js
 * application, including:
 * - Database schema setup with Drizzle
 * - Repository implementations
 * - Webhook endpoint
 * - Database transactions
 * - Error handling and logging
 *
 * ## Setup Steps
 *
 * 1. Copy this file to your project
 * 2. Install dependencies: `npm install stripe drizzle-orm postgres`
 * 3. Set environment variables in `.env`:
 *    - STRIPE_SECRET_KEY=sk_test_...
 *    - STRIPE_WEBHOOK_SECRET=whsec_...
 *    - DATABASE_URL=postgresql://...
 * 4. Run migrations: `npm run db:push`
 * 5. Configure webhook in Stripe Dashboard
 * 6. Test with: `stripe listen --forward-to localhost:3000/api/webhooks/stripe`
 */

// ============================================================================
// 1. Database Schema (schema.ts)
// ============================================================================

import { pgTable, uuid, text, timestamp, serial, boolean } from 'drizzle-orm/pg-core';
import { stripeBillableFields, stripeSubscriptionFields } from '@yourlib/domain/drizzle';

/**
 * Users table with Stripe customer ID.
 */
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  name: text('name'),
  ...stripeBillableFields(),
  created_at: timestamp('created_at').notNull().defaultNow(),
  updated_at: timestamp('updated_at').notNull().defaultNow(),
});

/**
 * Subscriptions table.
 */
export const subscriptions = pgTable('subscriptions', {
  id: serial('id').primaryKey(),
  user_id: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  ...stripeSubscriptionFields(),
  created_at: timestamp('created_at').notNull().defaultNow(),
  updated_at: timestamp('updated_at').notNull().defaultNow(),
});

/**
 * Webhook events table for idempotency tracking.
 */
export const webhookEvents = pgTable('webhook_events', {
  event_id: text('event_id').primaryKey(),
  processed_at: timestamp('processed_at').notNull().defaultNow(),
});

// ============================================================================
// 2. Database Connection (db.ts)
// ============================================================================

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

const connectionString = process.env.DATABASE_URL!;

// Create Postgres connection
const client = postgres(connectionString);

// Create Drizzle instance
export const db = drizzle(client);

// ============================================================================
// 3. Repository Setup (repositories.ts)
// ============================================================================

import {
  DrizzleBillableEntityRepository,
  DrizzleSubscriptionRepository,
  DrizzleIdempotencyRepository,
} from '@yourlib/domain/drizzle';

// Create repository instances (non-transactional)
export const billableRepo = new DrizzleBillableEntityRepository(db, users);
export const subscriptionRepo = new DrizzleSubscriptionRepository(db, subscriptions, 'user_id');
export const idempotencyRepo = new DrizzleIdempotencyRepository(db, webhookEvents);

// Helper to create transaction-scoped repositories
export function createTransactionRepos(tx: typeof db) {
  return {
    billableRepo: new DrizzleBillableEntityRepository(tx, users),
    subscriptionRepo: new DrizzleSubscriptionRepository(tx, subscriptions, 'user_id'),
    idempotencyRepo: new DrizzleIdempotencyRepository(tx, webhookEvents),
  };
}

// ============================================================================
// 4. Custom Logger (logger.ts)
// ============================================================================

import type { WebhookLogger } from '@yourlib/domain/webhooks';

/**
 * Custom structured logger for webhook processing.
 */
export const webhookLogger: WebhookLogger = {
  info: (message, metadata) => {
    console.log(
      JSON.stringify({
        level: 'info',
        message,
        ...metadata,
        timestamp: new Date().toISOString(),
      })
    );
  },

  warn: (message, metadata) => {
    console.warn(
      JSON.stringify({
        level: 'warn',
        message,
        ...metadata,
        timestamp: new Date().toISOString(),
      })
    );
  },

  error: (message, error, metadata) => {
    console.error(
      JSON.stringify({
        level: 'error',
        message,
        error: {
          name: error?.name,
          message: error?.message,
          stack: error?.stack,
        },
        ...metadata,
        timestamp: new Date().toISOString(),
      })
    );
  },
};

// ============================================================================
// 5. Webhook Endpoint (app/api/webhooks/stripe/route.ts)
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { handleWebhookEvent } from '@yourlib/domain/webhooks';

// Initialize Stripe
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2023-10-16',
});

/**
 * Stripe webhook endpoint.
 *
 * Receives webhook events from Stripe, verifies signatures, and processes them.
 */
export async function POST(request: NextRequest) {
  try {
    // Get raw body and signature
    const body = await request.text();
    const signature = request.headers.get('stripe-signature');

    if (!signature) {
      return NextResponse.json({ error: 'No signature' }, { status: 400 });
    }

    // Verify webhook signature
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(body, signature, process.env.STRIPE_WEBHOOK_SECRET!);
    } catch (err) {
      console.error('Webhook signature verification failed:', err);
      return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
    }

    // Process event within database transaction
    await db.transaction(async (tx) => {
      // Create transaction-scoped repositories
      const repos = createTransactionRepos(tx);

      // Process webhook event
      const result = await handleWebhookEvent(event, {
        ...repos,
        logger: webhookLogger,
      });

      // Log result
      if (!result.success) {
        console.error('Webhook processing failed:', {
          eventId: event.id,
          eventType: event.type,
          error: result.error,
        });

        // Send to error tracking (e.g., Sentry)
        // Sentry.captureException(result.error, {
        //   tags: {
        //     eventId: event.id,
        //     eventType: event.type,
        //   },
        // });
      }

      if (result.skipped) {
        console.log('Event skipped:', {
          eventId: event.id,
          eventType: event.type,
          reason: result.skipReason,
        });
      }
    });

    // Always return 200 to acknowledge receipt
    return NextResponse.json({ received: true }, { status: 200 });
  } catch (err) {
    console.error('Webhook endpoint error:', err);

    // Still return 200 to prevent Stripe retries on code errors
    return NextResponse.json({ error: 'Internal error' }, { status: 200 });
  }
}

// ============================================================================
// 6. Creating Stripe Customers (lib/stripe.ts)
// ============================================================================

/**
 * Create a Stripe customer for a user.
 *
 * Call this when a user signs up or when they first need to make a payment.
 */
export async function createStripeCustomer(userId: string, email: string): Promise<string> {
  // Create customer in Stripe
  const customer = await stripe.customers.create({
    email,
    metadata: {
      userId,
    },
  });

  // Link customer ID to user in database
  await billableRepo.updateStripeCustomerId(userId, customer.id);

  return customer.id;
}

// ============================================================================
// 7. Access Control Middleware (middleware/subscription.ts)
// ============================================================================

import { eq } from 'drizzle-orm';

/**
 * Middleware to check if user has an active subscription.
 */
export async function requireActiveSubscription(userId: string): Promise<boolean> {
  const subscription = await subscriptionRepo.getActiveSubscription(userId);
  return subscription !== null;
}

/**
 * Middleware to check if user has a specific plan.
 */
export async function requirePlan(userId: string, priceId: string): Promise<boolean> {
  const subscription = await subscriptionRepo.getActiveSubscription(userId);

  if (!subscription) {
    return false;
  }

  return subscription.stripePriceId === priceId;
}

// ============================================================================
// 8. Example API Route with Subscription Check (app/api/pro-feature/route.ts)
// ============================================================================

/**
 * Protected API route that requires active subscription.
 */
export async function GET_ProFeature(request: NextRequest) {
  // Get user ID from session (example uses simple header)
  const userId = request.headers.get('x-user-id');

  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Check if user has active subscription
  const hasSubscription = await requireActiveSubscription(userId);

  if (!hasSubscription) {
    return NextResponse.json(
      {
        error: 'Subscription required',
        upgradeUrl: '/pricing',
      },
      { status: 403 }
    );
  }

  // User has active subscription - return pro feature
  return NextResponse.json({
    data: 'This is a pro feature!',
  });
}

// ============================================================================
// 9. Cleanup Job (scripts/cleanup-webhook-events.ts)
// ============================================================================

/**
 * Scheduled job to clean up old webhook events.
 *
 * Run this daily to prevent unbounded growth of the webhook_events table.
 *
 * Example: Add to cron or use a service like Vercel Cron.
 */
export async function cleanupOldWebhookEvents() {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const deletedCount = await idempotencyRepo.cleanupOldEvents!(thirtyDaysAgo);

  console.log(`Cleaned up ${deletedCount} old webhook events`);
}

// ============================================================================
// 10. Testing Helpers (tests/helpers.ts)
// ============================================================================

import type Stripe from 'stripe';

/**
 * Create a test subscription event.
 */
export function createTestSubscriptionEvent(
  type:
    | 'customer.subscription.created'
    | 'customer.subscription.updated'
    | 'customer.subscription.deleted',
  overrides: Partial<Stripe.Subscription> = {}
): Stripe.Event {
  return {
    id: `evt_test_${Date.now()}`,
    type,
    data: {
      object: {
        id: 'sub_test_123',
        customer: 'cus_test_123',
        status: 'active',
        items: {
          data: [
            {
              id: 'si_test',
              price: {
                id: 'price_test_pro',
                currency: 'usd',
                unit_amount: 1000,
              } as Stripe.Price,
              quantity: 1,
            } as Stripe.SubscriptionItem,
          ],
        },
        current_period_start: Math.floor(Date.now() / 1000),
        current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
        cancel_at_period_end: false,
        trial_end: null,
        ...overrides,
      } as Stripe.Subscription,
    },
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    object: 'event',
    api_version: '2023-10-16',
  } as Stripe.Event;
}

// ============================================================================
// 11. Integration Test (tests/webhook.test.ts)
// ============================================================================

import { describe, it, expect, beforeEach } from 'vitest';

describe('Webhook Integration', () => {
  beforeEach(async () => {
    // Clean up test data
    await db.delete(webhookEvents);
    await db.delete(subscriptions);
    await db.delete(users);
  });

  it('processes subscription.created event end-to-end', async () => {
    // 1. Create test user
    const [user] = await db
      .insert(users)
      .values({
        email: 'test@example.com',
        stripe_customer_id: 'cus_test_123',
      })
      .returning();

    // 2. Create test event
    const event = createTestSubscriptionEvent('customer.subscription.created');

    // 3. Process webhook
    await db.transaction(async (tx) => {
      const repos = createTransactionRepos(tx);

      const result = await handleWebhookEvent(event, {
        ...repos,
        logger: webhookLogger,
      });

      expect(result.success).toBe(true);
      expect(result.skipped).toBe(false);
    });

    // 4. Verify subscription created
    const userSubscriptions = await subscriptionRepo.getAllForEntity!(user.id);
    expect(userSubscriptions).toHaveLength(1);
    expect(userSubscriptions[0].stripeSubscriptionId).toBe('sub_test_123');
    expect(userSubscriptions[0].status).toBe('active');

    // 5. Verify idempotency record
    const isProcessed = await idempotencyRepo.isProcessed(event.id);
    expect(isProcessed).toBe(true);
  });

  it('handles duplicate webhook delivery', async () => {
    // Create user
    const [user] = await db
      .insert(users)
      .values({
        email: 'test@example.com',
        stripe_customer_id: 'cus_test_123',
      })
      .returning();

    const event = createTestSubscriptionEvent('customer.subscription.created');

    // Process event twice
    await db.transaction(async (tx) => {
      const repos = createTransactionRepos(tx);
      await handleWebhookEvent(event, { ...repos });
    });

    await db.transaction(async (tx) => {
      const repos = createTransactionRepos(tx);
      const result = await handleWebhookEvent(event, { ...repos });

      // Second processing should be skipped
      expect(result.skipped).toBe(true);
      expect(result.skipReason).toBe('already_processed');
    });

    // Should still only have 1 subscription
    const userSubscriptions = await subscriptionRepo.getAllForEntity!(user.id);
    expect(userSubscriptions).toHaveLength(1);
  });
});
