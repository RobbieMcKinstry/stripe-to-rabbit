# Changelog

All notable changes to the Stripe domain model will be documented in this file.

## [Unreleased]

### Added

- Initial domain model types for Stripe concepts:
  - `BillableEntity` - Abstraction for users/orgs that can be charged
  - `PaymentAttempt` - Universal payment attempt record
  - `Subscription` - Recurring billing relationship
  - `PaymentStatus` - Payment intent status enumeration
  - `SubscriptionStatus` - Subscription status enumeration

- Drizzle ORM helpers for Postgres:
  - `stripeBillableFields()` - Adds `stripe_customer_id` to any table
  - `stripeBillableFieldsWithPaymentMethod()` - Adds customer ID + payment method display fields

- Documentation:
  - Comprehensive README with usage examples
  - Example schemas for B2C, B2B, and hybrid models
  - Drizzle configuration example
  - TypeScript type inference examples

- Testing:
  - Unit tests for Drizzle field helpers
  - Type inference validation tests
  - Real-world usage pattern tests

### Design Decisions

- Use `TEXT` instead of `VARCHAR` for Postgres (no performance difference, more flexible)
- Fields are nullable by default (entities may exist before Stripe customer creation)
- `stripe_customer_id` is unique by default (assumes 1:1 mapping)
- Composable helper functions instead of base classes (Drizzle's functional style)
- Minimal field set (only what's universally needed and performance-critical)
