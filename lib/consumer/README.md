# Stripe Event Consumer Library

A strongly-typed TypeScript library for consuming Stripe webhook events from RabbitMQ.

This library provides the inverse functionality of the webhook producer: while the web application receives Stripe webhooks and publishes them to RabbitMQ, this library consumes those events from the queue with full type safety.

## Features

- 🔒 **Strongly Typed**: All 258+ Stripe event types are fully typed with their specific interfaces
- 🎯 **Selective Processing**: Override only the event handlers you need
- 🔄 **Automatic Dispatching**: Events are automatically routed to the correct handler methods
- 📊 **Built-in Stats**: Track message consumption, acknowledgments, and errors
- ⚡ **Reliable**: Automatic message acknowledgment and error handling
- 🛡️ **Production Ready**: Includes logging, connection management, and graceful shutdown

## Installation

This library is part of the `stripe-to-rabbit` monorepo. No separate installation is required.

## Quick Start

### Basic Example

```typescript
import { StripeEventWorker } from './lib/consumer';
import type Stripe from 'stripe';

// Extend StripeEventWorker and override the events you want to handle
class MyStripeWorker extends StripeEventWorker {
  // Handle customer creation
  protected async handleCustomerCreated(event: Stripe.CustomerCreatedEvent): Promise<void> {
    const customer = event.data.object;
    console.log('New customer created:', customer.id, customer.email);

    // Your business logic here
    await saveCustomerToDatabase(customer);
  }

  // Handle successful payments
  protected async handlePaymentIntentSucceeded(event: Stripe.PaymentIntentSucceededEvent): Promise<void> {
    const paymentIntent = event.data.object;
    console.log('Payment succeeded:', paymentIntent.id, paymentIntent.amount);

    // Your business logic here
    await fulfillOrder(paymentIntent);
  }

  // Handle subscription updates
  protected async handleCustomerSubscriptionUpdated(event: Stripe.CustomerSubscriptionUpdatedEvent): Promise<void> {
    const subscription = event.data.object;
    const previousAttributes = event.data.previous_attributes;

    console.log('Subscription updated:', subscription.id);
    if (previousAttributes?.status) {
      console.log('Status changed from', previousAttributes.status, 'to', subscription.status);
    }

    // Your business logic here
    await updateSubscriptionStatus(subscription);
  }
}

// Create and start the worker
const worker = new MyStripeWorker({
  hostname: process.env.RABBITMQ_HOST || 'localhost',
  username: process.env.RABBITMQ_USER || 'guest',
  password: process.env.RABBITMQ_PASSWORD || 'guest',
  queue: 'stripe.webhooks',
});

// Start consuming (runs forever)
await worker.consume();
```

## Configuration

### RabbitMQConsumerConfig

```typescript
interface RabbitMQConsumerConfig {
  // Required
  hostname: string;        // RabbitMQ host
  username: string;        // RabbitMQ username
  password: string;        // RabbitMQ password
  queue: string;           // Queue name to consume from

  // Optional
  port?: number;           // RabbitMQ port (default: 5672)
  vhost?: string;          // Virtual host (default: '/')
  useSSL?: boolean;        // Use SSL/TLS (default: false)
  prefetchCount?: number;  // Messages to fetch at once (default: 1)
  connectionTimeout?: number;  // Connection timeout in ms (default: 10000)
  heartbeat?: number;      // Heartbeat interval in seconds (default: 60)
  exchange?: string;       // Exchange name (optional, for verification)
}
```

### Environment Variables Example

```bash
RABBITMQ_HOST=localhost
RABBITMQ_PORT=5672
RABBITMQ_USER=guest
RABBITMQ_PASSWORD=guest
RABBITMQ_VHOST=/
RABBITMQ_QUEUE=stripe.webhooks
```

## Advanced Usage

### Monitoring Statistics

```typescript
const worker = new MyStripeWorker(config);

// Start consuming
worker.consume();

// Check stats periodically
setInterval(() => {
  const stats = worker.getStats();
  console.log('Consumer Stats:', {
    messagesConsumed: stats.messagesConsumed,
    messagesAcknowledged: stats.messagesAcknowledged,
    messagesRejected: stats.messagesRejected,
    totalErrors: stats.totalErrors,
    uptime: Date.now() - stats.startTime.getTime(),
    lastMessageTime: stats.lastMessageTime,
  });
}, 60000); // Every minute
```

### Graceful Shutdown

```typescript
const worker = new MyStripeWorker(config);

// Start consuming
worker.consume();

// Handle shutdown signals
process.on('SIGINT', async () => {
  console.log('Shutting down gracefully...');
  await worker.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('Shutting down gracefully...');
  await worker.close();
  process.exit(0);
});
```

### Error Handling in Custom Handlers

