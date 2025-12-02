/**
 * Core domain types for Stripe business logic abstraction.
 * These types represent the minimal universal concepts shared by all Stripe users.
 */

/**
 * Subscription status values from Stripe.
 * @see https://stripe.com/docs/api/subscriptions/object#subscription_object-status
 */
export type SubscriptionStatus =
  | 'active'
  | 'past_due'
  | 'unpaid'
  | 'canceled'
  | 'incomplete'
  | 'incomplete_expired'
  | 'trialing'
  | 'paused';

/**
 * Payment intent status values from Stripe.
 * @see https://stripe.com/docs/api/payment_intents/object#payment_intent_object-status
 */
export type PaymentStatus =
  | 'requires_payment_method'
  | 'requires_confirmation'
  | 'requires_action'
  | 'processing'
  | 'requires_capture'
  | 'canceled'
  | 'succeeded';

/**
 * Represents a billable entity in your system.
 * This could be a user, organization, account, or any entity that can be charged.
 *
 * This abstraction unites the concept of "customer" across different business models:
 * - B2C: Individual users
 * - B2B: Organizations/companies
 * - Multi-tenant: Accounts with multiple users
 */
export interface BillableEntity {
  /**
   * Your system's unique identifier for this entity.
   * Could be a user ID, organization ID, account ID, etc.
   */
  id: string;

  /**
   * Stripe's customer ID (e.g., "cus_xxxxxxxxxxxxx").
   * Optional because an entity might exist before creating a Stripe customer.
   */
  stripeCustomerId?: string | null;
}

/**
 * Minimal payment attempt record.
 * Represents the universal concept of "trying to charge money."
 */
export interface PaymentAttempt {
  /**
   * Stripe's payment intent ID (e.g., "pi_xxxxxxxxxxxxx")
   */
  stripePaymentIntentId: string;

  /**
   * Your system's billable entity identifier
   */
  billableEntityId: string;

  /**
   * Amount in smallest currency unit (e.g., cents for USD)
   */
  amount: number;

  /**
   * Three-letter ISO currency code (e.g., "usd", "eur")
   */
  currency: string;

  /**
   * Current payment status
   */
  status: PaymentStatus;

  /**
   * Stripe charge ID (e.g., "ch_xxxxxxxxxxxxx")
   * Only present after payment succeeds
   */
  stripeChargeId?: string | null;

  /**
   * When the payment was created
   */
  createdAt: Date;

  /**
   * When the payment record was last updated
   */
  updatedAt: Date;

  /**
   * Arbitrary metadata from your application
   */
  metadata?: Record<string, unknown>;
}

/**
 * Minimal subscription record.
 * Represents recurring billing relationships.
 */
export interface Subscription {
  /**
   * Stripe's subscription ID (e.g., "sub_xxxxxxxxxxxxx")
   */
  stripeSubscriptionId: string;

  /**
   * Your system's billable entity identifier
   */
  billableEntityId: string;

  /**
   * Stripe price ID (e.g., "price_xxxxxxxxxxxxx")
   * Determines which plan/tier the customer is on
   */
  stripePriceId: string;

  /**
   * Current subscription status
   */
  status: SubscriptionStatus;

  /**
   * When the current billing period started
   */
  currentPeriodStart: Date;

  /**
   * When the current billing period ends (next billing date)
   */
  currentPeriodEnd: Date;

  /**
   * Whether the subscription will cancel at period end
   */
  cancelAtPeriodEnd: boolean;

  /**
   * When the trial ends (if in trial)
   */
  trialEnd?: Date | null;

  /**
   * When the subscription was created
   */
  createdAt: Date;

  /**
   * When the subscription record was last updated
   */
  updatedAt: Date;

  /**
   * Arbitrary metadata from your application
   */
  metadata?: Record<string, unknown>;
}

/**
 * Subscription item record (for multi-product subscriptions).
 *
 * Advanced use case: When a single subscription includes multiple products/prices.
 * Example: A subscription that includes both "API Access" and "Premium Support"
 *
 * Most SaaS applications don't need this - only use if you have complex
 * multi-product subscriptions. For simple single-product subscriptions,
 * just use the stripePriceId field on the Subscription record.
 */
export interface SubscriptionItem {
  /**
   * Stripe's subscription item ID (e.g., "si_xxxxxxxxxxxxx")
   */
  stripeSubscriptionItemId: string;

  /**
   * Parent subscription identifier
   */
  subscriptionId: string;

  /**
   * Stripe price ID for this specific item (e.g., "price_xxxxxxxxxxxxx")
   */
  stripePriceId: string;

  /**
   * Quantity for this specific item
   */
  quantity: number;

  /**
   * When the item was created
   */
  createdAt: Date;

  /**
   * When the item record was last updated
   */
  updatedAt: Date;
}
