/**
 * Configuration options for RabbitMQ connection
 */
export interface RabbitMQConsumerConfig {
  /**
   * RabbitMQ host
   */
  hostname: string;

  /**
   * RabbitMQ port (default: 5672)
   */
  port?: number;

  /**
   * RabbitMQ username
   */
  username: string;

  /**
   * RabbitMQ password
   */
  password: string;

  /**
   * RabbitMQ virtual host (default: '/')
   */
  vhost?: string;

  /**
   * Use SSL/TLS (default: false)
   */
  useSSL?: boolean;

  /**
   * Queue name to consume from
   */
  queue: string;

  /**
   * Exchange name (optional, for binding verification)
   */
  exchange?: string;

  /**
   * Prefetch count - number of messages to fetch at once (default: 1)
   */
  prefetchCount?: number;

  /**
   * Connection timeout in milliseconds (default: 10000)
   */
  connectionTimeout?: number;

  /**
   * Heartbeat interval in seconds (default: 60)
   */
  heartbeat?: number;
}

/**
 * Consumer statistics
 */
export interface ConsumerStats {
  /**
   * Total messages consumed
   */
  messagesConsumed: number;

  /**
   * Messages acknowledged
   */
  messagesAcknowledged: number;

  /**
   * Messages rejected (nack'd)
   */
  messagesRejected: number;

  /**
   * Total errors encountered
   */
  totalErrors: number;

  /**
   * Consumer start time
   */
  startTime: Date;

  /**
   * Last message processed time
   */
  lastMessageTime?: Date;
}
