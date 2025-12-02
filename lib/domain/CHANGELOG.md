# Changelog

All notable changes to the Stripe domain model will be documented in this file.

## [Unreleased]

### Added

- Initial domain model types for Stripe concepts:
  - `BillableEntity` - Abstraction for users/orgs that can be charged
  - `PaymentAttempt` - Universal payment attempt record
  - `Subscription` - Recurring billing relationship
  - `SubscriptionItem` - Multi-product subscription line items (advanced use case)
  - `PaymentStatus` - Payment intent status enumeration
  - `SubscriptionStatus` - Subscription status enumeration

- Drizzle ORM helpers for Postgres:
  - `stripeBillableFields()` - Adds `stripe_customer_id` to any table
  - `stripeBillableFieldsWithPaymentMethod()` - Adds customer ID + payment method display fields
  - `stripeSubscriptionFields()` - Adds subscription tracking fields for separate subscriptions table
  - `stripeSubscriptionFieldsWithQuantity()` - Adds subscription fields + quantity for per-seat pricing

- Repository pattern (database-agnostic persistence layer):
  - `BillableEntityRepository` - Interface for managing billable entities
  - `SubscriptionRepository` - Interface for managing subscription records
  - `IdempotencyRepository` - Interface for webhook idempotency tracking
  - `PaymentRepository` - Optional interface for one-time payment tracking
  - `DrizzleBillableEntityRepository` - Reference Drizzle implementation
  - `DrizzleSubscriptionRepository` - Reference Drizzle implementation
  - `DrizzleIdempotencyRepository` - Reference Drizzle implementation

- Webhook event handlers (production-ready business logic):
  - `handleWebhookEvent()` - Main dispatcher with idempotency and routing
  - `handleSubscriptionCreatedOrUpdated()` - Process subscription.created/updated events
  - `handleSubscriptionDeleted()` - Process subscription.deleted events
  - `createTransactionContext()` - Helper for transaction-scoped processing
  - `WebhookLogger` interface for custom logging
  - `WebhookHandlerResult` for monitoring and error tracking
  - Automatic idempotency checking
  - Graceful unknown customer handling
  - Structured error handling and logging

- Documentation:
  - Comprehensive README with usage examples
  - Example schemas for B2C, B2B, and hybrid models
  - Subscription table examples (single, per-seat, multi-product)
  - Idempotency table schema example
  - Drizzle configuration example
  - TypeScript type inference examples
  - Complete webhook integration example with Next.js, Express patterns
  - REPOSITORIES.md - Complete repository pattern guide
  - WEBHOOKS.md - Complete webhook integration guide with best practices

- Testing:
  - Unit tests for Drizzle field helpers (billable and subscription)
  - Repository interface contract tests
  - Type inference validation tests
  - Real-world usage pattern tests
  - Comprehensive webhook handler tests (idempotency, error handling, event routing)
  - Integration test examples with mock data

### Design Decisions

- Use `TEXT` instead of `VARCHAR` for Postgres (no performance difference, more flexible)
- Fields are nullable by default for billable entities (entities may exist before Stripe customer creation)
- Fields are required for subscriptions (subscription records only exist after Stripe subscription created)
- `stripe_customer_id` is unique by default (assumes 1:1 mapping)
- `stripe_subscription_id` is unique by default (prevents duplicate subscription records)
- Composable helper functions instead of base classes (Drizzle's functional style)
- Subscriptions in separate table, not columns on billable entities (scalability, clean separation)
- Minimal field set (only what's universally needed and performance-critical)
- Store `stripe_price_id` locally for instant access control without API calls
- Repository pattern with dependency inversion (business logic depends on interfaces, not implementations)
- Database-agnostic design (works with any database/ORM via repository implementations)
