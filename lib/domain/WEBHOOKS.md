# Webhook Handler Guide

This guide explains how to use the webhook event handlers to process Stripe events and keep your database in sync.

## Overview

The webhook handlers provide **ready-to-use event processing** for common Stripe events:

```typescript
// Your webhook endpoint
import { handleWebhookEvent } from '@yourlib/domain/webhooks';
import { billableRepo, subscriptionRepo, idempotencyRepo } from './repositories';

export async function POST(request: Request) {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
  const signature = request.headers.get('stripe-signature')!;

  const event = stripe.webhooks.constructEvent(
    await request.text(),
    signature,
    process.env.STRIPE_WEBHOOK_SECRET!
  );

  await handleWebhookEvent(event, {
    billableRepo,
    subscriptionRepo,
    idempotencyRepo,
  });

  return new Response('OK', { status: 200 });
}
```

## What Do The Handlers Do?

**Automated Processing:**

- ✅ **Idempotency checking** - Prevents duplicate processing of the same event
- ✅ **Event routing** - Dispatches events to the correct handler based on type
- ✅ **Subscription sync** - Creates/updates subscriptions from Stripe
- ✅ **Error handling** - Logs errors and returns structured results
- ✅ **Unknown customer handling** - Gracefully skips events for unknown customers
- ✅ **Logging** - Built-in logging with custom logger support

**Flow:**

```
┌─────────────────────────────────────┐
│   Stripe sends webhook              │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│   Your webhook endpoint             │
│   - Verify signature                │
│   - Construct event                 │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│   handleWebhookEvent()              │
│   1. Check if already processed     │
│   2. Route to correct handler       │
│   3. Process event (update DB)      │
│   4. Mark as processed              │
│   5. Return result                  │
└─────────────────────────────────────┘
```

## Supported Event Types

### Subscription Events

| Event Type                      | Handler                              | What It Does                                 |
| ------------------------------- | ------------------------------------ | -------------------------------------------- |
| `customer.subscription.created` | `handleSubscriptionCreatedOrUpdated` | Creates subscription record in DB            |
| `customer.subscription.updated` | `handleSubscriptionCreatedOrUpdated` | Updates subscription (status, price, period) |
| `customer.subscription.deleted` | `handleSubscriptionDeleted`          | Marks subscription as canceled               |

**More event types coming soon:**

- Payment events (`payment_intent.*`)
- Invoice events (`invoice.*`)
- Checkout events (`checkout.session.completed`)

## Quick Start

### Step 1: Set Up Repositories

First, create your repository implementations (see [REPOSITORIES.md](./REPOSITORIES.md)):

```typescript
// repositories.ts
import { db } from './db';
import { users, subscriptions, webhookEvents } from './schema';
import {
  DrizzleBillableEntityRepository,
  DrizzleSubscriptionRepository,
  DrizzleIdempotencyRepository,
} from '@yourlib/domain/drizzle';

export const billableRepo = new DrizzleBillableEntityRepository(db, users);
export const subscriptionRepo = new DrizzleSubscriptionRepository(db, subscriptions, 'user_id');
export const idempotencyRepo = new DrizzleIdempotencyRepository(db, webhookEvents);
```

### Step 2: Create Webhook Endpoint

Create a webhook endpoint in your framework of choice:

#### Next.js App Router

```typescript
// app/api/webhooks/stripe/route.ts
import { NextRequest } from 'next/server';
import Stripe from 'stripe';
import { handleWebhookEvent } from '@yourlib/domain/webhooks';
import { billableRepo, subscriptionRepo, idempotencyRepo } from '@/lib/repositories';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2023-10-16',
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.text();
    const signature = request.headers.get('stripe-signature')!;

    // Verify webhook signature
    const event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    );

    // Process event
    const result = await handleWebhookEvent(event, {
      billableRepo,
      subscriptionRepo,
      idempotencyRepo,
    });

    if (!result.success) {
      console.error('Webhook processing failed:', result.error);
      // Still return 200 to acknowledge receipt
    }

    return new Response('OK', { status: 200 });
  } catch (err) {
    console.error('Webhook error:', err);
    return new Response('Webhook error', { status: 400 });
  }
}
```

