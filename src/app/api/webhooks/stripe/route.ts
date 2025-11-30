import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { config } from '@/config';
import { getRabbitMQClient } from '@/lib/rabbitmq';
import { getLogger } from '@logtape/logtape';

const logger = getLogger(['stripe-to-rabbit', 'webhook']);

// Initialize Stripe with the API version if provided
const stripe = new Stripe(config.STRIPE_SECRET_KEY, {
  apiVersion: (config.STRIPE_API_VERSION as Stripe.LatestApiVersion) || '2025-01-27.acacia',
});

/**
 * POST handler for Stripe webhooks
 */
export async function POST(req: NextRequest) {
  try {
    // Get the raw body as text
    const body = await req.text();
    const signature = req.headers.get('stripe-signature');

    if (!signature) {
      logger.error('Missing Stripe signature header');
      return NextResponse.json({ error: 'Missing stripe-signature header' }, { status: 400 });
    }

    // Verify the webhook signature and construct the event
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(body, signature, config.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      const error = err as Error;
      logger.error('Webhook signature verification failed: {message}', {
        message: error.message,
      });
      return NextResponse.json(
        { error: `Webhook signature verification failed: ${error.message}` },
        { status: 400 }
      );
    }

    logger.info('Received Stripe webhook: {eventType} ({eventId})', {
      eventType: event.type,
      eventId: event.id,
    });

    // Publish the event to RabbitMQ
    try {
      const rabbitMQClient = getRabbitMQClient();
      await rabbitMQClient.publishStripeEvent(event);
    } catch (err) {
      const error = err as Error;
      logger.error('Failed to publish event to RabbitMQ: {error}', { error });

      // Return 500 so Stripe will retry
      return NextResponse.json({ error: 'Failed to process webhook event' }, { status: 500 });
    }

    // Return success response
    return NextResponse.json(
      {
        received: true,
        eventId: event.id,
        eventType: event.type,
      },
      { status: 200 }
    );
  } catch (err) {
    const error = err as Error;
    logger.error('Unexpected error processing webhook: {error}', { error });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * GET handler to check webhook endpoint health
 */
export async function GET() {
  return NextResponse.json(
    {
      status: 'ok',
      message: 'Stripe webhook endpoint is ready',
      timestamp: new Date().toISOString(),
    },
    { status: 200 }
  );
}
