/**
 * Example idempotency table schema for webhook event tracking.
 *
 * This table ensures webhook events are processed exactly once, even if
 * Stripe sends the same event multiple times (which happens frequently).
 *
 * ## Why Idempotency Matters
 *
 * Stripe may send the same webhook event multiple times due to:
 * - Network retries (your server didn't respond with 200 fast enough)
 * - Stripe's internal retry logic
 * - You clicking "Resend" in the Stripe dashboard
 *
 * Without idempotency tracking, you might:
 * - Create duplicate subscription records
 * - Double-charge customers
 * - Send duplicate emails
 *
 * ## Implementation Strategy
 *
 * 1. Check if event ID exists BEFORE processing
 * 2. Process the webhook
 * 3. Insert event ID AFTER successful processing
 * 4. Use database transactions to make this atomic
 */

import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * Minimal idempotency table.
 *
 * Stores just the event ID and when it was processed.
 */
export const webhookEvents = pgTable('webhook_events', {
  /**
   * Stripe event ID (e.g., "evt_xxxxxxxxxxxxx").
   * Primary key ensures uniqueness - can't insert the same event twice.
   */
  event_id: text('event_id').primaryKey(),

  /**
   * When the event was successfully processed.
   * Useful for cleanup and debugging.
   */
  processed_at: timestamp('processed_at').notNull().defaultNow(),
});

/**
 * Extended idempotency table with additional tracking.
 *
 * Includes event type and optional error tracking for debugging.
 */
export const webhookEventsExtended = pgTable('webhook_events', {
  event_id: text('event_id').primaryKey(),

  /**
   * Event type (e.g., "customer.subscription.updated").
   * Useful for analytics and debugging.
   */
  event_type: text('event_type').notNull(),

  /**
   * When the event was successfully processed.
   */
  processed_at: timestamp('processed_at').notNull().defaultNow(),

  /**
   * Optional: Track processing errors.
   * If event processing failed, store the error here.
   */
  error: text('error'),

  /**
   * Optional: Number of processing attempts.
   * Useful if you implement retry logic.
   */
  attempt_count: text('attempt_count').default('1'),
});

/**
 * Migration SQL for the minimal table.
 */
export const createWebhookEventsTableSQL = `
CREATE TABLE IF NOT EXISTS webhook_events (
  event_id TEXT PRIMARY KEY,
  processed_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Index for cleanup queries (delete old events)
CREATE INDEX IF NOT EXISTS idx_webhook_events_processed_at
ON webhook_events(processed_at);
`;

// ============================================================================
// Usage Example
// ============================================================================

import type { InferSelectModel } from 'drizzle-orm';

type WebhookEvent = InferSelectModel<typeof webhookEvents>;
// {
//   event_id: string;
//   processed_at: Date;
// }

/**
 * Example: Using idempotency in webhook handler
 */
// import { DrizzleIdempotencyRepository } from '@yourlib/domain/drizzle/repositories';
// import { db } from './db';
// import { webhookEvents } from './schema';
// import Stripe from 'stripe';
//
// const idempotencyRepo = new DrizzleIdempotencyRepository(db, webhookEvents);
//
// export async function handleStripeWebhook(req: Request) {
//   const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
//   const sig = req.headers.get('stripe-signature');
//   const event = stripe.webhooks.constructEvent(
//     await req.text(),
//     sig,
//     process.env.STRIPE_WEBHOOK_SECRET
//   );
//
//   // Check if already processed
//   if (await idempotencyRepo.isProcessed(event.id)) {
//     console.log(`Event ${event.id} already processed, skipping`);
//     return new Response('OK', { status: 200 });
//   }
//
//   // Process the event in a transaction
//   await db.transaction(async (tx) => {
//     // Handle the event
//     await handleSubscriptionUpdated(event, tx);
//
//     // Mark as processed WITHIN the transaction
//     await idempotencyRepo.markProcessed(event.id);
//   });
//
//   return new Response('OK', { status: 200 });
// }

/**
 * Example: Cleanup job (run daily via cron)
 */
// import { DrizzleIdempotencyRepository } from '@yourlib/domain/drizzle/repositories';
//
// export async function cleanupOldWebhookEvents() {
//   const idempotencyRepo = new DrizzleIdempotencyRepository(db, webhookEvents);
//
//   // Delete events older than 30 days
//   const thirtyDaysAgo = new Date();
//   thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
//
//   const deletedCount = await idempotencyRepo.cleanupOldEvents(thirtyDaysAgo);
//   console.log(`Cleaned up ${deletedCount} old webhook events`);
// }

/**
 * Example: Query for debugging
 */
// import { db } from './db';
// import { webhookEvents } from './schema';
// import { desc } from 'drizzle-orm';
//
// // Get last 100 processed events
// const recentEvents = await db
//   .select()
//   .from(webhookEvents)
//   .orderBy(desc(webhookEvents.processed_at))
//   .limit(100);
//
// // Check if specific event was processed
// const wasProcessed = await db.query.webhookEvents.findFirst({
//   where: eq(webhookEvents.event_id, 'evt_xxxxxxxxxxxxx')
// });
