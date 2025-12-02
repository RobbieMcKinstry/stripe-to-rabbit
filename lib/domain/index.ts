/**
 * Stripe Domain Model
 *
 * This module provides opinionated abstractions for handling Stripe business logic
 * while remaining database-agnostic. It defines the minimal set of domain concepts
 * shared by all Stripe users.
 *
 * ## Core Concepts
 *
 * - **Billable Entity**: Any entity that can be charged (user, organization, account)
 * - **Payment Attempt**: The universal concept of trying to charge money
 * - **Subscription**: Recurring billing relationships
 *
 * ## Usage
 *
 * ```typescript
 * // Import domain types
 * import { BillableEntity, PaymentAttempt, Subscription } from '@yourlib/domain';
 *
 * // Import Drizzle helpers (if using Drizzle + Postgres)
 * import { stripeBillableFields } from '@yourlib/domain/drizzle';
 * ```
 *
 * @module domain
 */

// Export core domain types
export type {
  BillableEntity,
  PaymentAttempt,
  PaymentStatus,
  Subscription,
  SubscriptionItem,
  SubscriptionStatus,
} from './types';

// Export repository interfaces
export type {
  BillableEntityRepository,
  SubscriptionRepository,
  IdempotencyRepository,
  PaymentRepository,
} from './repositories';

// Re-export Drizzle helpers for convenience
export * from './drizzle';