```typescript
class RobustStripeWorker extends StripeEventWorker {
  protected async handleCustomerCreated(event: Stripe.CustomerCreatedEvent): Promise<void> {
    try {
      const customer = event.data.object;

      // Your business logic
      await saveCustomerToDatabase(customer);

      // Send welcome email
      await sendWelcomeEmail(customer.email);

    } catch (error) {
      // Log the error
      console.error('Failed to process customer.created event:', error);

      // Re-throw to trigger message requeue
      // The message will be nack'd and requeued for retry
      throw error;
    }
  }
}
```

### Processing Multiple Event Types

```typescript
class ComprehensiveStripeWorker extends StripeEventWorker {
  // Payment events
  protected async handlePaymentIntentSucceeded(event: Stripe.PaymentIntentSucceededEvent): Promise<void> {
    await this.fulfillOrder(event.data.object);
  }

  protected async handlePaymentIntentPaymentFailed(event: Stripe.PaymentIntentPaymentFailedEvent): Promise<void> {
    await this.notifyPaymentFailure(event.data.object);
  }

  // Subscription events
  protected async handleCustomerSubscriptionCreated(event: Stripe.CustomerSubscriptionCreatedEvent): Promise<void> {
    await this.activateSubscription(event.data.object);
  }

  protected async handleCustomerSubscriptionDeleted(event: Stripe.CustomerSubscriptionDeletedEvent): Promise<void> {
    await this.deactivateSubscription(event.data.object);
  }

  protected async handleCustomerSubscriptionTrialWillEnd(event: Stripe.CustomerSubscriptionTrialWillEndEvent): Promise<void> {
    await this.sendTrialEndingNotification(event.data.object);
  }

  // Dispute events
  protected async handleChargeDisputeCreated(event: Stripe.ChargeDisputeCreatedEvent): Promise<void> {
    await this.handleDispute(event.data.object);
  }

  protected async handleChargeDisputeClosed(event: Stripe.ChargeDisputeClosedEvent): Promise<void> {
    await this.resolveDispute(event.data.object);
  }

  // Invoice events
  protected async handleInvoicePaymentSucceeded(event: Stripe.InvoicePaymentSucceededEvent): Promise<void> {
    await this.processInvoicePayment(event.data.object);
  }

  protected async handleInvoicePaymentFailed(event: Stripe.InvoicePaymentFailedEvent): Promise<void> {
    await this.handleFailedInvoice(event.data.object);
  }

  // Helper methods
  private async fulfillOrder(paymentIntent: Stripe.PaymentIntent): Promise<void> {
    // Implementation
  }

  private async activateSubscription(subscription: Stripe.Subscription): Promise<void> {
    // Implementation
  }

  // ... more helper methods
}
```

### Type-Safe Event Access

The library leverages TypeScript's discriminated unions to provide full type safety:

```typescript
class TypeSafeWorker extends StripeEventWorker {
  protected async handleCustomerCreated(event: Stripe.CustomerCreatedEvent): Promise<void> {
    // event.data.object is typed as Stripe.Customer
    const customer = event.data.object;

    // TypeScript knows all customer properties
    console.log(customer.id, customer.email, customer.metadata);

    // event.data.previous_attributes is undefined for 'created' events
    // (only present for 'updated' events)
  }

  protected async handleCustomerUpdated(event: Stripe.CustomerUpdatedEvent): Promise<void> {
    // event.data.object is typed as Stripe.Customer
    const customer = event.data.object;

    // event.data.previous_attributes contains the old values
    const previous = event.data.previous_attributes;

    if (previous?.email) {
      console.log(`Email changed from ${previous.email} to ${customer.email}`);
    }
  }
}
```

## Available Event Handlers

The library provides handler methods for all 258+ Stripe event types. Each method is strongly typed with its specific event interface. Here are some commonly used ones:

### Account Events
- `handleAccountUpdated(event: Stripe.AccountUpdatedEvent)`
- `handleAccountExternalAccountCreated(event: Stripe.AccountExternalAccountCreatedEvent)`

### Customer Events
- `handleCustomerCreated(event: Stripe.CustomerCreatedEvent)`
- `handleCustomerUpdated(event: Stripe.CustomerUpdatedEvent)`
- `handleCustomerDeleted(event: Stripe.CustomerDeletedEvent)`

### Payment Intent Events
- `handlePaymentIntentSucceeded(event: Stripe.PaymentIntentSucceededEvent)`
- `handlePaymentIntentPaymentFailed(event: Stripe.PaymentIntentPaymentFailedEvent)`
- `handlePaymentIntentCreated(event: Stripe.PaymentIntentCreatedEvent)`
- `handlePaymentIntentCanceled(event: Stripe.PaymentIntentCanceledEvent)`

