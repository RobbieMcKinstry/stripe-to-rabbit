/**
 * Tests for Drizzle billable entity field helpers.
 */

import { describe, it, expect } from 'vitest';
import { pgTable, serial, text } from 'drizzle-orm/pg-core';
import { stripeBillableFields, stripeBillableFieldsWithPaymentMethod } from './billable';
import type { InferSelectModel } from 'drizzle-orm';

describe('stripeBillableFields', () => {
  it('adds stripe_customer_id field to schema', () => {
    const testTable = pgTable('test', {
      id: serial('id').primaryKey(),
      ...stripeBillableFields(),
    });

    // Verify the field exists and is configured correctly
    expect(testTable.stripe_customer_id).toBeDefined();
    expect(testTable.stripe_customer_id.name).toBe('stripe_customer_id');
    expect(testTable.stripe_customer_id.dataType).toBe('string');
  });

  it('creates nullable stripe_customer_id field', () => {
    const testTable = pgTable('test', {
      id: serial('id').primaryKey(),
      ...stripeBillableFields(),
    });

    // Verify field is nullable (required is false)
    expect(testTable.stripe_customer_id.notNull).toBe(false);
  });

  it('infers correct TypeScript types', () => {
    const users = pgTable('users', {
      id: serial('id').primaryKey(),
      email: text('email').notNull(),
      ...stripeBillableFields(),
    });

    type User = InferSelectModel<typeof users>;

    // Type assertion to verify the inferred type is correct
    const user: User = {
      id: 1,
      email: 'test@example.com',
      stripe_customer_id: 'cus_xxxxxxxxxxxxx',
    };

    expect(user.id).toBe(1);
    expect(user.stripe_customer_id).toBe('cus_xxxxxxxxxxxxx');

    // Verify null is also valid
    const userWithoutStripe: User = {
      id: 2,
      email: 'test2@example.com',
      stripe_customer_id: null,
    };

    expect(userWithoutStripe.stripe_customer_id).toBeNull();
  });
});

describe('stripeBillableFieldsWithPaymentMethod', () => {
  it('adds all payment method fields', () => {
    const testTable = pgTable('test', {
      id: serial('id').primaryKey(),
      ...stripeBillableFieldsWithPaymentMethod(),
    });

    // Verify all fields exist
    expect(testTable.stripe_customer_id).toBeDefined();
    expect(testTable.payment_method_type).toBeDefined();
    expect(testTable.payment_method_last_four).toBeDefined();
    expect(testTable.payment_method_brand).toBeDefined();

    // Verify field names
    expect(testTable.payment_method_type.name).toBe('payment_method_type');
    expect(testTable.payment_method_last_four.name).toBe('payment_method_last_four');
    expect(testTable.payment_method_brand.name).toBe('payment_method_brand');
  });

  it('all payment method fields are nullable', () => {
    const testTable = pgTable('test', {
      id: serial('id').primaryKey(),
      ...stripeBillableFieldsWithPaymentMethod(),
    });

    // All payment fields should be nullable
    expect(testTable.payment_method_type.notNull).toBe(false);
    expect(testTable.payment_method_last_four.notNull).toBe(false);
    expect(testTable.payment_method_brand.notNull).toBe(false);
  });

  it('infers correct TypeScript types with payment method fields', () => {
    const users = pgTable('users', {
      id: serial('id').primaryKey(),
      email: text('email').notNull(),
      ...stripeBillableFieldsWithPaymentMethod(),
    });

    type User = InferSelectModel<typeof users>;

    // Type assertion to verify the inferred type
    const user: User = {
      id: 1,
      email: 'test@example.com',
      stripe_customer_id: 'cus_xxxxxxxxxxxxx',
      payment_method_type: 'card',
      payment_method_last_four: '4242',
      payment_method_brand: 'visa',
    };

    expect(user.payment_method_type).toBe('card');
    expect(user.payment_method_last_four).toBe('4242');
    expect(user.payment_method_brand).toBe('visa');

    // Verify null values are valid
    const userWithoutPayment: User = {
      id: 2,
      email: 'test2@example.com',
      stripe_customer_id: 'cus_yyyyyyyyyyyyy',
      payment_method_type: null,
      payment_method_last_four: null,
      payment_method_brand: null,
    };

    expect(userWithoutPayment.payment_method_type).toBeNull();
  });
});

describe('real-world usage patterns', () => {
  it('works with B2C user schema', () => {
    const users = pgTable('users', {
      id: serial('id').primaryKey(),
      email: text('email').notNull(),
      ...stripeBillableFields(),
    });

    type User = InferSelectModel<typeof users>;

    const user: User = {
      id: 1,
      email: 'john@example.com',
      stripe_customer_id: null, // User hasn't started paying yet
    };

    expect(user.stripe_customer_id).toBeNull();
  });

  it('works with B2B organization schema', () => {
    const organizations = pgTable('organizations', {
      id: serial('id').primaryKey(),
      name: text('name').notNull(),
      ...stripeBillableFieldsWithPaymentMethod(),
    });

    type Organization = InferSelectModel<typeof organizations>;

    const org: Organization = {
      id: 1,
      name: 'Acme Corp',
      stripe_customer_id: 'cus_acme123',
      payment_method_type: 'card',
      payment_method_last_four: '1234',
      payment_method_brand: 'mastercard',
    };

    expect(org.name).toBe('Acme Corp');
    expect(org.payment_method_brand).toBe('mastercard');
  });
});
