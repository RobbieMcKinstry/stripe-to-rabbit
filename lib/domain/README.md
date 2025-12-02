# Stripe Domain Model

This module provides opinionated abstractions for handling Stripe business logic while remaining database-agnostic.

## Overview

Most Stripe integrations require similar database patterns:

- Storing Stripe customer IDs on user/organization records
- Tracking subscription status locally for fast access control
- Recording payment attempts for audit trails

This library provides **composable helpers** that add these fields to your database schema without forcing a specific table structure.

## Installation

The domain model layer requires Drizzle ORM and Postgres:

```bash
npm install drizzle-orm postgres
npm install -D drizzle-kit
```

## Quick Start

### 1. Add Billable Fields to Your Schema

```typescript
// schema/users.ts
import { pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';
import { stripeBillableFields } from '@yourlib/domain/drizzle';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name'),

  // ✨ Adds stripe_customer_id field
  ...stripeBillableFields(),

  created_at: timestamp('created_at').notNull().defaultNow(),
  updated_at: timestamp('updated_at').notNull().defaultNow(),
});
```

### 2. Generate Migration

```bash
npx drizzle-kit generate:pg
```

This creates a migration that adds:

```sql
ALTER TABLE users ADD COLUMN stripe_customer_id TEXT UNIQUE;
```

### 3. Use in Your Application

```typescript
import { db } from './db';
import { users } from './schema/users';
import { eq } from 'drizzle-orm';

// Find user by Stripe customer ID (from webhook)
const user = await db
  .select()
  .from(users)
  .where(eq(users.stripe_customer_id, stripeCustomerId))
  .limit(1);

// Update user's Stripe customer ID after creating customer
await db.update(users).set({ stripe_customer_id: 'cus_xxxxxxxxxxxxx' }).where(eq(users.id, userId));
```

## API Reference

### `stripeBillableFields()`

Adds the minimal field required for a billable entity:

**Fields Added:**

- `stripe_customer_id` - TEXT, nullable, unique

**Example:**

```typescript
export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  ...stripeBillableFields(),
});
```

**Type Inference:**

```typescript
type User = InferSelectModel<typeof users>;
// { id: number; stripe_customer_id: string | null }
```

### `stripeBillableFieldsWithPaymentMethod()`

Extends `stripeBillableFields()` with payment method display info:

**Fields Added:**

- `stripe_customer_id` - TEXT, nullable, unique
- `payment_method_type` - TEXT, nullable (e.g., "card", "us_bank_account")
- `payment_method_last_four` - TEXT, nullable (e.g., "4242")
- `payment_method_brand` - TEXT, nullable (e.g., "visa", "mastercard")

**Example:**

```typescript
export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  ...stripeBillableFieldsWithPaymentMethod(),
});
```

**⚠️ Important:** These fields are **display-only**. Never use them to process payments. Always fetch the current payment method from Stripe when charging.

### `stripeSubscriptionFields()`

Adds core subscription fields for tracking recurring billing locally:

**Fields Added:**

- `stripe_subscription_id` - TEXT, required, unique
- `stripe_price_id` - TEXT, required (the plan/tier)
- `status` - TEXT, required (active, canceled, trialing, etc.)
- `current_period_start` - TIMESTAMP, required
- `current_period_end` - TIMESTAMP, required (next billing date)
- `cancel_at_period_end` - BOOLEAN, required, default false
- `trial_end` - TIMESTAMP, nullable

**Example:**

```typescript
export const subscriptions = pgTable('subscriptions', {
  id: serial('id').primaryKey(),
  user_id: uuid('user_id')
    .notNull()
    .references(() => users.id),
  ...stripeSubscriptionFields(),
  created_at: timestamp('created_at').notNull().defaultNow(),
  updated_at: timestamp('updated_at').notNull().defaultNow(),
});
```

**Design Decision:** Subscriptions should be in a **separate table**, not columns on your users/organizations table, because:

