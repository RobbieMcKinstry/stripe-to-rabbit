/**
 * Drizzle ORM helpers for adding Stripe billable entity fields to your tables.
 *
 * This module provides composable helpers that add Stripe-related columns to your
 * Drizzle table definitions. It follows the "mixin" pattern to keep your schema
 * flexible while adding opinionated Stripe fields.
 *
 * @example
 * ```typescript
 * import { pgTable, serial, text } from 'drizzle-orm/pg-core';
 * import { stripeBillableFields } from '@yourlib/domain/drizzle';
 *
 * export const users = pgTable('users', {
 *   id: serial('id').primaryKey(),
 *   email: text('email').notNull(),
 *   ...stripeBillableFields(),
 * });
 * ```
 */

import { text } from 'drizzle-orm/pg-core';

/**
 * Adds Stripe customer ID field to a Drizzle table.
 *
 * This represents the minimal requirement for a "billable entity" - an entity
 * that can be charged via Stripe. This could be a user, organization, account,
 * or any other entity in your system.
 *
 * Fields added:
 * - `stripe_customer_id`: TEXT (nullable, unique) - Stripe's customer ID (e.g., "cus_xxxxxxxxxxxxx")
 *
 * The field is nullable because entities may exist in your system before you create
 * their Stripe customer record (e.g., during registration flow).
 *
 * @example
 * ```typescript
 * // Basic usage with a users table
 * export const users = pgTable('users', {
 *   id: serial('id').primaryKey(),
 *   email: text('email').notNull(),
 *   ...stripeBillableFields(),
 * });
 *
 * // Usage with an organizations table (B2B SaaS)
 * export const organizations = pgTable('organizations', {
 *   id: uuid('id').primaryKey(),
 *   name: text('name').notNull(),
 *   ...stripeBillableFields(),
 * });
 * ```
 *
 * @returns Object with Drizzle column definitions to spread into your table
 */
export function stripeBillableFields() {
  return {
    /**
     * Stripe customer ID (e.g., "cus_xxxxxxxxxxxxx").
     *
     * Nullable because:
     * 1. Users may exist before they're ready to pay
     * 2. Not all entities in your system may be billable
     * 3. Stripe customer creation might happen asynchronously
     *
     * Unique to ensure 1:1 mapping between your entity and Stripe customer.
     * Note: This constraint assumes each Stripe customer maps to exactly one
     * entity in your system. If you need many-to-one relationships (e.g., multiple
     * users sharing a single Stripe customer), remove the `.unique()` constraint.
     */
    stripe_customer_id: text('stripe_customer_id').unique(),
  };
}

/**
 * Extended billable fields including payment method display information.
 *
 * In addition to the customer ID, this includes fields commonly displayed in UIs
 * for showing the customer's current payment method (without storing sensitive data).
 *
 * Fields added:
 * - `stripe_customer_id`: TEXT (nullable, unique) - Stripe's customer ID
 * - `payment_method_type`: TEXT (nullable) - Type of payment method (e.g., "card", "us_bank_account")
 * - `payment_method_last_four`: TEXT (nullable) - Last 4 digits for display (e.g., "4242")
 * - `payment_method_brand`: TEXT (nullable) - Brand/network (e.g., "visa", "mastercard")
 *
 * IMPORTANT: These fields are for DISPLAY ONLY. Never use them to process payments.
 * Always fetch the current payment method from Stripe when charging.
 *
 * @example
 * ```typescript
 * // For applications that need to display payment method info
 * export const users = pgTable('users', {
 *   id: serial('id').primaryKey(),
 *   email: text('email').notNull(),
 *   ...stripeBillableFieldsWithPaymentMethod(),
 * });
 *
 * // Then in your UI:
 * // "Payment method: Visa ending in 4242"
 * ```
 *
 * @returns Object with Drizzle column definitions to spread into your table
 */
export function stripeBillableFieldsWithPaymentMethod() {
  return {
    ...stripeBillableFields(),

    /**
     * Type of the default payment method.
     * Examples: "card", "us_bank_account", "sepa_debit"
     *
     * Nullable because the customer may not have attached a payment method yet.
     */
    payment_method_type: text('payment_method_type'),

    /**
     * Last four digits of the payment method (for display purposes).
     * For cards: last 4 of card number (e.g., "4242")
     * For bank accounts: last 4 of account number
     *
     * WARNING: This is for UI display only. When charging, always fetch
     * the current payment method from Stripe to ensure it's still valid.
     */
    payment_method_last_four: text('payment_method_last_four'),

    /**
     * Brand or network of the payment method.
     * For cards: "visa", "mastercard", "amex", etc.
     * For bank accounts: bank name or "bank_account"
     *
     * Used for displaying icons and labels in the UI.
     */
    payment_method_brand: text('payment_method_brand'),
  };
}

/**
 * Type helper to extract the billable fields from a table schema.
 * Useful for creating type-safe repository implementations.
 *
 * @example
 * ```typescript
 * import { InferModel } from 'drizzle-orm';
 *
 * export const users = pgTable('users', {
 *   id: serial('id').primaryKey(),
 *   ...stripeBillableFields(),
 * });
 *
 * type User = InferModel<typeof users>;
 * // User will have stripe_customer_id: string | null
 * ```
 */
export type StripeBillableFields = ReturnType<typeof stripeBillableFields>;

/**
 * Type helper for extended billable fields with payment method info.
 */
export type StripeBillableFieldsWithPaymentMethod = ReturnType<
  typeof stripeBillableFieldsWithPaymentMethod
>;
