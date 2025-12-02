/**
 * Example schemas demonstrating how to use stripeBillableFields() with Drizzle ORM.
 *
 * These examples show different use cases:
 * 1. B2C SaaS: Individual users as billable entities
 * 2. B2B SaaS: Organizations as billable entities
 * 3. Multi-tenant: Accounts with team members
 *
 * Copy and adapt these patterns for your application.
 */

import { pgTable, serial, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { stripeBillableFields, stripeBillableFieldsWithPaymentMethod } from '../drizzle/billable';

// ============================================================================
// Example 1: B2C SaaS - Individual Users as Billable Entities
// ============================================================================

/**
 * Basic user table with Stripe billable fields.
 * Each user is a separate Stripe customer.
 *
 * Use case: Individual subscription SaaS (e.g., productivity app, design tool)
 */
export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name'),

  // Spread Stripe billable fields
  ...stripeBillableFields(),

  created_at: timestamp('created_at').notNull().defaultNow(),
  updated_at: timestamp('updated_at').notNull().defaultNow(),
});

/**
 * User table with payment method display info.
 * Useful if you show "Visa ending in 4242" in your UI.
 *
 * Use case: Apps that display payment method info in settings/billing page
 */
export const usersWithPaymentInfo = pgTable('users', {
  id: serial('id').primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name'),

  // Spread Stripe billable fields with payment method info
  ...stripeBillableFieldsWithPaymentMethod(),

  created_at: timestamp('created_at').notNull().defaultNow(),
  updated_at: timestamp('updated_at').notNull().defaultNow(),
});

// ============================================================================
// Example 2: B2B SaaS - Organizations as Billable Entities
// ============================================================================

/**
 * Organizations table where the organization is the billable entity.
 * Individual users belong to organizations but don't have Stripe customers.
 *
 * Use case: Team collaboration tools, B2B platforms (e.g., Slack, Notion)
 */
export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),

  // Organization is the billable entity
  ...stripeBillableFieldsWithPaymentMethod(),

  created_at: timestamp('created_at').notNull().defaultNow(),
  updated_at: timestamp('updated_at').notNull().defaultNow(),
});

/**
 * Organization members (users) - NOT billable entities.
 * Only the organization has a Stripe customer ID.
 */
export const organizationMembers = pgTable('organization_members', {
  id: uuid('id').primaryKey(),
  organization_id: uuid('organization_id')
    .notNull()
    .references(() => organizations.id),
  email: text('email').notNull(),
  name: text('name'),
  role: text('role').notNull(), // 'owner' | 'admin' | 'member'

  // No Stripe fields here - billing happens at org level
  created_at: timestamp('created_at').notNull().defaultNow(),
});

// ============================================================================
// Example 3: Hybrid Model - Both Users and Organizations Can Be Billable
// ============================================================================

/**
 * Accounts table - can represent either individual or team accounts.
 * The billable entity abstraction works for both.
 *
 * Use case: GitHub-style model (personal accounts + organization accounts)
 */
export const accounts = pgTable('accounts', {
  id: uuid('id').primaryKey(),
  type: text('type').notNull(), // 'personal' | 'organization'
  name: text('name').notNull(),

  // Both personal and org accounts can be billed
  ...stripeBillableFieldsWithPaymentMethod(),

  created_at: timestamp('created_at').notNull().defaultNow(),
  updated_at: timestamp('updated_at').notNull().defaultNow(),
});

// ============================================================================
// Type Inference Examples
// ============================================================================

/**
 * Drizzle automatically infers types from your schema.
 * The stripe_customer_id will be typed as `string | null`.
 */
import type { InferSelectModel } from 'drizzle-orm';

type User = InferSelectModel<typeof users>;
// User type includes:
// {
//   id: number;
//   email: string;
//   name: string | null;
//   stripe_customer_id: string | null;  // ← Added by stripeBillableFields()
//   created_at: Date;
//   updated_at: Date;
// }

type UserWithPayment = InferSelectModel<typeof usersWithPaymentInfo>;
// UserWithPayment type includes:
// {
//   id: number;
//   email: string;
//   name: string | null;
//   stripe_customer_id: string | null;
//   payment_method_type: string | null;        // ← Added by extended helper
//   payment_method_last_four: string | null;
//   payment_method_brand: string | null;
//   created_at: Date;
//   updated_at: Date;
// }

type Organization = InferSelectModel<typeof organizations>;
// Organization also has stripe_customer_id from the same helper

// ============================================================================
// Usage in Queries
// ============================================================================

/**
 * Example: Find all users with Stripe customers
 */
// import { db } from './db';
// import { isNotNull } from 'drizzle-orm';
//
// const billableUsers = await db
//   .select()
//   .from(users)
//   .where(isNotNull(users.stripe_customer_id));

/**
 * Example: Get user by Stripe customer ID (from webhook)
 */
// import { eq } from 'drizzle-orm';
//
// async function getUserByStripeCustomerId(stripeCustomerId: string) {
//   return db
//     .select()
//     .from(users)
//     .where(eq(users.stripe_customer_id, stripeCustomerId))
//     .limit(1);
// }