1. Customers can have multiple subscriptions
2. Subscription data changes frequently (renewals, status updates)
3. Cleaner separation of concerns

**Type Inference:**

```typescript
type Subscription = InferSelectModel<typeof subscriptions>;
// {
//   id: number;
//   user_id: string;
//   stripe_subscription_id: string;
//   stripe_price_id: string;  // ← Use this for access control!
//   status: string;
//   current_period_end: Date;  // ← Next billing date
//   cancel_at_period_end: boolean;
//   trial_end: Date | null;
//   ...
// }
```

### `stripeSubscriptionFieldsWithQuantity()`

Extends `stripeSubscriptionFields()` with quantity field for per-seat pricing:

**Additional Field:**

- `quantity` - TEXT, required, default "1"

**Example:**

```typescript
// For B2B SaaS with per-seat pricing
export const subscriptions = pgTable('subscriptions', {
  id: serial('id').primaryKey(),
  organization_id: uuid('organization_id').references(() => organizations.id),
  ...stripeSubscriptionFieldsWithQuantity(),
});

// Usage: "This org has 15 seats"
// subscription.quantity === "15"
```

## Common Patterns

### B2C SaaS (Individual Users)

Each user is a separate Stripe customer:

```typescript
export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  email: text('email').notNull().unique(),
  ...stripeBillableFields(),
});
```

### B2B SaaS (Organizations)

Organizations are billed, not individual users:

```typescript
export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  ...stripeBillableFieldsWithPaymentMethod(),
});

export const organizationMembers = pgTable('organization_members', {
  id: uuid('id').primaryKey(),
  organization_id: uuid('organization_id').references(() => organizations.id),
  email: text('email').notNull(),
  // No Stripe fields - billing happens at org level
});
```

### Hybrid Model (GitHub-style)

Both personal and organization accounts can be billed:

```typescript
export const accounts = pgTable('accounts', {
  id: uuid('id').primaryKey(),
  type: text('type').notNull(), // 'personal' | 'organization'
  name: text('name').notNull(),
  ...stripeBillableFields(),
});
```

## Design Philosophy

### Why Composable Helpers Instead of Base Classes?

❌ **Anti-pattern:** Base entity classes

```typescript
class Customer extends BaseStripeEntity {
  // Forces OOP, tight coupling
}
```

✅ **This library:** Composable field mixins

```typescript
const users = pgTable('users', {
  ...stripeBillableFields(), // Flexible, composable
});
```

### Why Minimal Fields?

This library only adds fields that are:

1. **Universal** - Used by all Stripe integrations
2. **Performance-critical** - Needed for fast local queries
3. **Safe to cache** - Won't become stale quickly

We DON'T add fields like:

- Subscription details (you'll create a separate `subscriptions` table)
- Customer metadata (stored in Stripe, fetched when needed)
- Payment history (separate `payments` table)

### Why TEXT Instead of VARCHAR?

In Postgres, `TEXT` and `VARCHAR` have identical performance characteristics, but `TEXT`:

- Has no length limit (Stripe IDs are consistent but could change format)
- Is simpler (no arbitrary length decisions)
- Is the Postgres-recommended type for variable-length strings

See: [Postgres Documentation on Character Types](https://www.postgresql.org/docs/current/datatype-character.html)

## Next Steps

See the [examples directory](./examples/) for complete schema examples:

- [user-schema.example.ts](./examples/user-schema.example.ts) - B2C, B2B, and hybrid billable entity patterns
- [subscription-schema.example.ts](./examples/subscription-schema.example.ts) - Subscription tables, per-seat pricing, subscription items

## TypeScript Types

This module also exports domain types for building repositories:

```typescript
import type {
  BillableEntity,
  PaymentAttempt,
  PaymentStatus,
  Subscription,
  SubscriptionItem,
  SubscriptionStatus,
} from '@yourlib/domain';
```

These types define the minimal data contracts for payment and subscription logic, regardless of your database implementation.
