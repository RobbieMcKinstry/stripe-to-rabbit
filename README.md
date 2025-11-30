# stripe-to-rabbit

A production-ready Next.js webserver that handles Stripe webhooks and publishes events to RabbitMQ for asynchronous processing.

## Features

- **Next.js App Router**: Modern Next.js 14+ with TypeScript support
- **Stripe Webhook Verification**: Secure webhook signature validation using Stripe SDK
- **RabbitMQ Integration**: Reliable event publishing to RabbitMQ with connection pooling
- **Zod Validation**: Type-safe environment variable validation
- **Error Handling**: Comprehensive error handling and logging
- **Health Check**: Built-in health check endpoint

## Architecture

```
Stripe Webhook → Next.js API Route → Signature Verification → RabbitMQ → Your Consumers
```

Events are published to RabbitMQ with:
- **Exchange**: `stripe.events` (topic exchange)
- **Routing Key**: `stripe.webhook.{event.type}` (e.g., `stripe.webhook.customer.created`)
- **Queue**: `stripe.webhooks` (durable queue)

## Prerequisites

- Node.js 18+
- RabbitMQ server (local or remote)
- Stripe account with webhook configuration

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd stripe-to-rabbit
```

2. Install dependencies:
```bash
npm install
```

3. Configure environment variables:
```bash
cp .env.example .env
```

Edit `.env` with your configuration:
```env
# Stripe Configuration
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...

# RabbitMQ Configuration
RABBITMQ_HOST=localhost
RABBITMQ_PORT=5672
RABBITMQ_USER=guest
RABBITMQ_PASSWORD=guest
RABBITMQ_VHOST=/
```

## Environment Variables

All environment variables are validated using Zod at startup. See `src/config/index.ts` for the complete schema.

### Required Variables

| Variable | Description |
|----------|-------------|
| `STRIPE_SECRET_KEY` | Your Stripe secret API key |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |
| `RABBITMQ_HOST` | RabbitMQ server hostname |
| `RABBITMQ_USER` | RabbitMQ username |
| `RABBITMQ_PASSWORD` | RabbitMQ password |

### Optional Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_ENV` | `development` | Environment mode |
| `PORT` | `3000` | Server port |
| `STRIPE_API_VERSION` | Latest | Stripe API version |
| `RABBITMQ_PORT` | `5672` | RabbitMQ port |
| `RABBITMQ_VHOST` | `/` | RabbitMQ virtual host |
| `RABBITMQ_EXCHANGE` | `stripe.events` | Exchange name |
| `RABBITMQ_EXCHANGE_TYPE` | `topic` | Exchange type |
| `RABBITMQ_QUEUE` | `stripe.webhooks` | Queue name |
| `RABBITMQ_ROUTING_KEY` | `stripe.webhook` | Base routing key |
| `RABBITMQ_USE_SSL` | `false` | Enable SSL/TLS |
| `RABBITMQ_CONNECTION_TIMEOUT` | `10000` | Connection timeout (ms) |
| `RABBITMQ_HEARTBEAT` | `60` | Heartbeat interval (s) |

## Development

Start the development server:
```bash
npm run dev
```

The webhook endpoint will be available at:
```
http://localhost:3000/api/webhooks/stripe
```

## Testing Webhooks Locally

Use the Stripe CLI to forward webhooks to your local server:

1. Install Stripe CLI:
```bash
# macOS
brew install stripe/stripe-cli/stripe

# Other platforms: https://stripe.com/docs/stripe-cli
```

2. Login to Stripe:
```bash
stripe login
```

3. Forward webhooks:
```bash
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```

4. Get your webhook signing secret from the CLI output and update `.env`:
```env
STRIPE_WEBHOOK_SECRET=whsec_...
```

5. Trigger test events:
```bash
stripe trigger customer.created
stripe trigger payment_intent.succeeded
```

## Production Deployment

1. Build the application:
```bash
npm run build
```

2. Start the production server:
```bash
npm start
```