### Subscription Events
- `handleCustomerSubscriptionCreated(event: Stripe.CustomerSubscriptionCreatedEvent)`
- `handleCustomerSubscriptionUpdated(event: Stripe.CustomerSubscriptionUpdatedEvent)`
- `handleCustomerSubscriptionDeleted(event: Stripe.CustomerSubscriptionDeletedEvent)`
- `handleCustomerSubscriptionTrialWillEnd(event: Stripe.CustomerSubscriptionTrialWillEndEvent)`

### Invoice Events
- `handleInvoiceCreated(event: Stripe.InvoiceCreatedEvent)`
- `handleInvoicePaid(event: Stripe.InvoicePaidEvent)`
- `handleInvoicePaymentSucceeded(event: Stripe.InvoicePaymentSucceededEvent)`
- `handleInvoicePaymentFailed(event: Stripe.InvoicePaymentFailedEvent)`

### Charge Events
- `handleChargeSucceeded(event: Stripe.ChargeSucceededEvent)`
- `handleChargeFailed(event: Stripe.ChargeFailedEvent)`
- `handleChargeRefunded(event: Stripe.ChargeRefundedEvent)`
- `handleChargeDisputeCreated(event: Stripe.ChargeDisputeCreatedEvent)`

### Checkout Session Events
- `handleCheckoutSessionCompleted(event: Stripe.CheckoutSessionCompletedEvent)`
- `handleCheckoutSessionExpired(event: Stripe.CheckoutSessionExpiredEvent)`

**Note**: All event handlers have a default no-op implementation. You only need to override the ones you want to process.

For the complete list of all 258+ event types, see the [Stripe Events documentation](https://stripe.com/docs/api/events/types).

## Message Acknowledgment

- **Success**: Messages are automatically acknowledged (`ack`) when the handler completes successfully
- **Error**: Messages are automatically rejected and requeued (`nack` with requeue=true) when the handler throws an error
- **Parse Error**: Messages with invalid JSON are rejected and requeued

This ensures reliable message processing and automatic retry on failures.

## Consumer Statistics

The `getStats()` method returns:

```typescript
interface ConsumerStats {
  messagesConsumed: number;        // Total messages received
  messagesAcknowledged: number;    // Successfully processed
  messagesRejected: number;        // Failed and requeued
  totalErrors: number;             // Total errors encountered
  startTime: Date;                 // Consumer start time
  lastMessageTime?: Date;          // Last message processed
}
```

## Testing

The library includes comprehensive unit tests. Run them with:

```bash
pnpm test lib/consumer
```

## Architecture

```
┌─────────────────┐
│  Stripe API     │
└────────┬────────┘
         │ Webhook
         ▼
┌─────────────────┐
│  Web Server     │
│  (Producer)     │
└────────┬────────┘
         │ Publish
         ▼
┌─────────────────┐
│   RabbitMQ      │
│   Exchange      │
│  stripe.events  │
└────────┬────────┘
         │ Route: stripe.webhook.*
         ▼
┌─────────────────┐
│   RabbitMQ      │
│     Queue       │
│stripe.webhooks  │
└────────┬────────┘
         │ Consume
         ▼
┌─────────────────┐
│StripeEventWorker│ ← This Library
│   (Consumer)    │
└────────┬────────┘
         │ Dispatch
         ▼
┌─────────────────┐
│  Your Custom    │
│    Handlers     │
└─────────────────┘
```

## Production Deployment

### Running as a Service

```typescript
// worker.ts
import { StripeEventWorker } from './lib/consumer';
import { config } from './config';

class ProductionWorker extends StripeEventWorker {
  // Your event handlers
}

const worker = new ProductionWorker({
  hostname: config.RABBITMQ_HOST,
  port: parseInt(config.RABBITMQ_PORT),
  username: config.RABBITMQ_USER,
  password: config.RABBITMQ_PASSWORD,
  queue: config.RABBITMQ_QUEUE,
  prefetchCount: 10, // Process 10 messages concurrently
});

// Graceful shutdown
const shutdown = async () => {
  console.log('Shutting down worker...');
  await worker.close();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Start consuming
worker.consume().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
```

### Docker Example

```dockerfile
FROM node:20-alpine

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN npm install -g pnpm && pnpm install --frozen-lockfile

COPY . .

CMD ["node", "--loader", "ts-node/esm", "worker.ts"]
```

### Health Checks

```typescript
import express from 'express';

const app = express();
const worker = new MyStripeWorker(config);

// Health check endpoint
app.get('/health', (req, res) => {
  const stats = worker.getStats();
  res.json({
    status: 'healthy',
    uptime: Date.now() - stats.startTime.getTime(),
    stats,
  });
});

app.listen(3001);
worker.consume();
```

## License

MIT

## Related

- [Stripe Webhooks Documentation](https://stripe.com/docs/webhooks)
- [Stripe Event Types](https://stripe.com/docs/api/events/types)
- [RabbitMQ Node.js Client](https://www.rabbitmq.com/tutorials/tutorial-one-javascript.html)
