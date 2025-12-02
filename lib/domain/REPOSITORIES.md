# Repository Pattern Guide

This guide explains how to implement the repository interfaces to integrate the Stripe domain model with your database.

## Overview

The repository pattern provides **database-agnostic abstractions** for persisting Stripe data. You implement these interfaces using your preferred database and ORM:

```typescript
// Your library provides the business logic
import {
  BillableEntityRepository,
  SubscriptionRepository,
  IdempotencyRepository,
} from '@yourlib/domain';

// You provide the persistence
class MyDrizzleRepo implements BillableEntityRepository {
  // Your Drizzle/Postgres implementation
}
```

## Why Repository Pattern?

**Benefits:**

- ✅ **Database Agnostic** - Works with Postgres, MySQL, MongoDB, DynamoDB, etc.
- ✅ **ORM Agnostic** - Use Drizzle, Prisma, TypeORM, Kysely, or raw SQL
- ✅ **Testable** - Easy to mock for unit tests
- ✅ **Swappable** - Change databases without touching business logic
- ✅ **Clean Architecture** - Business logic depends on abstractions, not implementations

**Pattern:**

```
┌─────────────────────────────────────┐
│   Webhook Business Logic (Library)  │
│   - Event processing                │
│   - State management                │
│   - Idempotency                     │
└──────────────┬──────────────────────┘
               │ depends on (interface)
               ▼
┌─────────────────────────────────────┐
│   Repository Interfaces             │
│  - BillableEntityRepository         │
│  - SubscriptionRepository           │
│  - IdempotencyRepository            │
└──────────────┬──────────────────────┘
               │ implemented by
               ▼
┌─────────────────────────────────────┐
│   Your Implementation               │
│  - Drizzle + Postgres               │
│  - Prisma + MySQL                   │
│  - Mongoose + MongoDB               │
│  - Whatever you choose              │
└─────────────────────────────────────┘
```

## Repository Interfaces

### 1. BillableEntityRepository

Manages the mapping between your entities (users/organizations) and Stripe customers.

**Methods:**

- `findByStripeCustomerId(customerId)` - Look up entity by Stripe customer ID
- `updateStripeCustomerId(entityId, customerId)` - Link Stripe customer to entity
- `ensureEntityExists(stripeCustomer)` - Optional: Create entity from webhook

**When to use:**

- Processing webhooks (look up which user the event belongs to)
- After creating Stripe customers (link customer ID to your user)

### 2. SubscriptionRepository

Manages subscription records synced from Stripe.

**Methods:**

- `upsertSubscription(params)` - Create or update subscription (idempotent)
- `getActiveSubscription(entityId)` - Get active subscription for access control
- `getByStripeId(subscriptionId)` - Look up subscription by Stripe ID
- `cancelSubscription(subscriptionId)` - Mark subscription as canceled
- `getAllForEntity(entityId)` - Optional: Get all subscriptions for entity

**When to use:**

- Processing subscription webhooks (`customer.subscription.*`)
- Access control ("does this user have an active subscription?")
- Billing UI ("show user their current plan")

### 3. IdempotencyRepository

Tracks which webhook events have been processed to prevent duplicates.

**Methods:**

- `isProcessed(eventId)` - Check if event already processed
- `markProcessed(eventId)` - Mark event as processed
- `cleanupOldEvents(olderThan)` - Optional: Delete old events

**When to use:**

- **ALWAYS** use before processing webhooks
- Stripe may send the same event multiple times
- Critical for preventing duplicate charges, subscriptions, emails

## Implementation Guide

### Step 1: Create Your Schemas

Using Drizzle helpers:

```typescript
import { pgTable, uuid, text, timestamp, serial } from 'drizzle-orm/pg-core';
import { stripeBillableFields, stripeSubscriptionFields } from '@yourlib/domain/drizzle';

// Users table with Stripe customer ID
export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  email: text('email').notNull(),
  ...stripeBillableFields(), // Adds stripe_customer_id
  created_at: timestamp('created_at').defaultNow(),
});

// Subscriptions table
export const subscriptions = pgTable('subscriptions', {
  id: serial('id').primaryKey(),
  user_id: uuid('user_id').references(() => users.id),
  ...stripeSubscriptionFields(), // Adds all subscription fields
  created_at: timestamp('created_at').defaultNow(),
  updated_at: timestamp('updated_at').defaultNow(),
});

// Idempotency table
export const webhookEvents = pgTable('webhook_events', {
  event_id: text('event_id').primaryKey(),
  processed_at: timestamp('processed_at').defaultNow(),
});
```

