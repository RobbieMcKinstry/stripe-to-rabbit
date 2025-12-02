/**
 * Stripe Event Consumer Library
 *
 * This library provides a strongly-typed consumer for Stripe webhook events from RabbitMQ.
 *
 * @example Basic Usage
 * ```typescript
 * import { StripeEventWorker, type RabbitMQConsumerConfig } from './lib/consumer';
 * import type Stripe from 'stripe';
 *
 * class MyStripeWorker extends StripeEventWorker {
 *   protected async handleCustomerCreated(event: Stripe.CustomerCreatedEvent): Promise<void> {
 *     console.log('New customer:', event.data.object.id);
 *   }
 *
 *   protected async handlePaymentIntentSucceeded(event: Stripe.PaymentIntentSucceededEvent): Promise<void> {
 *     console.log('Payment succeeded:', event.data.object.id);
 *   }
 * }
 *
 * const worker = new MyStripeWorker({
 *   hostname: 'localhost',
 *   username: 'guest',
 *   password: 'guest',
 *   queue: 'stripe.webhooks',
 * });
 *
 * await worker.consume();
 * ```
 *
 * @module consumer
 */

export { StripeEventWorker } from './stripe-event-worker.js';
export type { RabbitMQConsumerConfig, ConsumerStats } from './types.js';