#### Express

```typescript
// webhooks.ts
import express from 'express';
import Stripe from 'stripe';
import { handleWebhookEvent } from '@yourlib/domain/webhooks';
import { billableRepo, subscriptionRepo, idempotencyRepo } from './repositories';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
const router = express.Router();

router.post('/webhooks/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  const signature = req.headers['stripe-signature'] as string;

  try {
    const event = stripe.webhooks.constructEvent(
      req.body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    );

    await handleWebhookEvent(event, {
      billableRepo,
      subscriptionRepo,
      idempotencyRepo,
    });

    res.json({ received: true });
  } catch (err) {
    console.error('Webhook error:', err);
    res.status(400).send(`Webhook Error: ${err.message}`);
  }
});

export default router;
```

### Step 3: Configure Stripe

In your Stripe Dashboard:

1. Go to **Developers → Webhooks**
2. Click **Add endpoint**
3. Enter your webhook URL (e.g., `https://yourapp.com/api/webhooks/stripe`)
4. Select events to listen to:
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
5. Copy the **Signing secret** and add to your `.env`:

```bash
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

## Using Database Transactions

**Highly recommended** for production: Wrap webhook processing in a transaction to ensure atomicity.

### Why Transactions?

Without transactions:

```typescript
// ❌ Problem: If markProcessed fails, event will be reprocessed
await subscriptionRepo.upsertSubscription(...);
await idempotencyRepo.markProcessed(eventId); // Fails!
// → Event gets reprocessed → Duplicate subscription
```

With transactions:

```typescript
// ✅ Safe: Both operations succeed or both fail
await db.transaction(async (tx) => {
  await txSubscriptionRepo.upsertSubscription(...);
  await txIdempotencyRepo.markProcessed(eventId);
}); // Both committed together
```

### Transaction Example

```typescript
import { db } from './db';
import { users, subscriptions, webhookEvents } from './schema';
import {
  DrizzleBillableEntityRepository,
  DrizzleSubscriptionRepository,
  DrizzleIdempotencyRepository,
} from '@yourlib/domain/drizzle';
import { handleWebhookEvent } from '@yourlib/domain/webhooks';

export async function POST(request: Request) {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
  const signature = request.headers.get('stripe-signature')!;
  const event = stripe.webhooks.constructEvent(
    await request.text(),
    signature,
    process.env.STRIPE_WEBHOOK_SECRET!
  );

  // Process within transaction
  await db.transaction(async (tx) => {
    // Create transaction-scoped repositories
    const billableRepo = new DrizzleBillableEntityRepository(tx, users);
    const subscriptionRepo = new DrizzleSubscriptionRepository(tx, subscriptions);
    const idempotencyRepo = new DrizzleIdempotencyRepository(tx, webhookEvents);

    // Process event (all DB operations use the transaction)
    await handleWebhookEvent(event, {
      billableRepo,
      subscriptionRepo,
      idempotencyRepo,
    });
  });

  return new Response('OK', { status: 200 });
}
```

## Custom Logging

By default, handlers log to `console`. You can provide a custom logger:

```typescript
import type { WebhookLogger } from '@yourlib/domain/webhooks';
import { logger } from './logger'; // Your logging library

const customLogger: WebhookLogger = {
  info: (message, metadata) => {
    logger.info(message, metadata);
  },
  warn: (message, metadata) => {
    logger.warn(message, metadata);
  },
  error: (message, error, metadata) => {
    logger.error(message, { error, ...metadata });
  },
};

await handleWebhookEvent(event, {
  billableRepo,
  subscriptionRepo,
  idempotencyRepo,
  logger: customLogger,
});
```

## Error Handling

The handlers return a `WebhookHandlerResult` with details about processing:

```typescript
const result = await handleWebhookEvent(event, {
  billableRepo,
  subscriptionRepo,
  idempotencyRepo,
});

if (!result.success) {
  // Processing failed
  console.error('Error:', result.error);

  // Send to error tracking
  Sentry.captureException(result.error, {
    tags: {
      eventId: event.id,
      eventType: event.type,
    },
  });
}