### Step 2: Implement Repositories

#### Option A: Use Provided Drizzle Implementations

```typescript
import { db } from './db';
import { users, subscriptions, webhookEvents } from './schema';
import {
  DrizzleBillableEntityRepository,
  DrizzleSubscriptionRepository,
  DrizzleIdempotencyRepository,
} from '@yourlib/domain/drizzle';

// Create repository instances
const billableRepo = new DrizzleBillableEntityRepository(db, users);
const subscriptionRepo = new DrizzleSubscriptionRepository(db, subscriptions, 'user_id');
const idempotencyRepo = new DrizzleIdempotencyRepository(db, webhookEvents);
```

#### Option B: Implement Your Own (Prisma Example)

```typescript
import { PrismaClient } from '@prisma/client';
import type { SubscriptionRepository } from '@yourlib/domain';

class PrismaSubscriptionRepository implements SubscriptionRepository {
  constructor(private prisma: PrismaClient) {}

  async upsertSubscription(params) {
    await this.prisma.subscription.upsert({
      where: { stripeSubscriptionId: params.stripeSubscriptionId },
      update: {
        stripePriceId: params.stripePriceId,
        status: params.status,
        currentPeriodStart: params.currentPeriodStart,
        currentPeriodEnd: params.currentPeriodEnd,
        cancelAtPeriodEnd: params.cancelAtPeriodEnd,
        trialEnd: params.trialEnd,
      },
      create: {
        stripeSubscriptionId: params.stripeSubscriptionId,
        userId: params.entityId,
        stripePriceId: params.stripePriceId,
        status: params.status,
        currentPeriodStart: params.currentPeriodStart,
        currentPeriodEnd: params.currentPeriodEnd,
        cancelAtPeriodEnd: params.cancelAtPeriodEnd,
        trialEnd: params.trialEnd,
      },
    });
  }

  async getActiveSubscription(entityId: string) {
    return this.prisma.subscription.findFirst({
      where: {
        userId: entityId,
        status: { in: ['active', 'trialing'] },
      },
    });
  }

  // ... other methods
}
```

### Step 3: Use in Webhook Handler

```typescript
import Stripe from 'stripe';
import { billableRepo, subscriptionRepo, idempotencyRepo } from './repositories';

export async function handleStripeWebhook(request: Request) {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  // Verify signature
  const signature = request.headers.get('stripe-signature');
  const event = stripe.webhooks.constructEvent(
    await request.text(),
    signature,
    process.env.STRIPE_WEBHOOK_SECRET
  );

  // Check idempotency FIRST
  if (await idempotencyRepo.isProcessed(event.id)) {
    console.log('Event already processed:', event.id);
    return new Response('OK', { status: 200 });
  }

  // Process event based on type
  switch (event.type) {
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const subscription = event.data.object;

      // Find which user this belongs to
      const userId = await billableRepo.findByStripeCustomerId(subscription.customer as string);
      if (!userId) {
        console.error('Unknown customer:', subscription.customer);
        break;
      }

      // Update subscription in database
      await subscriptionRepo.upsertSubscription({
        stripeSubscriptionId: subscription.id,
        entityId: userId,
        stripePriceId: subscription.items.data[0].price.id,
        status: subscription.status,
        currentPeriodStart: new Date(subscription.current_period_start * 1000),
        currentPeriodEnd: new Date(subscription.current_period_end * 1000),
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
        trialEnd: subscription.trial_end ? new Date(subscription.trial_end * 1000) : null,
      });

      break;
    }

    case 'customer.subscription.deleted': {
      await subscriptionRepo.cancelSubscription(event.data.object.id);
      break;
    }
  }

  // Mark as processed
  await idempotencyRepo.markProcessed(event.id);

  return new Response('OK', { status: 200 });
}
```

## Best Practices

### 1. Always Use Transactions

Wrap webhook processing in database transactions:

```typescript
await db.transaction(async (tx) => {
  // Create tx-scoped repositories
  const txSubscriptionRepo = new DrizzleSubscriptionRepository(tx, subscriptions);
  const txIdempotencyRepo = new DrizzleIdempotencyRepository(tx, webhookEvents);

  // Process event
  await txSubscriptionRepo.upsertSubscription(...);

  // Mark processed IN THE SAME TRANSACTION
  await txIdempotencyRepo.markProcessed(event.id);
});
```

### 2. Check Idempotency First

Always check before processing:

```typescript
// ✅ Correct order
if (await idempotencyRepo.isProcessed(event.id)) return;
await processEvent(event);
await idempotencyRepo.markProcessed(event.id);

// ❌ Wrong - might process duplicate
await processEvent(event);
await idempotencyRepo.markProcessed(event.id);
```

### 3. Handle Missing Customers Gracefully

Not all events will have known customers:

```typescript
const userId = await billableRepo.findByStripeCustomerId(customerId);
if (!userId) {
  console.warn(`Unknown customer ${customerId}, skipping event`);
  await idempotencyRepo.markProcessed(event.id); // Still mark processed!
  return;
}
```

### 4. Use Upsert for Subscriptions

Always use `upsertSubscription` (not insert):

```typescript
// ✅ Correct - handles both create and update
await subscriptionRepo.upsertSubscription(params);

// ❌ Wrong - will fail if subscription already exists
const existing = await subscriptionRepo.getByStripeId(subId);
if (existing) {
  await updateSubscription(...);
} else {
  await createSubscription(...);
}
```

## Testing

### Unit Testing with Mocks

```typescript
import { describe, it, expect, vi } from 'vitest';
import type { SubscriptionRepository } from '@yourlib/domain';

describe('Webhook Handler', () => {
  it('processes subscription created events', async () => {
    // Create mock repository
    const mockRepo: SubscriptionRepository = {
      upsertSubscription: vi.fn(),
      getActiveSubscription: vi.fn(),
      getByStripeId: vi.fn(),
      cancelSubscription: vi.fn(),
    };

    // Test your handler
    await handleSubscriptionCreated(event, mockRepo);

    expect(mockRepo.upsertSubscription).toHaveBeenCalledWith({
      stripeSubscriptionId: 'sub_123',
      entityId: 'user-456',
      stripePriceId: 'price_789',
      status: 'active',
      // ...
    });
  });
});
```

### Integration Testing

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from './test-db';
import { DrizzleSubscriptionRepository } from '@yourlib/domain/drizzle';
import { subscriptions } from './schema';

describe('SubscriptionRepository Integration', () => {
  let repo: DrizzleSubscriptionRepository;

  beforeEach(async () => {
    await db.delete(subscriptions); // Clean up
    repo = new DrizzleSubscriptionRepository(db, subscriptions);
  });

  it('upserts subscriptions idempotently', async () => {
    const params = {
      stripeSubscriptionId: 'sub_test',
      entityId: 'user-123',
      stripePriceId: 'price_pro',
      status: 'active' as const,
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(),
      cancelAtPeriodEnd: false,
    };

    // Insert
    await repo.upsertSubscription(params);

    // Update (same ID)
    await repo.upsertSubscription({
      ...params,
      stripePriceId: 'price_enterprise', // Changed!
    });

    // Should have 1 record, not 2
    const all = await repo.getAllForEntity!('user-123');
    expect(all).toHaveLength(1);
    expect(all[0].stripePriceId).toBe('price_enterprise');
  });
});
```

## Common Patterns

### Multi-Tenant Apps (Organizations)

```typescript
// Organization-based billing
const orgRepo = new DrizzleBillableEntityRepository(db, organizations);
const subscriptionRepo = new DrizzleSubscriptionRepository(
  db,
  subscriptions,
  'organization_id' // Custom column name
);
```

### Hybrid (Users + Organizations)

```typescript
// Look up in both tables
async function findBillableEntity(customerId: string) {
  // Try users first
  const userId = await userRepo.findByStripeCustomerId(customerId);
  if (userId) return { type: 'user', id: userId };

  // Try organizations
  const orgId = await orgRepo.findByStripeCustomerId(customerId);
  if (orgId) return { type: 'organization', id: orgId };

  return null;
}
```

## Troubleshooting

### "Event already processed" but not in database

**Cause**: Transaction rolled back after marking processed
**Fix**: Mark processed WITHIN the transaction

### Subscription not updating

**Cause**: Using insert instead of upsert
**Fix**: Always use `upsertSubscription`

### Duplicate subscriptions

**Cause**: Not checking idempotency
**Fix**: Always check `isProcessed` before processing

### Unknown customer errors

**Cause**: Webhook received before customer created in your DB
**Fix**: Either create customer in webhook, or gracefully skip unknown customers

## Next Steps

- See [examples/idempotency-schema.example.ts](./examples/idempotency-schema.example.ts) for idempotency table setup
- See [examples/subscription-schema.example.ts](./examples/subscription-schema.example.ts) for subscription patterns
- Check the [API reference](./repositories.ts) for full interface documentation