3. Configure your Stripe webhook:
   - Go to https://dashboard.stripe.com/webhooks
   - Add endpoint: `https://your-domain.com/api/webhooks/stripe`
   - Select events to listen to
   - Copy the webhook signing secret to `STRIPE_WEBHOOK_SECRET`

## Webhook Endpoint

### POST `/api/webhooks/stripe`

Receives and processes Stripe webhook events.

**Request Headers:**
- `stripe-signature`: Stripe webhook signature (automatically added by Stripe)

**Response Codes:**
- `200`: Event successfully processed and published to RabbitMQ
- `400`: Invalid signature or missing header
- `500`: Failed to publish to RabbitMQ (Stripe will retry)

**Success Response:**
```json
{
  "received": true,
  "eventId": "evt_...",
  "eventType": "customer.created"
}
```

### GET `/api/webhooks/stripe`

Health check endpoint.

**Response:**
```json
{
  "status": "ok",
  "message": "Stripe webhook endpoint is ready",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

## RabbitMQ Message Format

Events are published with the following structure:

**Message Body:**
```json
{
  "id": "evt_...",
  "type": "customer.created",
  "created": 1234567890,
  "data": { ... },
  "livemode": false,
  "object": "event",
  "pending_webhooks": 1,
  "request": { ... },
  "api_version": "2025-01-27.acacia"
}
```

**Message Properties:**
- `persistent`: true
- `contentType`: application/json
- `messageId`: Stripe event ID
- `type`: Stripe event type
- `timestamp`: Unix timestamp
- `headers`:
  - `x-stripe-event-id`: Stripe event ID
  - `x-stripe-event-type`: Stripe event type

**Routing Key Pattern:**
```
stripe.webhook.{event.type}
```

Examples:
- `stripe.webhook.customer.created`
- `stripe.webhook.payment_intent.succeeded`
- `stripe.webhook.invoice.payment_failed`

## Consuming Messages

Example consumer using `amqplib`:

```typescript
import amqp from 'amqplib';

const connection = await amqp.connect('amqp://localhost');
const channel = await connection.createChannel();

await channel.assertQueue('stripe.webhooks');

channel.consume('stripe.webhooks', (msg) => {
  if (msg) {
    const event = JSON.parse(msg.content.toString());
    console.log('Received event:', event.type, event.id);

    // Process the event...

    channel.ack(msg);
  }
});
```

## Project Structure

```
stripe-to-rabbit/
├── src/
│   ├── app/
│   │   └── api/
│   │       └── webhooks/
│   │           └── stripe/
│   │               └── route.ts          # Webhook handler
│   ├── config/
│   │   └── index.ts                      # Environment config with Zod
│   └── lib/
│       └── rabbitmq.ts                   # RabbitMQ client
├── .env.example                          # Environment template
├── next.config.js                        # Next.js config
├── package.json
└── tsconfig.json
```

## Error Handling

The application includes comprehensive error handling:

- **Signature Verification Failures**: Returns 400, Stripe won't retry
- **RabbitMQ Connection Failures**: Returns 500, Stripe will retry
- **RabbitMQ Publishing Failures**: Returns 500, Stripe will retry
- **Unexpected Errors**: Returns 500, logged for debugging

## Monitoring

Key log messages to monitor:

- `Received Stripe webhook: {type} ({id})` - Webhook received
- `Published Stripe event {id} ({type}) to RabbitMQ` - Successfully published
- `RabbitMQ connection error` - Connection issues
- `Failed to publish event to RabbitMQ` - Publishing failures

## Security Considerations

1. **Webhook Signature Verification**: All webhooks are cryptographically verified
2. **Environment Variables**: Sensitive credentials are validated and never logged
3. **SSL/TLS Support**: RabbitMQ connections support SSL via `RABBITMQ_USE_SSL`
4. **No Raw Body Parsing**: Uses Next.js built-in text parsing

## License

ISC

## Support

For issues or questions, please open an issue in the repository.