if (result.skipped) {
  // Event was skipped (already processed or unknown customer)
  console.log('Skipped:', result.skipReason);
}
```

**Best Practice: Always return 200**

Even if processing fails, return `200` to Stripe to acknowledge receipt:

```typescript
const result = await handleWebhookEvent(event, context);

if (!result.success) {
  // Log error, send to monitoring
  await errorTracking.captureError(result.error);
}

// Always return 200 (Stripe will retry on non-200)
return new Response('OK', { status: 200 });
```

**Why?** Stripe retries webhooks on non-200 responses. If you have a bug in your code, returning an error will cause Stripe to retry the same failing event repeatedly. Better to:

1. Return 200 to acknowledge receipt
2. Log the error for investigation
3. Fix the bug and manually re-sync data if needed

## Handling Unknown Customers

When a webhook arrives for a customer not in your database, the handler:

1. Logs a warning
2. Marks the event as processed (to avoid retries)
3. Returns `success: true, skipped: true`

```typescript
// User creates subscription in Stripe, but never signed up in your app
// → Webhook arrives for unknown customer

const result = await handleWebhookEvent(event, context);
// result.skipped = true
// result.skipReason = 'unknown_customer' (implicitly, via warning log)
```

**Why mark as processed?**

If the customer doesn't exist in your database, retrying won't help. Either:

- The customer will sign up later (webhook is too early)
- The customer never existed in your app (test data, etc.)

Marking as processed prevents infinite retries.

**To handle this differently:**

Implement `ensureEntityExists` in your `BillableEntityRepository`:

```typescript
class MyBillableEntityRepository implements BillableEntityRepository {
  async ensureEntityExists(stripeCustomer: Stripe.Customer): Promise<string> {
    // Create user from Stripe customer
    const user = await db
      .insert(users)
      .values({
        email: stripeCustomer.email,
        stripe_customer_id: stripeCustomer.id,
      })
      .returning();

    return user.id;
  }
}
```

Then modify the handler to call this method when customer is unknown.

## Event Ordering

**Important:** Stripe does NOT guarantee webhook delivery order.

Example problem:

```
Time 1: subscription.created (sent)
Time 2: subscription.updated (sent first!)
Time 3: subscription.created arrives
Time 4: subscription.updated arrives
```

**Solution: Use upsert operations**

The handlers use `upsertSubscription` which is idempotent:

- If subscription doesn't exist → create it
- If subscription exists → update it

This handles out-of-order delivery correctly.

## Testing

### Unit Testing Handlers

```typescript
import { describe, it, expect, vi } from 'vitest';
import type { BillableEntityRepository } from '@yourlib/domain/repositories';
import { handleWebhookEvent } from '@yourlib/domain/webhooks';

describe('Webhook Processing', () => {
  it('processes subscription created event', async () => {
    // Create mock repositories
    const mockBillableRepo: BillableEntityRepository = {
      findByStripeCustomerId: vi.fn().mockResolvedValue('user-123'),
      updateStripeCustomerId: vi.fn(),
    };

    const mockSubscriptionRepo = {
      upsertSubscription: vi.fn(),
      // ... other methods
    };

    const mockIdempotencyRepo = {
      isProcessed: vi.fn().mockResolvedValue(false),
      markProcessed: vi.fn(),
    };

    // Create test event
    const event: Stripe.Event = {
      id: 'evt_test',
      type: 'customer.subscription.created',
      data: {
        object: {
          id: 'sub_123',
          customer: 'cus_123',
          status: 'active',
          // ... other fields
        },
      },
    };

    // Process event
    const result = await handleWebhookEvent(event, {
      billableRepo: mockBillableRepo,
      subscriptionRepo: mockSubscriptionRepo,
      idempotencyRepo: mockIdempotencyRepo,
    });

    expect(result.success).toBe(true);
    expect(mockSubscriptionRepo.upsertSubscription).toHaveBeenCalledWith({
      stripeSubscriptionId: 'sub_123',
      entityId: 'user-123',
      // ... expected params
    });
  });
});
```

### Testing with Stripe CLI

Use the Stripe CLI to send test webhooks:

```bash
# Install Stripe CLI
brew install stripe/stripe-cli/stripe

