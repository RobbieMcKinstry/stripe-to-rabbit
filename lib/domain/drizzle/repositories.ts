/**
 * Reference implementations of repository interfaces using Drizzle ORM.
 *
 * These implementations demonstrate how to integrate the Stripe domain model
 * with a Postgres database using Drizzle. You can use these as-is, or use
 * them as inspiration for your own implementations with different ORMs.
 *
 * ## Usage
 *
 * ```typescript
 * import { DrizzleBillableEntityRepository } from '@yourlib/domain/drizzle/repositories';
 * import { db } from './db';
 * import { users } from './schema';
 *
 * const billableRepo = new DrizzleBillableEntityRepository(db, users);
 * ```
 */

import { eq, and, or } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { PgTableWithColumns } from 'drizzle-orm/pg-core';
import type {
  BillableEntityRepository,
  SubscriptionRepository,
  IdempotencyRepository,
} from '../repositories';
import type { Subscription, SubscriptionStatus } from '../types';

/**
 * Drizzle implementation of BillableEntityRepository.
 *
 * Works with any Drizzle table that has `stripe_customer_id` field
 * (added via `stripeBillableFields()` helper).
 *
 * @example
 * ```typescript
 * import { pgTable, uuid, text } from 'drizzle-orm/pg-core';
 * import { stripeBillableFields } from '@yourlib/domain/drizzle';
 *
 * const users = pgTable('users', {
 *   id: uuid('id').primaryKey(),
 *   email: text('email').notNull(),
 *   ...stripeBillableFields(),
 * });
 *
 * const repo = new DrizzleBillableEntityRepository(db, users);
 * const entityId = await repo.findByStripeCustomerId('cus_123');
 * ```
 */
export class DrizzleBillableEntityRepository implements BillableEntityRepository {
  constructor(
    private db: PostgresJsDatabase<any>,
    private table: PgTableWithColumns<any>
  ) {}

  async findByStripeCustomerId(stripeCustomerId: string): Promise<string | null> {
    const result = await this.db
      .select({ id: this.table.id })
      .from(this.table)
      .where(eq(this.table.stripe_customer_id, stripeCustomerId))
      .limit(1);

    return result[0]?.id ?? null;
  }

  async updateStripeCustomerId(entityId: string, stripeCustomerId: string): Promise<void> {
    await this.db
      .update(this.table)
      .set({ stripe_customer_id: stripeCustomerId })
      .where(eq(this.table.id, entityId));
  }
}

/**
 * Drizzle implementation of SubscriptionRepository.
 *
 * Works with any Drizzle table that has subscription fields
 * (added via `stripeSubscriptionFields()` helper).
 *
 * @example
 * ```typescript
 * import { pgTable, serial, uuid, timestamp } from 'drizzle-orm/pg-core';
 * import { stripeSubscriptionFields } from '@yourlib/domain/drizzle';
 *
 * const subscriptions = pgTable('subscriptions', {
 *   id: serial('id').primaryKey(),
 *   user_id: uuid('user_id').notNull(),
 *   ...stripeSubscriptionFields(),
 *   created_at: timestamp('created_at').defaultNow(),
 *   updated_at: timestamp('updated_at').defaultNow(),
 * });
 *
 * const repo = new DrizzleSubscriptionRepository(db, subscriptions, 'user_id');
 * ```
 */
export class DrizzleSubscriptionRepository implements SubscriptionRepository {
  constructor(
    private db: PostgresJsDatabase<any>,
    private table: PgTableWithColumns<any>,
    private entityIdColumn: string = 'user_id' // or 'organization_id', etc.
  ) {}

