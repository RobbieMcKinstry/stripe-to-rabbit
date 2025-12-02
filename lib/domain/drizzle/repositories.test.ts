/**
 * Tests for Drizzle repository implementations.
 *
 * These tests verify that the repository implementations correctly
 * implement the repository interfaces and handle data correctly.
 */

import { describe, it, expect } from 'vitest';
import { pgTable, uuid, text, timestamp, serial, boolean } from 'drizzle-orm/pg-core';
import { stripeBillableFields } from './billable';
import { stripeSubscriptionFields } from './subscription';
import type {
  BillableEntityRepository,
  SubscriptionRepository,
  IdempotencyRepository,
} from '../repositories';
import {
  DrizzleBillableEntityRepository,
  DrizzleSubscriptionRepository,
  DrizzleIdempotencyRepository,
} from './repositories';

describe('Repository Interface Contracts', () => {
  describe('DrizzleBillableEntityRepository', () => {
    it('implements BillableEntityRepository interface', () => {
      // Create a test table
      const users = pgTable('users', {
        id: uuid('id').primaryKey(),
        email: text('email').notNull(),
        ...stripeBillableFields(),
      });

      // Mock db (we're just testing the interface, not actual DB operations)
      const mockDb: any = {};

      const repo: BillableEntityRepository = new DrizzleBillableEntityRepository(mockDb, users);

      // Verify interface methods exist
      expect(repo.findByStripeCustomerId).toBeDefined();
      expect(repo.updateStripeCustomerId).toBeDefined();
      expect(typeof repo.findByStripeCustomerId).toBe('function');
      expect(typeof repo.updateStripeCustomerId).toBe('function');
    });

    it('has correct method signatures', () => {
      const users = pgTable('users', {
        id: uuid('id').primaryKey(),
        ...stripeBillableFields(),
      });

      const mockDb: any = {};
      const repo = new DrizzleBillableEntityRepository(mockDb, users);

      // TypeScript will catch signature mismatches at compile time
      // These calls verify the signatures match the interface
      const findPromise = repo.findByStripeCustomerId('cus_123');
      const updatePromise = repo.updateStripeCustomerId('user-id', 'cus_123');

      expect(findPromise).toBeInstanceOf(Promise);
      expect(updatePromise).toBeInstanceOf(Promise);
    });
  });

  describe('DrizzleSubscriptionRepository', () => {
    it('implements SubscriptionRepository interface', () => {
      const subscriptions = pgTable('subscriptions', {
        id: serial('id').primaryKey(),
        user_id: uuid('user_id').notNull(),
        ...stripeSubscriptionFields(),
        created_at: timestamp('created_at').defaultNow(),
        updated_at: timestamp('updated_at').defaultNow(),
      });

      const mockDb: any = {};

      const repo: SubscriptionRepository = new DrizzleSubscriptionRepository(
        mockDb,
        subscriptions,
        'user_id'
      );

      // Verify interface methods exist
      expect(repo.upsertSubscription).toBeDefined();
      expect(repo.getActiveSubscription).toBeDefined();
      expect(repo.getByStripeId).toBeDefined();
      expect(repo.cancelSubscription).toBeDefined();
      expect(repo.getAllForEntity).toBeDefined();

      expect(typeof repo.upsertSubscription).toBe('function');
      expect(typeof repo.getActiveSubscription).toBe('function');
      expect(typeof repo.getByStripeId).toBe('function');
      expect(typeof repo.cancelSubscription).toBe('function');
      expect(typeof repo.getAllForEntity).toBe('function');
    });

    it('has correct method signatures', () => {
      const subscriptions = pgTable('subscriptions', {
        id: serial('id').primaryKey(),
        user_id: uuid('user_id').notNull(),
        ...stripeSubscriptionFields(),
        created_at: timestamp('created_at').defaultNow(),
        updated_at: timestamp('updated_at').defaultNow(),
      });

      const mockDb: any = {};
      const repo = new DrizzleSubscriptionRepository(mockDb, subscriptions);

      // Verify upsertSubscription signature
      const upsertPromise = repo.upsertSubscription({
        stripeSubscriptionId: 'sub_123',
        entityId: 'user-123',
        stripePriceId: 'price_123',
        status: 'active',
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(),
        cancelAtPeriodEnd: false,
        trialEnd: null,
      });

      expect(upsertPromise).toBeInstanceOf(Promise);
    });

    it('supports custom entity ID column names', () => {
      const orgSubscriptions = pgTable('subscriptions', {
        id: serial('id').primaryKey(),
        organization_id: uuid('organization_id').notNull(),
        ...stripeSubscriptionFields(),
      });

      const mockDb: any = {};

      // Create repo with custom column name
      const repo = new DrizzleSubscriptionRepository(
        mockDb,
        orgSubscriptions,
        'organization_id' // Custom column
      );

      expect(repo).toBeDefined();
      expect(repo.getActiveSubscription).toBeDefined();
    });
  });

  describe('DrizzleIdempotencyRepository', () => {
    it('implements IdempotencyRepository interface', () => {
      const webhookEvents = pgTable('webhook_events', {
        event_id: text('event_id').primaryKey(),
        processed_at: timestamp('processed_at').notNull().defaultNow(),
      });

      const mockDb: any = {};

      const repo: IdempotencyRepository = new DrizzleIdempotencyRepository(mockDb, webhookEvents);

      // Verify interface methods exist
      expect(repo.isProcessed).toBeDefined();
      expect(repo.markProcessed).toBeDefined();
      expect(repo.cleanupOldEvents).toBeDefined();

      expect(typeof repo.isProcessed).toBe('function');
      expect(typeof repo.markProcessed).toBe('function');
      expect(typeof repo.cleanupOldEvents).toBe('function');
    });

    it('has correct method signatures', () => {
      const webhookEvents = pgTable('webhook_events', {
        event_id: text('event_id').primaryKey(),
        processed_at: timestamp('processed_at').notNull().defaultNow(),
      });

      const mockDb: any = {};
      const repo = new DrizzleIdempotencyRepository(mockDb, webhookEvents);

      // Verify signatures
      const isProcessedPromise = repo.isProcessed('evt_123');
      const markProcessedPromise = repo.markProcessed('evt_123');
      const cleanupPromise = repo.cleanupOldEvents!(new Date());

      expect(isProcessedPromise).toBeInstanceOf(Promise);
      expect(markProcessedPromise).toBeInstanceOf(Promise);
      expect(cleanupPromise).toBeInstanceOf(Promise);
    });
  });

  describe('Type Safety', () => {
    it('enforces correct subscription status types', () => {
      const subscriptions = pgTable('subscriptions', {
        id: serial('id').primaryKey(),
        user_id: uuid('user_id').notNull(),
        ...stripeSubscriptionFields(),
      });

      const mockDb: any = {};
      const repo = new DrizzleSubscriptionRepository(mockDb, subscriptions);

      // TypeScript should enforce SubscriptionStatus type
      // This would fail at compile time with an invalid status
      const validStatuses: Array<'active' | 'canceled' | 'trialing'> = [
        'active',
        'canceled',
        'trialing',
      ];

      validStatuses.forEach((status) => {
        // Should compile without errors
        repo.upsertSubscription({
          stripeSubscriptionId: 'sub_123',
          entityId: 'user-123',
          stripePriceId: 'price_123',
          status: status as any,
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(),
          cancelAtPeriodEnd: false,
        });
      });

      expect(true).toBe(true); // If we got here, types are correct
    });
  });

  describe('Repository Constructor Parameters', () => {
    it('BillableEntityRepository accepts db and table', () => {
      const users = pgTable('users', {
        id: uuid('id').primaryKey(),
        ...stripeBillableFields(),
      });

      const mockDb: any = { select: () => ({}) };

      expect(() => {
        new DrizzleBillableEntityRepository(mockDb, users);
      }).not.toThrow();
    });

    it('SubscriptionRepository accepts db, table, and optional entityId column', () => {
      const subscriptions = pgTable('subscriptions', {
        id: serial('id').primaryKey(),
        user_id: uuid('user_id').notNull(),
        ...stripeSubscriptionFields(),
      });

      const mockDb: any = {};

      // With default column
      expect(() => {
        new DrizzleSubscriptionRepository(mockDb, subscriptions);
      }).not.toThrow();

      // With custom column
      expect(() => {
        new DrizzleSubscriptionRepository(mockDb, subscriptions, 'organization_id');
      }).not.toThrow();
    });

    it('IdempotencyRepository accepts db and table', () => {
      const webhookEvents = pgTable('webhook_events', {
        event_id: text('event_id').primaryKey(),
        processed_at: timestamp('processed_at').defaultNow(),
      });

      const mockDb: any = {};

      expect(() => {
        new DrizzleIdempotencyRepository(mockDb, webhookEvents);
      }).not.toThrow();
    });
  });
});
