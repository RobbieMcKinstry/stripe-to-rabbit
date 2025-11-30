import { z } from 'zod';

/**
 * Environment variable schema with Zod validation
 */
const envSchema = z.object({
  // Server Configuration
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().default('3000'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warning', 'error', 'fatal']).default('info'),

  // Stripe Configuration
  STRIPE_SECRET_KEY: z.string().min(1, 'Stripe secret key is required'),
  STRIPE_WEBHOOK_SECRET: z.string().min(1, 'Stripe webhook secret is required'),
  STRIPE_API_VERSION: z.string().optional(),

  // RabbitMQ Configuration
  RABBITMQ_HOST: z.string().min(1, 'RabbitMQ host is required'),
  RABBITMQ_PORT: z.string().default('5672'),
  RABBITMQ_USER: z.string().min(1, 'RabbitMQ user is required'),
  RABBITMQ_PASSWORD: z.string().min(1, 'RabbitMQ password is required'),
  RABBITMQ_VHOST: z.string().default('/'),
  RABBITMQ_EXCHANGE: z.string().default('stripe.events'),
  RABBITMQ_EXCHANGE_TYPE: z.enum(['direct', 'topic', 'fanout', 'headers']).default('topic'),
  RABBITMQ_QUEUE: z.string().default('stripe.webhooks'),
  RABBITMQ_ROUTING_KEY: z.string().default('stripe.webhook'),
  RABBITMQ_USE_SSL: z
    .string()
    .default('false')
    .transform((val) => val === 'true'),
  RABBITMQ_CONNECTION_TIMEOUT: z.string().default('10000'),
  RABBITMQ_HEARTBEAT: z.string().default('60'),
});

/**
 * Validate and parse environment variables
 */
function validateEnv() {
  try {
    const parsed = envSchema.parse(process.env);
    return parsed;
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errorMessages = error.issues.map((err) => `${err.path.join('.')}: ${err.message}`);
      throw new Error(`Environment variable validation failed:\n${errorMessages.join('\n')}`);
    }
    throw error;
  }
}

/**
 * Validated configuration object
 */
export const config = validateEnv();

/**
 * Typed configuration for type-safe access
 */
export type Config = z.infer<typeof envSchema>;

/**
 * RabbitMQ connection configuration builder
 */
export function getRabbitMQConnectionConfig() {
  const protocol = config.RABBITMQ_USE_SSL ? 'amqps' : 'amqp';

  return {
    protocol,
    hostname: config.RABBITMQ_HOST,
    port: parseInt(config.RABBITMQ_PORT, 10),
    username: config.RABBITMQ_USER,
    password: config.RABBITMQ_PASSWORD,
    vhost: config.RABBITMQ_VHOST,
    heartbeat: parseInt(config.RABBITMQ_HEARTBEAT, 10),
    connectionTimeout: parseInt(config.RABBITMQ_CONNECTION_TIMEOUT, 10),
  };
}

/**
 * RabbitMQ connection URL builder
 */
export function getRabbitMQConnectionUrl(): string {
  const { protocol, hostname, port, username, password, vhost } = getRabbitMQConnectionConfig();
  const encodedVhost = encodeURIComponent(vhost);
  return `${protocol}://${username}:${password}@${hostname}:${port}${encodedVhost}`;
}
