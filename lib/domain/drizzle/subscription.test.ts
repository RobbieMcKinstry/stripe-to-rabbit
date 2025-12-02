/**
 * Tests for Drizzle subscription field helpers.
 */

import { describe, it, expect } from 'vitest';
import { pgTable, serial, uuid, timestamp } from 'drizzle-orm/pg-core';
import { stripeSubscriptionFields, stripeSubscriptionFieldsWithQuantity } from './subscription';
import type { InferSelectModel } from 'drizzle-orm';

describe('stripeSubscriptionFields', () => {
  it('adds all required subscription fields', () => {
    const testTable = pgTable('subscriptions', {
      id: serial('id').primaryKey(),
      ...stripeSubscriptionFields(),
    });

    // Verify all fields exist
    expect(testTable.stripe_subscription_id).toBeDefined();
    expect(testTable.stripe_price_id).toBeDefined();
    expect(testTable.status).toBeDefined();
    expect(testTable.current_period_start).toBeDefined();
    expect(testTable.current_period_end).toBeDefined();
    expect(testTable.cancel_at_period_end).toBeDefined();
    expect(testTable.trial_end).toBeDefined();

    // Verify field names
    expect(testTable.stripe_subscription_id.name).toBe('stripe_subscription_id');
    expect(testTable.stripe_price_id.name).toBe('stripe_price_id');
    expect(testTable.status.name).toBe('status');
    expect(testTable.current_period_start.name).toBe('current_period_start');
    expect(testTable.current_period_end.name).toBe('current_period_end');
    expect(testTable.cancel_at_period_end.name).toBe('cancel_at_period_end');
    expect(testTable.trial_end.name).toBe('trial_end');
  });

  it('stripe_subscription_id is required and unique', () => {
    const testTable = pgTable('subscriptions', {
      id: serial('id').primaryKey(),
      ...stripeSubscriptionFields(),
    });

    // Should be required (notNull)
    expect(testTable.stripe_subscription_id.notNull).toBe(true);

    // Should be unique
    expect(testTable.stripe_subscription_id.isUnique).toBe(true);
  });

  it('required fields are not nullable', () => {
    const testTable = pgTable('subscriptions', {
      id: serial('id').primaryKey(),
      ...stripeSubscriptionFields(),
    });

    // These fields should be required
    expect(testTable.stripe_subscription_id.notNull).toBe(true);
    expect(testTable.stripe_price_id.notNull).toBe(true);
    expect(testTable.status.notNull).toBe(true);
    expect(testTable.current_period_start.notNull).toBe(true);
    expect(testTable.current_period_end.notNull).toBe(true);
    expect(testTable.cancel_at_period_end.notNull).toBe(true);
  });

  it('trial_end is nullable', () => {
    const testTable = pgTable('subscriptions', {
      id: serial('id').primaryKey(),
      ...stripeSubscriptionFields(),
    });

    // trial_end should be optional (not all subscriptions have trials)
    expect(testTable.trial_end.notNull).toBe(false);
  });

  it('infers correct TypeScript types', () => {
    const subscriptions = pgTable('subscriptions', {
      id: serial('id').primaryKey(),
      user_id: uuid('user_id').notNull(),
      ...stripeSubscriptionFields(),
      created_at: timestamp('created_at').notNull().defaultNow(),
    });

    type Subscription = InferSelectModel<typeof subscriptions>;

    // Type assertion to verify the inferred type is correct
    const subscription: Subscription = {
      id: 1,
      user_id: '550e8400-e29b-41d4-a716-446655440000',
      stripe_subscription_id: 'sub_xxxxxxxxxxxxx',
      stripe_price_id: 'price_xxxxxxxxxxxxx',
      status: 'active',
      current_period_start: new Date('2024-01-01'),
      current_period_end: new Date('2024-02-01'),
      cancel_at_period_end: false,
      trial_end: null,
      created_at: new Date(),
    };

    expect(subscription.stripe_subscription_id).toBe('sub_xxxxxxxxxxxxx');
    expect(subscription.status).toBe('active');
    expect(subscription.cancel_at_period_end).toBe(false);
    expect(subscription.trial_end).toBeNull();
  });

  it('supports trial_end with a date', () => {
    const subscriptions = pgTable('subscriptions', {
      id: serial('id').primaryKey(),
      user_id: uuid('user_id').notNull(),
      ...stripeSubscriptionFields(),
    });

    type Subscription = InferSelectModel<typeof subscriptions>;

    const subscription: Subscription = {
      id: 1,
      user_id: '550e8400-e29b-41d4-a716-446655440000',
      stripe_subscription_id: 'sub_trial123',
      stripe_price_id: 'price_pro',
      status: 'trialing',
      current_period_start: new Date('2024-01-01'),
      current_period_end: new Date('2024-02-01'),
      cancel_at_period_end: false,
      trial_end: new Date('2024-01-15'), // Trial ends mid-period
    };

    expect(subscription.trial_end).toBeInstanceOf(Date);
  });
});