# Login
stripe login

# Forward webhooks to your local server
stripe listen --forward-to localhost:3000/api/webhooks/stripe

# Trigger test events
stripe trigger customer.subscription.created
stripe trigger customer.subscription.updated
stripe trigger customer.subscription.deleted
```

## Best Practices

### 1. Always Use Transactions

Wrap webhook processing in database transactions:

```typescript
await db.transaction(async (tx) => {
  const repos = createTransactionRepos(tx);
  await handleWebhookEvent(event, repos);
});
```

### 2. Return 200 Even on Errors

Don't let transient errors cause infinite retries:

```typescript
const result = await handleWebhookEvent(event, context);

if (!result.success) {
  await errorTracking.capture(result.error);
}

// Always return 200
return new Response('OK', { status: 200 });
```

### 3. Log Everything

Use structured logging for debugging:

```typescript
const logger: WebhookLogger = {
  info: (message, metadata) => {
    structuredLogger.info({
      message,
      ...metadata,
      service: 'webhook-processor',
    });
  },
  // ... other methods
};
```

### 4. Monitor Webhook Processing

Track metrics for your webhook endpoint:

- Events received per minute
- Processing time
- Error rate
- Skipped events (unknown customers)

### 5. Handle Webhook Replay

Stripe allows you to replay old webhooks. Ensure your handlers are **truly idempotent**:

```typescript
// ✅ Idempotent (safe to run multiple times)
await subscriptionRepo.upsertSubscription({ ... });

// ❌ Not idempotent (creates duplicate records)
await subscriptionRepo.createSubscription({ ... });
```

### 6. Verify Webhook Signatures

**Always** verify signatures to prevent spoofed webhooks:

```typescript
// ✅ Correct
const event = stripe.webhooks.constructEvent(body, signature, process.env.STRIPE_WEBHOOK_SECRET!);

// ❌ NEVER DO THIS
const event = JSON.parse(body); // Unverified!
```

## Troubleshooting

### Webhook received but subscription not created

**Cause:** Customer not found in database
**Fix:** Check logs for "Unknown customer" warnings. Ensure customer was created before subscription.

### Duplicate subscriptions

**Cause:** Not using transactions or not checking idempotency
**Fix:** Wrap processing in transaction and ensure `isProcessed` is checked first.

### Events processing out of order

**Cause:** Stripe doesn't guarantee order
**Fix:** Use upsert operations (already handled by the handlers)

### Webhook signature verification fails

**Cause:** Wrong webhook secret or body modification
**Fix:**

- Use raw request body (don't parse as JSON first)
- Verify you're using the correct webhook secret
- Check that your framework isn't modifying the request body

## Next Steps

- See [examples/webhook-integration.example.ts](./examples/webhook-integration.example.ts) for a complete example
- See [REPOSITORIES.md](./REPOSITORIES.md) for repository implementation guide
- Check the [API reference](./webhooks/handlers.ts) for detailed handler documentation

## Common Patterns

### Multi-Tenant (Organizations)

```typescript
const orgBillableRepo = new DrizzleBillableEntityRepository(db, organizations);
const orgSubscriptionRepo = new DrizzleSubscriptionRepository(
  db,
  subscriptions,
  'organization_id' // Custom column
);

await handleWebhookEvent(event, {
  billableRepo: orgBillableRepo,
  subscriptionRepo: orgSubscriptionRepo,
  idempotencyRepo,
});
```

### Custom Event Handling

Extend the handlers to support additional event types:

```typescript
import { handleWebhookEvent } from '@yourlib/domain/webhooks';

export async function handleCustomWebhookEvent(
  event: Stripe.Event,
  context: WebhookHandlerContext
) {
  // First, try built-in handlers
  const result = await handleWebhookEvent(event, context);

  if (result.skipped && result.skipReason === 'unhandled_event_type') {
    // Handle custom events
    switch (event.type) {
      case 'invoice.payment_succeeded':
        await handleInvoicePaymentSucceeded(event, context);
        await context.idempotencyRepo.markProcessed(event.id);
        return { success: true, skipped: false };

      default:
        return result;
    }
  }

  return result;
}
```
