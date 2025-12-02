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

- Documentation:
  - Comprehensive README with usage examples
  - Example schemas for B2C, B2B, and hybrid models
  - Subscription table examples (single, per-seat, multi-product)
  - Drizzle configuration example
  - TypeScript type inference examples
  - Webhook integration examples

- Testing:
  - Unit tests for Drizzle field helpers (billable and subscription)
  - Type inference validation tests
  - Real-world usage pattern tests (21 total tests)

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