describe('stripeSubscriptionFieldsWithQuantity', () => {
  it('includes all base subscription fields plus quantity', () => {
    const testTable = pgTable('subscriptions', {
      id: serial('id').primaryKey(),
      ...stripeSubscriptionFieldsWithQuantity(),
    });

    // All base fields
    expect(testTable.stripe_subscription_id).toBeDefined();
    expect(testTable.stripe_price_id).toBeDefined();
    expect(testTable.status).toBeDefined();
    expect(testTable.current_period_start).toBeDefined();
    expect(testTable.current_period_end).toBeDefined();
    expect(testTable.cancel_at_period_end).toBeDefined();
    expect(testTable.trial_end).toBeDefined();

    // Additional field
    expect(testTable.quantity).toBeDefined();
    expect(testTable.quantity.name).toBe('quantity');
  });

  it('quantity field has default value of 1', () => {
    const testTable = pgTable('subscriptions', {
      id: serial('id').primaryKey(),
      ...stripeSubscriptionFieldsWithQuantity(),
    });

    expect(testTable.quantity.default).toBe('1');
  });

  it('infers correct TypeScript types with quantity', () => {
    const subscriptions = pgTable('subscriptions', {
      id: serial('id').primaryKey(),
      organization_id: uuid('organization_id').notNull(),
      ...stripeSubscriptionFieldsWithQuantity(),
    });

    type Subscription = InferSelectModel<typeof subscriptions>;

    // Type assertion for per-seat subscription
    const subscription: Subscription = {
      id: 1,
      organization_id: '550e8400-e29b-41d4-a716-446655440000',
      stripe_subscription_id: 'sub_org123',
      stripe_price_id: 'price_team',
      status: 'active',
      current_period_start: new Date('2024-01-01'),
      current_period_end: new Date('2024-02-01'),
      cancel_at_period_end: false,
      trial_end: null,
      quantity: '15', // 15 seats
    };

    expect(subscription.quantity).toBe('15');
  });
});

describe('real-world subscription scenarios', () => {
  it('works with B2C user subscription', () => {
    const users = pgTable('users', {
      id: uuid('id').primaryKey(),
    });

    const subscriptions = pgTable('subscriptions', {
      id: serial('id').primaryKey(),
      user_id: uuid('user_id')
        .notNull()
        .references(() => users.id),
      ...stripeSubscriptionFields(),
    });

    type Subscription = InferSelectModel<typeof subscriptions>;

    const userSub: Subscription = {
      id: 1,
      user_id: 'user-uuid',
      stripe_subscription_id: 'sub_individual',
      stripe_price_id: 'price_pro_monthly',
      status: 'active',
      current_period_start: new Date('2024-12-01'),
      current_period_end: new Date('2025-01-01'),
      cancel_at_period_end: false,
      trial_end: null,
    };

    expect(userSub.status).toBe('active');
  });

  it('works with B2B organization subscription with seats', () => {
    const organizations = pgTable('organizations', {
      id: uuid('id').primaryKey(),
    });

    const subscriptions = pgTable('subscriptions', {
      id: serial('id').primaryKey(),
      organization_id: uuid('organization_id')
        .notNull()
        .references(() => organizations.id),
      ...stripeSubscriptionFieldsWithQuantity(),
    });

    type Subscription = InferSelectModel<typeof subscriptions>;

    const orgSub: Subscription = {
      id: 1,
      organization_id: 'org-uuid',
      stripe_subscription_id: 'sub_acme_corp',
      stripe_price_id: 'price_enterprise',
      status: 'active',
      current_period_start: new Date('2024-12-01'),
      current_period_end: new Date('2025-12-01'), // Annual
      cancel_at_period_end: false,
      trial_end: null,
      quantity: '50', // 50 seats
    };

    expect(orgSub.quantity).toBe('50');
    expect(orgSub.stripe_price_id).toBe('price_enterprise');
  });

  it('handles subscription scheduled for cancellation', () => {
    const subscriptions = pgTable('subscriptions', {
      id: serial('id').primaryKey(),
      user_id: uuid('user_id').notNull(),
      ...stripeSubscriptionFields(),
    });

    type Subscription = InferSelectModel<typeof subscriptions>;

    const cancelingSub: Subscription = {
      id: 1,
      user_id: 'user-uuid',
      stripe_subscription_id: 'sub_canceling',
      stripe_price_id: 'price_pro',
      status: 'active', // Still active until period end
      current_period_start: new Date('2024-12-01'),
      current_period_end: new Date('2025-01-01'),
      cancel_at_period_end: true, // Will cancel on Jan 1
      trial_end: null,
    };

    expect(cancelingSub.cancel_at_period_end).toBe(true);
    expect(cancelingSub.status).toBe('active'); // Still has access
  });

  it('handles subscription in trial period', () => {
    const subscriptions = pgTable('subscriptions', {
      id: serial('id').primaryKey(),
      user_id: uuid('user_id').notNull(),
      ...stripeSubscriptionFields(),
    });

    type Subscription = InferSelectModel<typeof subscriptions>;

    const trialSub: Subscription = {
      id: 1,
      user_id: 'user-uuid',
      stripe_subscription_id: 'sub_trial',
      stripe_price_id: 'price_pro',
      status: 'trialing',
      current_period_start: new Date('2024-12-01'),
      current_period_end: new Date('2025-01-01'),
      cancel_at_period_end: false,
      trial_end: new Date('2024-12-15'), // Trial ends Dec 15
    };

    expect(trialSub.status).toBe('trialing');
    expect(trialSub.trial_end).toBeInstanceOf(Date);
  });
});
