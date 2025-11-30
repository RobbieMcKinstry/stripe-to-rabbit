import amqp, { Channel, Connection } from 'amqplib';
import { config, getRabbitMQConnectionUrl } from '@/config';
import Stripe from 'stripe';

/**
 * RabbitMQ Client for publishing Stripe webhook events
 */
class RabbitMQClient {
  private connection: Connection | null = null;
  private channel: Channel | null = null;
  private isConnecting: boolean = false;
  private connectionPromise: Promise<void> | null = null;

  /**
   * Establish connection to RabbitMQ
   */
  private async connect(): Promise<void> {
    if (this.connection && this.channel) {
      return;
    }

    if (this.isConnecting && this.connectionPromise) {
      return this.connectionPromise;
    }

    this.isConnecting = true;
    this.connectionPromise = this._connect();

    try {
      await this.connectionPromise;
    } finally {
      this.isConnecting = false;
      this.connectionPromise = null;
    }
  }

  private async _connect(): Promise<void> {
    try {
      const url = getRabbitMQConnectionUrl();

      console.log('Connecting to RabbitMQ...');
      this.connection = await amqp.connect(url, {
        heartbeat: parseInt(config.RABBITMQ_HEARTBEAT, 10),
        timeout: parseInt(config.RABBITMQ_CONNECTION_TIMEOUT, 10),
      });

      this.connection.on('error', (err) => {
        console.error('RabbitMQ connection error:', err);
        this.cleanup();
      });

      this.connection.on('close', () => {
        console.log('RabbitMQ connection closed');
        this.cleanup();
      });

      console.log('Creating RabbitMQ channel...');
      this.channel = await this.connection.createChannel();

      this.channel.on('error', (err) => {
        console.error('RabbitMQ channel error:', err);
      });

      this.channel.on('close', () => {
        console.log('RabbitMQ channel closed');
      });

      // Assert exchange
      await this.channel.assertExchange(config.RABBITMQ_EXCHANGE, config.RABBITMQ_EXCHANGE_TYPE, {
        durable: true,
      });

      // Assert queue
      await this.channel.assertQueue(config.RABBITMQ_QUEUE, {
        durable: true,
      });

      // Bind queue to exchange
      await this.channel.bindQueue(
        config.RABBITMQ_QUEUE,
        config.RABBITMQ_EXCHANGE,
        config.RABBITMQ_ROUTING_KEY
      );

      console.log('RabbitMQ connected and configured successfully');
    } catch (error) {
      console.error('Failed to connect to RabbitMQ:', error);
      this.cleanup();
      throw error;
    }
  }

  /**
   * Publish a Stripe event to RabbitMQ
   */
  async publishStripeEvent(event: Stripe.Event): Promise<void> {
    await this.connect();

    if (!this.channel) {
      throw new Error('RabbitMQ channel is not available');
    }

    try {
      const message = JSON.stringify({
        id: event.id,
        type: event.type,
        created: event.created,
        data: event.data,
        livemode: event.livemode,
        object: event.object,
        pending_webhooks: event.pending_webhooks,
        request: event.request,
        api_version: event.api_version,
      });

      const routingKey = `stripe.webhook.${event.type}`;

      const published = this.channel.publish(
        config.RABBITMQ_EXCHANGE,
        routingKey,
        Buffer.from(message),
        {
          persistent: true,
          contentType: 'application/json',
          timestamp: Date.now(),
          messageId: event.id,
          type: event.type,
          headers: {
            'x-stripe-event-id': event.id,
            'x-stripe-event-type': event.type,
          },
        }
      );

      if (!published) {
        throw new Error('Failed to publish message to RabbitMQ (channel buffer full)');
      }

      console.log(`Published Stripe event ${event.id} (${event.type}) to RabbitMQ`);
    } catch (error) {
      console.error('Error publishing to RabbitMQ:', error);
      throw error;
    }
  }

  /**
   * Clean up connections
   */
  private cleanup(): void {
    this.channel = null;
    this.connection = null;
  }

  /**
   * Close the RabbitMQ connection
   */
  async close(): Promise<void> {
    try {
      if (this.channel) {
        await this.channel.close();
      }
      if (this.connection) {
        await this.connection.close();
      }
    } catch (error) {
      console.error('Error closing RabbitMQ connection:', error);
    } finally {
      this.cleanup();
    }
  }
}

// Singleton instance
let rabbitMQClient: RabbitMQClient | null = null;

/**
 * Get or create the RabbitMQ client singleton
 */
export function getRabbitMQClient(): RabbitMQClient {
  if (!rabbitMQClient) {
    rabbitMQClient = new RabbitMQClient();
  }
  return rabbitMQClient;
}

/**
 * Close the RabbitMQ client
 */
export async function closeRabbitMQClient(): Promise<void> {
  if (rabbitMQClient) {
    await rabbitMQClient.close();
    rabbitMQClient = null;
  }
}
