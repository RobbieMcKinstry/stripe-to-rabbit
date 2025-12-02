/**
 * Drizzle ORM helpers for adding Stripe subscription fields to your tables.
 *
 * This module provides composable helpers for managing subscription data.
 * Following Laravel Cashier's proven pattern, subscriptions should typically
 * be stored in a separate table rather than on the billable entity table.
 *
 * @example
 * ```typescript
 * import { pgTable, serial, uuid, timestamp } from 'drizzle-orm/pg-core';
 * import { stripeSubscriptionFields } from '@yourlib/domain/drizzle';
 *
 * export const subscriptions = pgTable('subscriptions', {
 *   id: serial('id').primaryKey(),
 *   user_id: uuid('user_id').notNull().references(() => users.id),
 *   ...stripeSubscriptionFields(),
 *   created_at: timestamp('created_at').notNull().defaultNow(),
 *   updated_at: timestamp('updated_at').notNull().defaultNow(),
 * });
 * ```
 */

import { text, timestamp, boolean } from 'drizzle-orm/pg-core';

/**
 * Adds core Stripe subscription fields to a Drizzle table.
 *
 * This helper adds the minimal set of fields needed to track subscription state
 * locally, enabling fast access control decisions without hitting Stripe's API.
 *
 * **Important Design Decision:** Subscriptions should typically be in a separate
 * table, not columns on your users/organizations table, because:
 * 1. Customers can have multiple subscriptions
 * 2. Subscription data changes frequently (renewals, status updates)
 * 3. Cleaner separation of concerns
 *
 * Fields added:
 * - `stripe_subscription_id` - Stripe's subscription ID (unique, required for lookups)
 * - `stripe_price_id` - Current price/plan ID (for quick tier checks)
 * - `status` - Subscription status (active, canceled, etc.)
 * - `current_period_start` - When current billing period started
 * - `current_period_end` - When current billing period ends (next charge date)
 * - `cancel_at_period_end` - Whether subscription will cancel at period end
 * - `trial_end` - When trial ends (nullable)
 *
 * @example
 * ```typescript
 * // Basic subscription table
 * export const subscriptions = pgTable('subscriptions', {
 *   id: serial('id').primaryKey(),
 *   user_id: uuid('user_id').notNull().references(() => users.id),
 *   ...stripeSubscriptionFields(),
 *   created_at: timestamp('created_at').notNull().defaultNow(),
 * });
 * ```
 *
 * @example
 * ```typescript
 * // For organizations (B2B)
 * export const subscriptions = pgTable('subscriptions', {
 *   id: serial('id').primaryKey(),
 *   organization_id: uuid('organization_id').references(() => organizations.id),
 *   ...stripeSubscriptionFields(),
 * });
 * ```
 *
 * @returns Object with Drizzle column definitions to spread into your table
 */
export function stripeSubscriptionFields() {
  return {
    /**
     * Stripe subscription ID (e.g., "sub_xxxxxxxxxxxxx").
     *
     * Unique to ensure you don't accidentally create duplicate subscription records.
     * This is your primary key for looking up subscriptions from webhook events.
     */
    stripe_subscription_id: text('stripe_subscription_id').notNull().unique(),

    /**
     * Stripe price ID (e.g., "price_xxxxxxxxxxxxx").
     *
     * This is THE most important field for access control. Store this locally
     * so you can check "does this user have the Pro plan?" without calling Stripe.
     *
     * Example usage:
     * - user.subscription.stripe_price_id === PRICE_ID_PRO
     * - Enables instant feature gating
     */
    stripe_price_id: text('stripe_price_id').notNull(),

    /**
     * Subscription status.
     *
     * One of: active, past_due, unpaid, canceled, incomplete, incomplete_expired, trialing, paused
     *
     * Use this for access control:
     * - 'active' or 'trialing' → Grant access
     * - 'past_due' → Grace period or restrict
     * - 'canceled', 'unpaid', 'incomplete_expired' → Revoke access
     *
     * Updated via webhooks (customer.subscription.updated, etc.)
     */
    status: text('status').notNull(),

    /**
     * When the current billing period started.
     *
     * Updated on each renewal. Useful for:
     * - Displaying "Your current billing period" in UI
     * - Usage tracking (e.g., API calls this billing period)
     */
    current_period_start: timestamp('current_period_start').notNull(),

    /**
     * When the current billing period ends (next charge date).
     *
     * This is the most important date for billing UIs:
     * - "Next payment on December 15, 2024"
     * - "Your subscription renews on..."
     *
     * For monthly: ~30 days from current_period_start
     * For annual: ~365 days from current_period_start
     */
    current_period_end: timestamp('current_period_end').notNull(),

    /**
     * Whether the subscription will cancel at the end of the current period.
     *
     * true = User clicked "Cancel subscription" but still has access until period ends
     * false = Subscription will auto-renew
     *
     * Use this to show:
     * - "Your subscription will cancel on December 15"
     * - "Reactivate" button instead of "Cancel" button
     */
    cancel_at_period_end: boolean('cancel_at_period_end').notNull().default(false),

    /**
     * When the trial period ends (if subscription is in trial).
     *
     * Nullable because:
     * - Not all subscriptions have trials
     * - After trial ends, this field is no longer relevant
     *
     * Use for:
     * - "7 days left in your trial"
     * - Triggering trial_will_end webhooks (Stripe sends 3 days before)
     */
    trial_end: timestamp('trial_end'),
  };
}

/**
 * Extended subscription fields including quantity and metadata.
 *
 * Use this variant when you need:
 * - Per-seat pricing (quantity field)
 * - Custom metadata storage
 *
 * Adds all fields from stripeSubscriptionFields() plus:
 * - `quantity` - Number of seats/units
 * - `metadata` - JSONB field for custom data
 *
 * @example
 * ```typescript
 * // For per-seat SaaS (e.g., team collaboration tools)
 * export const subscriptions = pgTable('subscriptions', {
 *   id: serial('id').primaryKey(),
 *   organization_id: uuid('organization_id').references(() => organizations.id),
 *   ...stripeSubscriptionFieldsWithQuantity(),
 * });
 *
 * // Query: How many seats does this org have?
 * const subscription = await db.query.subscriptions.findFirst({
 *   where: eq(subscriptions.organization_id, orgId)
 * });
 * console.log(`Seats: ${subscription.quantity}`);
 * ```
 */
export function stripeSubscriptionFieldsWithQuantity() {
  return {
    ...stripeSubscriptionFields(),

    /**
     * Quantity of the subscription (for per-seat or per-unit pricing).
     *
     * Examples:
     * - Team plan: quantity = number of seats
     * - API plan: quantity = rate limit tier
     * - Storage plan: quantity = GB allocated
     *
     * Default is 1 for simple subscriptions.
     *
     * Updated when customer changes seat count via:
     * - Subscription update API calls
     * - Customer portal
     * - Automatic metering (for usage-based)
     */
    quantity: text('quantity').notNull().default('1'),
  };
}

/**
 * Type helper to extract subscription fields from a table schema.
 */
export type StripeSubscriptionFields = ReturnType<typeof stripeSubscriptionFields>;

/**
 * Type helper for extended subscription fields with quantity.
 */
export type StripeSubscriptionFieldsWithQuantity = ReturnType<
  typeof stripeSubscriptionFieldsWithQuantity
>;