  async upsertSubscription(params: {
    stripeSubscriptionId: string;
    entityId: string;
    stripePriceId: string;
    status: SubscriptionStatus;
    currentPeriodStart: Date;
    currentPeriodEnd: Date;
    cancelAtPeriodEnd: boolean;
    trialEnd?: Date | null;
    quantity?: number;
  }): Promise<void> {
    const data: any = {
      [this.entityIdColumn]: params.entityId,
      stripe_subscription_id: params.stripeSubscriptionId,
      stripe_price_id: params.stripePriceId,
      status: params.status,
      current_period_start: params.currentPeriodStart,
      current_period_end: params.currentPeriodEnd,
      cancel_at_period_end: params.cancelAtPeriodEnd,
      trial_end: params.trialEnd ?? null,
      updated_at: new Date(),
    };

    // Add quantity if provided and column exists
    if (params.quantity !== undefined && 'quantity' in this.table) {
      data.quantity = params.quantity.toString();
    }

    // Upsert: Insert or update if stripe_subscription_id already exists
    await this.db
      .insert(this.table)
      .values({
        ...data,
        created_at: new Date(),
      })
      .onConflictDoUpdate({
        target: this.table.stripe_subscription_id,
        set: data,
      });
  }

  async getActiveSubscription(entityId: string): Promise<Subscription | null> {
    const result = await this.db
      .select()
      .from(this.table)
      .where(
        and(
          eq(this.table[this.entityIdColumn], entityId),
          or(eq(this.table.status, 'active'), eq(this.table.status, 'trialing'))
        )
      )
      .limit(1);

    if (!result[0]) return null;

    return this.mapToSubscription(result[0]);
  }

  async getByStripeId(stripeSubscriptionId: string): Promise<Subscription | null> {
    const result = await this.db
      .select()
      .from(this.table)
      .where(eq(this.table.stripe_subscription_id, stripeSubscriptionId))
      .limit(1);

    if (!result[0]) return null;

    return this.mapToSubscription(result[0]);
  }

  async cancelSubscription(stripeSubscriptionId: string): Promise<void> {
    await this.db
      .update(this.table)
      .set({
        status: 'canceled',
        updated_at: new Date(),
      })
      .where(eq(this.table.stripe_subscription_id, stripeSubscriptionId));
  }

  async getAllForEntity(entityId: string): Promise<Subscription[]> {
    const results = await this.db
      .select()
      .from(this.table)
      .where(eq(this.table[this.entityIdColumn], entityId));

    return results.map((row) => this.mapToSubscription(row));
  }

  /**
   * Map database row to Subscription domain type.
   */
  private mapToSubscription(row: any): Subscription {
    return {
      stripeSubscriptionId: row.stripe_subscription_id,
      billableEntityId: row[this.entityIdColumn],
      stripePriceId: row.stripe_price_id,
      status: row.status as SubscriptionStatus,
      currentPeriodStart: row.current_period_start,
      currentPeriodEnd: row.current_period_end,
      cancelAtPeriodEnd: row.cancel_at_period_end,
      trialEnd: row.trial_end,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      metadata: {},
    };
  }
}

/**
 * Drizzle implementation of IdempotencyRepository.
 *
 * Requires a simple idempotency table with event_id and processed_at columns.
 *
 * @example
 * ```typescript
 * import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';
 *
 * const webhookEvents = pgTable('webhook_events', {
 *   event_id: text('event_id').primaryKey(),
 *   processed_at: timestamp('processed_at').notNull().defaultNow(),
 * });
 *
 * const repo = new DrizzleIdempotencyRepository(db, webhookEvents);
 * ```
 */
export class DrizzleIdempotencyRepository implements IdempotencyRepository {
  constructor(
    private db: PostgresJsDatabase<any>,
    private table: PgTableWithColumns<any>
  ) {}

  async isProcessed(eventId: string): Promise<boolean> {
    const result = await this.db
      .select({ event_id: this.table.event_id })
      .from(this.table)
      .where(eq(this.table.event_id, eventId))
      .limit(1);

    return result.length > 0;
  }

  async markProcessed(eventId: string, processedAt?: Date): Promise<void> {
    await this.db.insert(this.table).values({
      event_id: eventId,
      processed_at: processedAt ?? new Date(),
    });
  }

  async cleanupOldEvents(olderThan: Date): Promise<number> {
    const result = await this.db
      .delete(this.table)
      .where(eq(this.table.processed_at, olderThan))
      .returning({ event_id: this.table.event_id });

    return result.length;
  }
}
