/**
 * Example subscription table schemas using Drizzle ORM.
 *
 * These examples demonstrate the recommended pattern of storing subscriptions
 * in a separate table rather than as columns on the billable entity table.
 *
 * Patterns shown:
 * 1. Single subscription per customer (most common)
 * 2. Multiple subscriptions per customer (advanced)
 * 3. Per-seat subscriptions (B2B SaaS)
 * 4. Subscription items (multiple products in one subscription)
 */

import { pgTable, serial, uuid, text, timestamp, integer } from 'drizzle-orm/pg-core';
import {
  stripeBillableFields,
  stripeSubscriptionFields,
  stripeSubscriptionFieldsWithQuantity,
} from '../drizzle';

// ============================================================================
// Example 1: Single Subscription Per User (B2C SaaS)
// ============================================================================

/**
 * Users table - the billable entity.
 */
export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name'),

  // Users can be Stripe customers
  ...stripeBillableFields(),

  created_at: timestamp('created_at').notNull().defaultNow(),
  updated_at: timestamp('updated_at').notNull().defaultNow(),
});

/**
 * Subscriptions table - stores subscription state locally.
 *
 * Design decision: Separate table instead of columns on users table because:
 * - Subscription data changes frequently (renewals, status updates)
 * - Keeps user table clean and focused
 * - Easier to query subscription-specific data
 * - Supports multiple subscriptions per user in the future
 *
 * Use case: SaaS with monthly/annual plans (Free, Pro, Enterprise)
 */
export const subscriptions = pgTable('subscriptions', {
  id: serial('id').primaryKey(),

  // Foreign key to the billable entity (user)
  user_id: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),

  // Stripe subscription fields
  ...stripeSubscriptionFields(),

  created_at: timestamp('created_at').notNull().defaultNow(),
  updated_at: timestamp('updated_at').notNull().defaultNow(),
});

// ============================================================================
// Example 2: Organization Subscriptions (B2B SaaS)
// ============================================================================

/**
 * Organizations table - the billable entity for B2B.
 */
export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),

  // Organizations are Stripe customers
  ...stripeBillableFields(),

  created_at: timestamp('created_at').notNull().defaultNow(),
  updated_at: timestamp('updated_at').notNull().defaultNow(),
});

/**
 * Organization subscriptions with quantity (per-seat pricing).
 *
 * Use case: Team collaboration tool where orgs pay per seat
 * Example: $10/user/month, org has 15 users = $150/month
 */
export const organizationSubscriptions = pgTable('subscriptions', {
  id: serial('id').primaryKey(),

  organization_id: uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),

  // Includes quantity field for per-seat billing
  ...stripeSubscriptionFieldsWithQuantity(),

  created_at: timestamp('created_at').notNull().defaultNow(),
  updated_at: timestamp('updated_at').notNull().defaultNow(),
});

// ============================================================================
// Example 3: Subscription Items (Multiple Products Per Subscription)
// ============================================================================

/**
 * Advanced: Subscription items table.
 *
 * Use when a single subscription can include multiple products/prices.
 * Example: Customer subscribes to both "API Access" and "Premium Support"
 *
 * This matches Stripe's data model where subscriptions have line items.
 *
 * Note: Most SaaS apps DON'T need this - only use if you genuinely have
 * complex multi-product subscriptions.
 */
export const subscriptionItems = pgTable('subscription_items', {
  id: serial('id').primaryKey(),

  // Foreign key to parent subscription
  subscription_id: integer('subscription_id')
    .notNull()
    .references(() => subscriptions.id, { onDelete: 'cascade' }),

  // Stripe subscription item ID
  stripe_subscription_item_id: text('stripe_subscription_item_id').notNull().unique(),

  // Which product/price this item represents
  stripe_price_id: text('stripe_price_id').notNull(),

  // Quantity for this specific item
  quantity: integer('quantity').notNull().default(1),

  created_at: timestamp('created_at').notNull().defaultNow(),
  updated_at: timestamp('updated_at').notNull().defaultNow(),
});

// ============================================================================
// Type Inference and Usage Examples
// ============================================================================

import type { InferSelectModel } from 'drizzle-orm';

/**
 * Inferred TypeScript types from the schemas.
 */
type Subscription = InferSelectModel<typeof subscriptions>;
// {
//   id: number;
//   user_id: string;
//   stripe_subscription_id: string;
//   stripe_price_id: string;
//   status: string;
//   current_period_start: Date;
//   current_period_end: Date;
//   cancel_at_period_end: boolean;
//   trial_end: Date | null;
//   created_at: Date;
//   updated_at: Date;
// }

type OrganizationSubscription = InferSelectModel<typeof organizationSubscriptions>;
// Includes quantity field in addition to the above

/**
 * Example: Check if user has active subscription
 */
// import { db } from './db';
// import { and, eq, or } from 'drizzle-orm';
//
// async function hasActiveSubscription(userId: string): Promise<boolean> {
//   const sub = await db.query.subscriptions.findFirst({
//     where: and(
//       eq(subscriptions.user_id, userId),
//       or(
//         eq(subscriptions.status, 'active'),
//         eq(subscriptions.status, 'trialing')
//       )
//     )
//   });
//   return sub !== undefined;
// }

/**
 * Example: Get user's current plan (price ID)
 */
// async function getUserPlan(userId: string): Promise<string | null> {
//   const sub = await db.query.subscriptions.findFirst({
//     where: and(
//       eq(subscriptions.user_id, userId),
//       eq(subscriptions.status, 'active')
//     )
//   });
//   return sub?.stripe_price_id ?? null;
// }

/**
 * Example: Check if subscription will cancel
 */
// async function willSubscriptionCancel(userId: string): Promise<boolean> {
//   const sub = await db.query.subscriptions.findFirst({
//     where: eq(subscriptions.user_id, userId)
//   });
//   return sub?.cancel_at_period_end ?? false;
// }

/**
 * Example: Update subscription from webhook
 */
// import type Stripe from 'stripe';
//
// async function updateSubscriptionFromWebhook(
//   event: Stripe.CustomerSubscriptionUpdatedEvent
// ) {
//   const stripeSubscription = event.data.object;
//
//   await db
//     .update(subscriptions)
//     .set({
//       stripe_price_id: stripeSubscription.items.data[0].price.id,
//       status: stripeSubscription.status,
//       current_period_start: new Date(stripeSubscription.current_period_start * 1000),
//       current_period_end: new Date(stripeSubscription.current_period_end * 1000),
//       cancel_at_period_end: stripeSubscription.cancel_at_period_end,
//       trial_end: stripeSubscription.trial_end
//         ? new Date(stripeSubscription.trial_end * 1000)
//         : null,
//       updated_at: new Date(),
//     })
//     .where(eq(subscriptions.stripe_subscription_id, stripeSubscription.id));
// }
