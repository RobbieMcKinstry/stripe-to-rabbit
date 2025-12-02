import Stripe from 'stripe';
import * as amqp from 'amqplib';
import { getLogger } from '@logtape/logtape';
import type { RabbitMQConsumerConfig, ConsumerStats } from './types.js';

const logger = getLogger(['stripe-to-rabbit', 'consumer']);

/**
 * Abstract base class for consuming Stripe webhook events from RabbitMQ.
 *
 * This class connects to RabbitMQ, consumes messages from a specified queue,
 * parses them as Stripe events, and dispatches them to strongly-typed handler methods.
 *
 * Subclasses should override the event handler methods they want to process.
 * By default, all events are acknowledged and discarded.
 *
 * @example
 * ```typescript
 * class MyStripeWorker extends StripeEventWorker {
 *   protected async handleCustomerCreated(event: Stripe.CustomerCreatedEvent): Promise<void> {
 *     console.log('New customer:', event.data.object.id);
 *     // Your custom logic here
 *   }
 *
 *   protected async handlePaymentIntentSucceeded(event: Stripe.PaymentIntentSucceededEvent): Promise<void> {
 *     console.log('Payment succeeded:', event.data.object.id);
 *     // Your custom logic here
 *   }
 * }
 *
 * const worker = new MyStripeWorker({
 *   hostname: 'localhost',
 *   username: 'guest',
 *   password: 'guest',
 *   queue: 'stripe.webhooks',
 * });
 *
 * await worker.consume();
 * ```
 */
export abstract class StripeEventWorker {
  private connection: amqp.Connection | null = null;
  private channel: amqp.Channel | null = null;
  private consuming = false;
  private stats: ConsumerStats = {
    messagesConsumed: 0,
    messagesAcknowledged: 0,
    messagesRejected: 0,
    totalErrors: 0,
    startTime: new Date(),
  };

  constructor(private config: RabbitMQConsumerConfig) {}

  /**
   * Get consumer statistics
   */
  public getStats(): Readonly<ConsumerStats> {
    return { ...this.stats };
  }

  /**
   * Connect to RabbitMQ
   */
  private async connect(): Promise<void> {
    if (this.connection) {
      return;
    }

    const protocol = this.config.useSSL ? 'amqps' : 'amqp';
    const port = this.config.port ?? 5672;
    const vhost = this.config.vhost ?? '/';
    const heartbeat = this.config.heartbeat ?? 60;
    const connectionTimeout = this.config.connectionTimeout ?? 10000;

    const url = `${protocol}://${this.config.username}:${this.config.password}@${this.config.hostname}:${port}${vhost}`;

    logger.info('Connecting to RabbitMQ...', {
      hostname: this.config.hostname,
      port,
      vhost,
      queue: this.config.queue,
    });

    this.connection = await amqp.connect(url, {
      heartbeat,
      timeout: connectionTimeout,
    });

    this.connection.on('error', (err) => {
      logger.error('RabbitMQ connection error:', err);
    });

    this.connection.on('close', () => {
      logger.warn('RabbitMQ connection closed');
      this.connection = null;
      this.channel = null;
    });

    this.channel = await this.connection.createChannel();

    // Set prefetch count (default 1 for fair dispatch)
    await this.channel.prefetch(this.config.prefetchCount ?? 1);

    // Assert queue exists
    await this.channel.assertQueue(this.config.queue, { durable: true });

    logger.info('Connected to RabbitMQ and ready to consume');
  }

  /**
   * Start consuming messages from RabbitMQ.
   * This method runs forever until explicitly stopped or an unrecoverable error occurs.
   */
  public async consume(): Promise<void> {
    await this.connect();

    if (!this.channel) {
      throw new Error('Channel not initialized');
    }

    this.consuming = true;
    this.stats.startTime = new Date();

    logger.info('Starting to consume messages from queue', {
      queue: this.config.queue,
    });

    await this.channel.consume(
      this.config.queue,
      async (msg) => {
        if (!msg) {
          logger.warn('Received null message, consumer likely cancelled');
          return;
        }

        await this.processMessage(msg);
      },
      { noAck: false } // Manual acknowledgment
    );

    // Keep the process running
    logger.info('Consumer started. Waiting for messages...');
  }

  /**
   * Process a single message from the queue
   */
  private async processMessage(msg: amqp.ConsumeMessage): Promise<void> {
    this.stats.messagesConsumed++;
    this.stats.lastMessageTime = new Date();

    try {
      const content = msg.content.toString();
      const event = JSON.parse(content) as Stripe.Event;

      logger.debug('Processing Stripe event', {
        eventId: event.id,
        eventType: event.type,
      });

      // Dispatch to the appropriate handler based on event type
      await this.dispatchEvent(event);

      // Acknowledge the message
      this.channel?.ack(msg);
      this.stats.messagesAcknowledged++;

      logger.debug('Event processed successfully', {
        eventId: event.id,
        eventType: event.type,
      });
    } catch (error) {
      this.stats.totalErrors++;

      logger.error('Error processing message:', error, {
        messageId: msg.properties.messageId,
        errorMessage: error instanceof Error ? error.message : String(error),
      });

      // Reject the message and requeue it
      // You can customize this behavior (e.g., dead letter queue)
      this.channel?.nack(msg, false, true);
      this.stats.messagesRejected++;
    }
  }

  /**
   * Dispatch event to the appropriate handler method based on event type
   */
  private async dispatchEvent(event: Stripe.Event): Promise<void> {
    // TypeScript discriminated union allows type-safe dispatch
    switch (event.type) {
      case 'account.application.authorized':
        return this.handleAccountApplicationAuthorized(event);
      case 'account.application.deauthorized':
        return this.handleAccountApplicationDeauthorized(event);
      case 'account.external_account.created':
        return this.handleAccountExternalAccountCreated(event);
      case 'account.external_account.deleted':
        return this.handleAccountExternalAccountDeleted(event);
      case 'account.external_account.updated':
        return this.handleAccountExternalAccountUpdated(event);
      case 'account.updated':
        return this.handleAccountUpdated(event);
      case 'application_fee.created':
        return this.handleApplicationFeeCreated(event);
      case 'application_fee.refund.updated':
        return this.handleApplicationFeeRefundUpdated(event);
      case 'application_fee.refunded':
        return this.handleApplicationFeeRefunded(event);
      case 'balance.available':
        return this.handleBalanceAvailable(event);
      case 'balance_settings.updated':
        return this.handleBalanceSettingsUpdated(event);
      case 'billing.alert.triggered':
        return this.handleBillingAlertTriggered(event);
      case 'billing_portal.configuration.created':
        return this.handleBillingPortalConfigurationCreated(event);
      case 'billing_portal.configuration.updated':
        return this.handleBillingPortalConfigurationUpdated(event);
      case 'billing_portal.session.created':
        return this.handleBillingPortalSessionCreated(event);
      case 'capability.updated':
        return this.handleCapabilityUpdated(event);
      case 'cash_balance.funds_available':
        return this.handleCashBalanceFundsAvailable(event);
      case 'charge.captured':
        return this.handleChargeCaptured(event);
      case 'charge.dispute.closed':
        return this.handleChargeDisputeClosed(event);
      case 'charge.dispute.created':
        return this.handleChargeDisputeCreated(event);
      case 'charge.dispute.funds_reinstated':
        return this.handleChargeDisputeFundsReinstated(event);
      case 'charge.dispute.funds_withdrawn':
        return this.handleChargeDisputeFundsWithdrawn(event);
      case 'charge.dispute.updated':
        return this.handleChargeDisputeUpdated(event);
      case 'charge.expired':
        return this.handleChargeExpired(event);
      case 'charge.failed':
        return this.handleChargeFailed(event);
      case 'charge.pending':
        return this.handleChargePending(event);
      case 'charge.refund.updated':
        return this.handleChargeRefundUpdated(event);
      case 'charge.refunded':
        return this.handleChargeRefunded(event);
      case 'charge.succeeded':
        return this.handleChargeSucceeded(event);
      case 'charge.updated':
        return this.handleChargeUpdated(event);
      case 'checkout.session.async_payment_failed':
        return this.handleCheckoutSessionAsyncPaymentFailed(event);
      case 'checkout.session.async_payment_succeeded':
        return this.handleCheckoutSessionAsyncPaymentSucceeded(event);
      case 'checkout.session.completed':
        return this.handleCheckoutSessionCompleted(event);
      case 'checkout.session.expired':
        return this.handleCheckoutSessionExpired(event);
      case 'climate.order.canceled':
        return this.handleClimateOrderCanceled(event);
      case 'climate.order.created':
        return this.handleClimateOrderCreated(event);
      case 'climate.order.delayed':
        return this.handleClimateOrderDelayed(event);
      case 'climate.order.delivered':
        return this.handleClimateOrderDelivered(event);
      case 'climate.order.product_substituted':
        return this.handleClimateOrderProductSubstituted(event);
      case 'climate.product.created':
        return this.handleClimateProductCreated(event);
      case 'climate.product.pricing_updated':
        return this.handleClimateProductPricingUpdated(event);
      case 'coupon.created':
        return this.handleCouponCreated(event);
      case 'coupon.deleted':
        return this.handleCouponDeleted(event);
      case 'coupon.updated':
        return this.handleCouponUpdated(event);
      case 'credit_note.created':
        return this.handleCreditNoteCreated(event);
      case 'credit_note.updated':
        return this.handleCreditNoteUpdated(event);
      case 'credit_note.voided':
        return this.handleCreditNoteVoided(event);
      case 'customer.created':
        return this.handleCustomerCreated(event);
      case 'customer.deleted':
        return this.handleCustomerDeleted(event);
      case 'customer.discount.created':
        return this.handleCustomerDiscountCreated(event);
      case 'customer.discount.deleted':
        return this.handleCustomerDiscountDeleted(event);
      case 'customer.discount.updated':
        return this.handleCustomerDiscountUpdated(event);
      case 'customer.source.created':
        return this.handleCustomerSourceCreated(event);
      case 'customer.source.deleted':
        return this.handleCustomerSourceDeleted(event);
      case 'customer.source.expiring':
        return this.handleCustomerSourceExpiring(event);
      case 'customer.source.updated':
        return this.handleCustomerSourceUpdated(event);
      case 'customer.subscription.created':
        return this.handleCustomerSubscriptionCreated(event);
      case 'customer.subscription.deleted':
        return this.handleCustomerSubscriptionDeleted(event);
      case 'customer.subscription.paused':
        return this.handleCustomerSubscriptionPaused(event);
      case 'customer.subscription.pending_update_applied':
        return this.handleCustomerSubscriptionPendingUpdateApplied(event);
      case 'customer.subscription.pending_update_expired':
        return this.handleCustomerSubscriptionPendingUpdateExpired(event);
      case 'customer.subscription.resumed':
        return this.handleCustomerSubscriptionResumed(event);
      case 'customer.subscription.trial_will_end':
        return this.handleCustomerSubscriptionTrialWillEnd(event);
      case 'customer.subscription.updated':
        return this.handleCustomerSubscriptionUpdated(event);
      case 'customer.tax_id.created':
        return this.handleCustomerTaxIdCreated(event);
      case 'customer.tax_id.deleted':
        return this.handleCustomerTaxIdDeleted(event);
      case 'customer.tax_id.updated':
        return this.handleCustomerTaxIdUpdated(event);
      case 'customer.updated':
        return this.handleCustomerUpdated(event);
      case 'customer_cash_balance_transaction.created':
        return this.handleCustomerCashBalanceTransactionCreated(event);
      case 'entitlements.active_entitlement_summary.updated':
        return this.handleEntitlementsActiveEntitlementSummaryUpdated(event);
      case 'file.created':
        return this.handleFileCreated(event);
      case 'financial_connections.account.account_numbers_updated':
        return this.handleFinancialConnectionsAccountAccountNumbersUpdated(event);
      case 'financial_connections.account.created':
        return this.handleFinancialConnectionsAccountCreated(event);
      case 'financial_connections.account.deactivated':
        return this.handleFinancialConnectionsAccountDeactivated(event);
      case 'financial_connections.account.disconnected':
        return this.handleFinancialConnectionsAccountDisconnected(event);
      case 'financial_connections.account.reactivated':
        return this.handleFinancialConnectionsAccountReactivated(event);
      case 'financial_connections.account.refreshed_balance':
        return this.handleFinancialConnectionsAccountRefreshedBalance(event);
      case 'financial_connections.account.refreshed_ownership':
        return this.handleFinancialConnectionsAccountRefreshedOwnership(event);
      case 'financial_connections.account.refreshed_transactions':
        return this.handleFinancialConnectionsAccountRefreshedTransactions(event);
      case 'financial_connections.account.upcoming_account_number_expiry':
        return this.handleFinancialConnectionsAccountUpcomingAccountNumberExpiry(event);
      case 'identity.verification_session.canceled':
        return this.handleIdentityVerificationSessionCanceled(event);
      case 'identity.verification_session.created':
        return this.handleIdentityVerificationSessionCreated(event);
      case 'identity.verification_session.processing':
        return this.handleIdentityVerificationSessionProcessing(event);
      case 'identity.verification_session.redacted':
        return this.handleIdentityVerificationSessionRedacted(event);
      case 'identity.verification_session.requires_input':
        return this.handleIdentityVerificationSessionRequiresInput(event);
      case 'identity.verification_session.verified':
        return this.handleIdentityVerificationSessionVerified(event);
      case 'invoice.created':
        return this.handleInvoiceCreated(event);
      case 'invoice.deleted':
        return this.handleInvoiceDeleted(event);
      case 'invoice.finalization_failed':
        return this.handleInvoiceFinalizationFailed(event);
      case 'invoice.finalized':
        return this.handleInvoiceFinalized(event);
      case 'invoice.marked_uncollectible':
        return this.handleInvoiceMarkedUncollectible(event);
      case 'invoice.overdue':
        return this.handleInvoiceOverdue(event);
      case 'invoice.overpaid':
        return this.handleInvoiceOverpaid(event);
      case 'invoice.paid':
        return this.handleInvoicePaid(event);
      case 'invoice.payment_action_required':
        return this.handleInvoicePaymentActionRequired(event);
      case 'invoice.payment_attempt_required':
        return this.handleInvoicePaymentAttemptRequired(event);
      case 'invoice.payment_failed':
        return this.handleInvoicePaymentFailed(event);
      case 'invoice.payment_succeeded':
        return this.handleInvoicePaymentSucceeded(event);
      case 'invoice.sent':
        return this.handleInvoiceSent(event);
      case 'invoice.upcoming':
        return this.handleInvoiceUpcoming(event);
      case 'invoice.updated':
        return this.handleInvoiceUpdated(event);
      case 'invoice.voided':
        return this.handleInvoiceVoided(event);
      case 'invoice.will_be_due':
        return this.handleInvoiceWillBeDue(event);
      case 'invoice_payment.paid':
        return this.handleInvoicePaymentPaid(event);
      case 'invoiceitem.created':
        return this.handleInvoiceitemCreated(event);
      case 'invoiceitem.deleted':
        return this.handleInvoiceitemDeleted(event);
      case 'issuing_authorization.created':
        return this.handleIssuingAuthorizationCreated(event);
      case 'issuing_authorization.request':
        return this.handleIssuingAuthorizationRequest(event);
      case 'issuing_authorization.updated':
        return this.handleIssuingAuthorizationUpdated(event);
      case 'issuing_card.created':
        return this.handleIssuingCardCreated(event);
      case 'issuing_card.updated':
        return this.handleIssuingCardUpdated(event);
      case 'issuing_cardholder.created':
        return this.handleIssuingCardholderCreated(event);
      case 'issuing_cardholder.updated':
        return this.handleIssuingCardholderUpdated(event);
      case 'issuing_dispute.closed':
        return this.handleIssuingDisputeClosed(event);
      case 'issuing_dispute.created':
        return this.handleIssuingDisputeCreated(event);
      case 'issuing_dispute.funds_reinstated':
        return this.handleIssuingDisputeFundsReinstated(event);
      case 'issuing_dispute.funds_rescinded':
        return this.handleIssuingDisputeFundsRescinded(event);
      case 'issuing_dispute.submitted':
        return this.handleIssuingDisputeSubmitted(event);
      case 'issuing_dispute.updated':
        return this.handleIssuingDisputeUpdated(event);
      case 'issuing_personalization_design.activated':
        return this.handleIssuingPersonalizationDesignActivated(event);
      case 'issuing_personalization_design.deactivated':
        return this.handleIssuingPersonalizationDesignDeactivated(event);
      case 'issuing_personalization_design.rejected':
        return this.handleIssuingPersonalizationDesignRejected(event);
      case 'issuing_personalization_design.updated':
        return this.handleIssuingPersonalizationDesignUpdated(event);
      case 'issuing_token.created':
        return this.handleIssuingTokenCreated(event);
      case 'issuing_token.updated':
        return this.handleIssuingTokenUpdated(event);
      case 'issuing_transaction.created':
        return this.handleIssuingTransactionCreated(event);
      case 'issuing_transaction.purchase_details_receipt_updated':
        return this.handleIssuingTransactionPurchaseDetailsReceiptUpdated(event);
      case 'issuing_transaction.updated':
        return this.handleIssuingTransactionUpdated(event);
      case 'mandate.updated':
        return this.handleMandateUpdated(event);
      case 'payment_intent.amount_capturable_updated':
        return this.handlePaymentIntentAmountCapturableUpdated(event);
      case 'payment_intent.canceled':
        return this.handlePaymentIntentCanceled(event);
      case 'payment_intent.created':
        return this.handlePaymentIntentCreated(event);
      case 'payment_intent.partially_funded':
        return this.handlePaymentIntentPartiallyFunded(event);
      case 'payment_intent.payment_failed':
        return this.handlePaymentIntentPaymentFailed(event);
      case 'payment_intent.processing':
        return this.handlePaymentIntentProcessing(event);
      case 'payment_intent.requires_action':
        return this.handlePaymentIntentRequiresAction(event);
      case 'payment_intent.succeeded':
        return this.handlePaymentIntentSucceeded(event);
      case 'payment_link.created':
        return this.handlePaymentLinkCreated(event);
      case 'payment_link.updated':
        return this.handlePaymentLinkUpdated(event);
      case 'payment_method.attached':
        return this.handlePaymentMethodAttached(event);
      case 'payment_method.automatically_updated':
        return this.handlePaymentMethodAutomaticallyUpdated(event);
      case 'payment_method.detached':
        return this.handlePaymentMethodDetached(event);
      case 'payment_method.updated':
        return this.handlePaymentMethodUpdated(event);
      case 'payout.canceled':
        return this.handlePayoutCanceled(event);
      case 'payout.created':
        return this.handlePayoutCreated(event);
      case 'payout.failed':
        return this.handlePayoutFailed(event);
      case 'payout.paid':
        return this.handlePayoutPaid(event);
      case 'payout.reconciliation_completed':
        return this.handlePayoutReconciliationCompleted(event);
      case 'payout.updated':
        return this.handlePayoutUpdated(event);
      case 'person.created':
        return this.handlePersonCreated(event);
      case 'person.deleted':
        return this.handlePersonDeleted(event);
      case 'person.updated':
        return this.handlePersonUpdated(event);
      case 'plan.created':
        return this.handlePlanCreated(event);
      case 'plan.deleted':
        return this.handlePlanDeleted(event);
      case 'plan.updated':
        return this.handlePlanUpdated(event);
      case 'price.created':
        return this.handlePriceCreated(event);
      case 'price.deleted':
        return this.handlePriceDeleted(event);
      case 'price.updated':
        return this.handlePriceUpdated(event);
      case 'product.created':
        return this.handleProductCreated(event);
      case 'product.deleted':
        return this.handleProductDeleted(event);
      case 'product.updated':
        return this.handleProductUpdated(event);
      case 'promotion_code.created':
        return this.handlePromotionCodeCreated(event);
      case 'promotion_code.updated':
        return this.handlePromotionCodeUpdated(event);
      case 'quote.accepted':
        return this.handleQuoteAccepted(event);
      case 'quote.canceled':
        return this.handleQuoteCanceled(event);
      case 'quote.created':
        return this.handleQuoteCreated(event);
      case 'quote.finalized':
        return this.handleQuoteFinalized(event);
      case 'radar.early_fraud_warning.created':
        return this.handleRadarEarlyFraudWarningCreated(event);
      case 'radar.early_fraud_warning.updated':
        return this.handleRadarEarlyFraudWarningUpdated(event);
      case 'refund.created':
        return this.handleRefundCreated(event);
      case 'refund.failed':
        return this.handleRefundFailed(event);
      case 'refund.updated':
        return this.handleRefundUpdated(event);
      case 'reporting.report_run.failed':
        return this.handleReportingReportRunFailed(event);
      case 'reporting.report_run.succeeded':
        return this.handleReportingReportRunSucceeded(event);
      case 'reporting.report_type.updated':
        return this.handleReportingReportTypeUpdated(event);
      case 'review.closed':
        return this.handleReviewClosed(event);
      case 'review.opened':
        return this.handleReviewOpened(event);
      case 'setup_intent.canceled':
        return this.handleSetupIntentCanceled(event);
      case 'setup_intent.created':
        return this.handleSetupIntentCreated(event);
      case 'setup_intent.requires_action':
        return this.handleSetupIntentRequiresAction(event);
      case 'setup_intent.setup_failed':
        return this.handleSetupIntentSetupFailed(event);
      case 'setup_intent.succeeded':
        return this.handleSetupIntentSucceeded(event);
      case 'sigma.scheduled_query_run.created':
        return this.handleSigmaScheduledQueryRunCreated(event);
      case 'source.canceled':
        return this.handleSourceCanceled(event);
      case 'source.chargeable':
        return this.handleSourceChargeable(event);
      case 'source.failed':
        return this.handleSourceFailed(event);
      case 'source.mandate_notification':
        return this.handleSourceMandateNotification(event);
      case 'source.refund_attributes_required':
        return this.handleSourceRefundAttributesRequired(event);
      case 'source.transaction.created':
        return this.handleSourceTransactionCreated(event);
      case 'source.transaction.updated':
        return this.handleSourceTransactionUpdated(event);
      case 'subscription_schedule.aborted':
        return this.handleSubscriptionScheduleAborted(event);
      case 'subscription_schedule.canceled':
        return this.handleSubscriptionScheduleCanceled(event);
      case 'subscription_schedule.completed':
        return this.handleSubscriptionScheduleCompleted(event);
      case 'subscription_schedule.created':
        return this.handleSubscriptionScheduleCreated(event);
      case 'subscription_schedule.expiring':
        return this.handleSubscriptionScheduleExpiring(event);
      case 'subscription_schedule.released':
        return this.handleSubscriptionScheduleReleased(event);
      case 'subscription_schedule.updated':
        return this.handleSubscriptionScheduleUpdated(event);
      case 'tax.settings.updated':
        return this.handleTaxSettingsUpdated(event);
      case 'tax_rate.created':
        return this.handleTaxRateCreated(event);
      case 'tax_rate.updated':
        return this.handleTaxRateUpdated(event);
      case 'terminal.reader.action_failed':
        return this.handleTerminalReaderActionFailed(event);
      case 'terminal.reader.action_succeeded':
        return this.handleTerminalReaderActionSucceeded(event);
      case 'terminal.reader.action_updated':
        return this.handleTerminalReaderActionUpdated(event);
      case 'test_helpers.test_clock.advancing':
        return this.handleTestHelpersTestClockAdvancing(event);
      case 'test_helpers.test_clock.created':
        return this.handleTestHelpersTestClockCreated(event);
      case 'test_helpers.test_clock.deleted':
        return this.handleTestHelpersTestClockDeleted(event);
      case 'test_helpers.test_clock.internal_failure':
        return this.handleTestHelpersTestClockInternalFailure(event);
      case 'test_helpers.test_clock.ready':
        return this.handleTestHelpersTestClockReady(event);
      case 'topup.canceled':
        return this.handleTopupCanceled(event);
      case 'topup.created':
        return this.handleTopupCreated(event);
      case 'topup.failed':
        return this.handleTopupFailed(event);
      case 'topup.reversed':
        return this.handleTopupReversed(event);
      case 'topup.succeeded':
        return this.handleTopupSucceeded(event);
      case 'transfer.created':
        return this.handleTransferCreated(event);
      case 'transfer.reversed':
        return this.handleTransferReversed(event);
      case 'transfer.updated':
        return this.handleTransferUpdated(event);
      case 'treasury.credit_reversal.created':
        return this.handleTreasuryCreditReversalCreated(event);
      case 'treasury.credit_reversal.posted':
        return this.handleTreasuryCreditReversalPosted(event);
      case 'treasury.debit_reversal.completed':
        return this.handleTreasuryDebitReversalCompleted(event);
      case 'treasury.debit_reversal.created':
        return this.handleTreasuryDebitReversalCreated(event);
      case 'treasury.debit_reversal.initial_credit_granted':
        return this.handleTreasuryDebitReversalInitialCreditGranted(event);
      case 'treasury.financial_account.closed':
        return this.handleTreasuryFinancialAccountClosed(event);
      case 'treasury.financial_account.created':
        return this.handleTreasuryFinancialAccountCreated(event);
      case 'treasury.financial_account.features_status_updated':
        return this.handleTreasuryFinancialAccountFeaturesStatusUpdated(event);
      case 'treasury.inbound_transfer.canceled':
        return this.handleTreasuryInboundTransferCanceled(event);
      case 'treasury.inbound_transfer.created':
        return this.handleTreasuryInboundTransferCreated(event);
      case 'treasury.inbound_transfer.failed':
        return this.handleTreasuryInboundTransferFailed(event);
      case 'treasury.inbound_transfer.succeeded':
        return this.handleTreasuryInboundTransferSucceeded(event);
      case 'treasury.outbound_payment.canceled':
        return this.handleTreasuryOutboundPaymentCanceled(event);
      case 'treasury.outbound_payment.created':
        return this.handleTreasuryOutboundPaymentCreated(event);
      case 'treasury.outbound_payment.expected_arrival_date_updated':
        return this.handleTreasuryOutboundPaymentExpectedArrivalDateUpdated(event);
      case 'treasury.outbound_payment.failed':
        return this.handleTreasuryOutboundPaymentFailed(event);
      case 'treasury.outbound_payment.posted':
        return this.handleTreasuryOutboundPaymentPosted(event);
      case 'treasury.outbound_payment.returned':
        return this.handleTreasuryOutboundPaymentReturned(event);
      case 'treasury.outbound_payment.tracking_details_updated':
        return this.handleTreasuryOutboundPaymentTrackingDetailsUpdated(event);
      case 'treasury.outbound_transfer.canceled':
        return this.handleTreasuryOutboundTransferCanceled(event);
      case 'treasury.outbound_transfer.created':
        return this.handleTreasuryOutboundTransferCreated(event);
      case 'treasury.outbound_transfer.expected_arrival_date_updated':
        return this.handleTreasuryOutboundTransferExpectedArrivalDateUpdated(event);
      case 'treasury.outbound_transfer.failed':
        return this.handleTreasuryOutboundTransferFailed(event);
      case 'treasury.outbound_transfer.posted':
        return this.handleTreasuryOutboundTransferPosted(event);
      case 'treasury.outbound_transfer.returned':
        return this.handleTreasuryOutboundTransferReturned(event);
      case 'treasury.outbound_transfer.tracking_details_updated':
        return this.handleTreasuryOutboundTransferTrackingDetailsUpdated(event);
      case 'treasury.received_credit.created':
        return this.handleTreasuryReceivedCreditCreated(event);
      case 'treasury.received_credit.failed':
        return this.handleTreasuryReceivedCreditFailed(event);
      case 'treasury.received_credit.succeeded':
        return this.handleTreasuryReceivedCreditSucceeded(event);
      case 'treasury.received_debit.created':
        return this.handleTreasuryReceivedDebitCreated(event);
      case 'billing.credit_balance_transaction.created':
        return this.handleBillingCreditBalanceTransactionCreated(event);
      case 'billing.credit_grant.created':
        return this.handleBillingCreditGrantCreated(event);
      case 'billing.credit_grant.updated':
        return this.handleBillingCreditGrantUpdated(event);
      case 'billing.meter.created':
        return this.handleBillingMeterCreated(event);
      case 'billing.meter.deactivated':
        return this.handleBillingMeterDeactivated(event);
      case 'billing.meter.reactivated':
        return this.handleBillingMeterReactivated(event);
      case 'billing.meter.updated':
        return this.handleBillingMeterUpdated(event);
      default:
        // This should never happen if all event types are handled
        logger.warn('Unhandled event type:', { type: (event as Stripe.Event).type });
    }
  }

  /**
   * Stop consuming messages and close the connection
   */
  public async close(): Promise<void> {
    this.consuming = false;

    if (this.channel) {
      await this.channel.close();
      this.channel = null;
    }

    if (this.connection) {
      await this.connection.close();
      this.connection = null;
    }

    logger.info('Consumer closed');
  }

  // ============================================================================
  // Event Handler Methods
  //
  // Default implementations do nothing and acknowledge the event.
  // Override these methods in your subclass to implement custom logic.
  // All methods are strongly typed with their specific Stripe event types.
  // ============================================================================

  protected async handleAccountApplicationAuthorized(event: Stripe.AccountApplicationAuthorizedEvent): Promise<void> {}
  protected async handleAccountApplicationDeauthorized(event: Stripe.AccountApplicationDeauthorizedEvent): Promise<void> {}
  protected async handleAccountExternalAccountCreated(event: Stripe.AccountExternalAccountCreatedEvent): Promise<void> {}
  protected async handleAccountExternalAccountDeleted(event: Stripe.AccountExternalAccountDeletedEvent): Promise<void> {}
  protected async handleAccountExternalAccountUpdated(event: Stripe.AccountExternalAccountUpdatedEvent): Promise<void> {}
  protected async handleAccountUpdated(event: Stripe.AccountUpdatedEvent): Promise<void> {}
  protected async handleApplicationFeeCreated(event: Stripe.ApplicationFeeCreatedEvent): Promise<void> {}
  protected async handleApplicationFeeRefundUpdated(event: Stripe.ApplicationFeeRefundUpdatedEvent): Promise<void> {}
  protected async handleApplicationFeeRefunded(event: Stripe.ApplicationFeeRefundedEvent): Promise<void> {}
  protected async handleBalanceAvailable(event: Stripe.BalanceAvailableEvent): Promise<void> {}
  protected async handleBalanceSettingsUpdated(event: Stripe.BalanceSettingsUpdatedEvent): Promise<void> {}
  protected async handleBillingAlertTriggered(event: Stripe.BillingAlertTriggeredEvent): Promise<void> {}
  protected async handleBillingPortalConfigurationCreated(event: Stripe.BillingPortalConfigurationCreatedEvent): Promise<void> {}
  protected async handleBillingPortalConfigurationUpdated(event: Stripe.BillingPortalConfigurationUpdatedEvent): Promise<void> {}
  protected async handleBillingPortalSessionCreated(event: Stripe.BillingPortalSessionCreatedEvent): Promise<void> {}
  protected async handleCapabilityUpdated(event: Stripe.CapabilityUpdatedEvent): Promise<void> {}
  protected async handleCashBalanceFundsAvailable(event: Stripe.CashBalanceFundsAvailableEvent): Promise<void> {}
  protected async handleChargeCaptured(event: Stripe.ChargeCapturedEvent): Promise<void> {}
  protected async handleChargeDisputeClosed(event: Stripe.ChargeDisputeClosedEvent): Promise<void> {}
  protected async handleChargeDisputeCreated(event: Stripe.ChargeDisputeCreatedEvent): Promise<void> {}
  protected async handleChargeDisputeFundsReinstated(event: Stripe.ChargeDisputeFundsReinstatedEvent): Promise<void> {}
  protected async handleChargeDisputeFundsWithdrawn(event: Stripe.ChargeDisputeFundsWithdrawnEvent): Promise<void> {}
  protected async handleChargeDisputeUpdated(event: Stripe.ChargeDisputeUpdatedEvent): Promise<void> {}
  protected async handleChargeExpired(event: Stripe.ChargeExpiredEvent): Promise<void> {}
  protected async handleChargeFailed(event: Stripe.ChargeFailedEvent): Promise<void> {}
  protected async handleChargePending(event: Stripe.ChargePendingEvent): Promise<void> {}
  protected async handleChargeRefundUpdated(event: Stripe.ChargeRefundUpdatedEvent): Promise<void> {}
  protected async handleChargeRefunded(event: Stripe.ChargeRefundedEvent): Promise<void> {}
  protected async handleChargeSucceeded(event: Stripe.ChargeSucceededEvent): Promise<void> {}
  protected async handleChargeUpdated(event: Stripe.ChargeUpdatedEvent): Promise<void> {}
  protected async handleCheckoutSessionAsyncPaymentFailed(event: Stripe.CheckoutSessionAsyncPaymentFailedEvent): Promise<void> {}
  protected async handleCheckoutSessionAsyncPaymentSucceeded(event: Stripe.CheckoutSessionAsyncPaymentSucceededEvent): Promise<void> {}
  protected async handleCheckoutSessionCompleted(event: Stripe.CheckoutSessionCompletedEvent): Promise<void> {}
  protected async handleCheckoutSessionExpired(event: Stripe.CheckoutSessionExpiredEvent): Promise<void> {}
  protected async handleClimateOrderCanceled(event: Stripe.ClimateOrderCanceledEvent): Promise<void> {}
  protected async handleClimateOrderCreated(event: Stripe.ClimateOrderCreatedEvent): Promise<void> {}
  protected async handleClimateOrderDelayed(event: Stripe.ClimateOrderDelayedEvent): Promise<void> {}
  protected async handleClimateOrderDelivered(event: Stripe.ClimateOrderDeliveredEvent): Promise<void> {}
  protected async handleClimateOrderProductSubstituted(event: Stripe.ClimateOrderProductSubstitutedEvent): Promise<void> {}
  protected async handleClimateProductCreated(event: Stripe.ClimateProductCreatedEvent): Promise<void> {}
  protected async handleClimateProductPricingUpdated(event: Stripe.ClimateProductPricingUpdatedEvent): Promise<void> {}
  protected async handleCouponCreated(event: Stripe.CouponCreatedEvent): Promise<void> {}
  protected async handleCouponDeleted(event: Stripe.CouponDeletedEvent): Promise<void> {}
  protected async handleCouponUpdated(event: Stripe.CouponUpdatedEvent): Promise<void> {}
  protected async handleCreditNoteCreated(event: Stripe.CreditNoteCreatedEvent): Promise<void> {}
  protected async handleCreditNoteUpdated(event: Stripe.CreditNoteUpdatedEvent): Promise<void> {}
  protected async handleCreditNoteVoided(event: Stripe.CreditNoteVoidedEvent): Promise<void> {}
  protected async handleCustomerCreated(event: Stripe.CustomerCreatedEvent): Promise<void> {}
  protected async handleCustomerDeleted(event: Stripe.CustomerDeletedEvent): Promise<void> {}
  protected async handleCustomerDiscountCreated(event: Stripe.CustomerDiscountCreatedEvent): Promise<void> {}
  protected async handleCustomerDiscountDeleted(event: Stripe.CustomerDiscountDeletedEvent): Promise<void> {}
  protected async handleCustomerDiscountUpdated(event: Stripe.CustomerDiscountUpdatedEvent): Promise<void> {}
  protected async handleCustomerSourceCreated(event: Stripe.CustomerSourceCreatedEvent): Promise<void> {}
  protected async handleCustomerSourceDeleted(event: Stripe.CustomerSourceDeletedEvent): Promise<void> {}
  protected async handleCustomerSourceExpiring(event: Stripe.CustomerSourceExpiringEvent): Promise<void> {}
  protected async handleCustomerSourceUpdated(event: Stripe.CustomerSourceUpdatedEvent): Promise<void> {}
  protected async handleCustomerSubscriptionCreated(event: Stripe.CustomerSubscriptionCreatedEvent): Promise<void> {}
  protected async handleCustomerSubscriptionDeleted(event: Stripe.CustomerSubscriptionDeletedEvent): Promise<void> {}
  protected async handleCustomerSubscriptionPaused(event: Stripe.CustomerSubscriptionPausedEvent): Promise<void> {}
  protected async handleCustomerSubscriptionPendingUpdateApplied(event: Stripe.CustomerSubscriptionPendingUpdateAppliedEvent): Promise<void> {}
  protected async handleCustomerSubscriptionPendingUpdateExpired(event: Stripe.CustomerSubscriptionPendingUpdateExpiredEvent): Promise<void> {}
  protected async handleCustomerSubscriptionResumed(event: Stripe.CustomerSubscriptionResumedEvent): Promise<void> {}
  protected async handleCustomerSubscriptionTrialWillEnd(event: Stripe.CustomerSubscriptionTrialWillEndEvent): Promise<void> {}
  protected async handleCustomerSubscriptionUpdated(event: Stripe.CustomerSubscriptionUpdatedEvent): Promise<void> {}
  protected async handleCustomerTaxIdCreated(event: Stripe.CustomerTaxIdCreatedEvent): Promise<void> {}
  protected async handleCustomerTaxIdDeleted(event: Stripe.CustomerTaxIdDeletedEvent): Promise<void> {}
  protected async handleCustomerTaxIdUpdated(event: Stripe.CustomerTaxIdUpdatedEvent): Promise<void> {}
  protected async handleCustomerUpdated(event: Stripe.CustomerUpdatedEvent): Promise<void> {}
  protected async handleCustomerCashBalanceTransactionCreated(event: Stripe.CustomerCashBalanceTransactionCreatedEvent): Promise<void> {}
  protected async handleEntitlementsActiveEntitlementSummaryUpdated(event: Stripe.EntitlementsActiveEntitlementSummaryUpdatedEvent): Promise<void> {}
  protected async handleFileCreated(event: Stripe.FileCreatedEvent): Promise<void> {}
  protected async handleFinancialConnectionsAccountAccountNumbersUpdated(event: Stripe.FinancialConnectionsAccountAccountNumbersUpdatedEvent): Promise<void> {}
  protected async handleFinancialConnectionsAccountCreated(event: Stripe.FinancialConnectionsAccountCreatedEvent): Promise<void> {}
  protected async handleFinancialConnectionsAccountDeactivated(event: Stripe.FinancialConnectionsAccountDeactivatedEvent): Promise<void> {}
  protected async handleFinancialConnectionsAccountDisconnected(event: Stripe.FinancialConnectionsAccountDisconnectedEvent): Promise<void> {}
  protected async handleFinancialConnectionsAccountReactivated(event: Stripe.FinancialConnectionsAccountReactivatedEvent): Promise<void> {}
  protected async handleFinancialConnectionsAccountRefreshedBalance(event: Stripe.FinancialConnectionsAccountRefreshedBalanceEvent): Promise<void> {}
  protected async handleFinancialConnectionsAccountRefreshedOwnership(event: Stripe.FinancialConnectionsAccountRefreshedOwnershipEvent): Promise<void> {}
  protected async handleFinancialConnectionsAccountRefreshedTransactions(event: Stripe.FinancialConnectionsAccountRefreshedTransactionsEvent): Promise<void> {}
  protected async handleFinancialConnectionsAccountUpcomingAccountNumberExpiry(event: Stripe.FinancialConnectionsAccountUpcomingAccountNumberExpiryEvent): Promise<void> {}
  protected async handleIdentityVerificationSessionCanceled(event: Stripe.IdentityVerificationSessionCanceledEvent): Promise<void> {}
  protected async handleIdentityVerificationSessionCreated(event: Stripe.IdentityVerificationSessionCreatedEvent): Promise<void> {}
  protected async handleIdentityVerificationSessionProcessing(event: Stripe.IdentityVerificationSessionProcessingEvent): Promise<void> {}
  protected async handleIdentityVerificationSessionRedacted(event: Stripe.IdentityVerificationSessionRedactedEvent): Promise<void> {}
  protected async handleIdentityVerificationSessionRequiresInput(event: Stripe.IdentityVerificationSessionRequiresInputEvent): Promise<void> {}
  protected async handleIdentityVerificationSessionVerified(event: Stripe.IdentityVerificationSessionVerifiedEvent): Promise<void> {}
  protected async handleInvoiceCreated(event: Stripe.InvoiceCreatedEvent): Promise<void> {}
  protected async handleInvoiceDeleted(event: Stripe.InvoiceDeletedEvent): Promise<void> {}
  protected async handleInvoiceFinalizationFailed(event: Stripe.InvoiceFinalizationFailedEvent): Promise<void> {}
  protected async handleInvoiceFinalized(event: Stripe.InvoiceFinalizedEvent): Promise<void> {}
  protected async handleInvoiceMarkedUncollectible(event: Stripe.InvoiceMarkedUncollectibleEvent): Promise<void> {}
  protected async handleInvoiceOverdue(event: Stripe.InvoiceOverdueEvent): Promise<void> {}
  protected async handleInvoiceOverpaid(event: Stripe.InvoiceOverpaidEvent): Promise<void> {}
  protected async handleInvoicePaid(event: Stripe.InvoicePaidEvent): Promise<void> {}
  protected async handleInvoicePaymentActionRequired(event: Stripe.InvoicePaymentActionRequiredEvent): Promise<void> {}
  protected async handleInvoicePaymentAttemptRequired(event: Stripe.InvoicePaymentAttemptRequiredEvent): Promise<void> {}
  protected async handleInvoicePaymentFailed(event: Stripe.InvoicePaymentFailedEvent): Promise<void> {}
  protected async handleInvoicePaymentSucceeded(event: Stripe.InvoicePaymentSucceededEvent): Promise<void> {}
  protected async handleInvoiceSent(event: Stripe.InvoiceSentEvent): Promise<void> {}
  protected async handleInvoiceUpcoming(event: Stripe.InvoiceUpcomingEvent): Promise<void> {}
  protected async handleInvoiceUpdated(event: Stripe.InvoiceUpdatedEvent): Promise<void> {}
  protected async handleInvoiceVoided(event: Stripe.InvoiceVoidedEvent): Promise<void> {}
  protected async handleInvoiceWillBeDue(event: Stripe.InvoiceWillBeDueEvent): Promise<void> {}
  protected async handleInvoicePaymentPaid(event: Stripe.InvoicePaymentPaidEvent): Promise<void> {}
  protected async handleInvoiceitemCreated(event: Stripe.InvoiceitemCreatedEvent): Promise<void> {}
  protected async handleInvoiceitemDeleted(event: Stripe.InvoiceitemDeletedEvent): Promise<void> {}
  protected async handleIssuingAuthorizationCreated(event: Stripe.IssuingAuthorizationCreatedEvent): Promise<void> {}
  protected async handleIssuingAuthorizationRequest(event: Stripe.IssuingAuthorizationRequestEvent): Promise<void> {}
  protected async handleIssuingAuthorizationUpdated(event: Stripe.IssuingAuthorizationUpdatedEvent): Promise<void> {}
  protected async handleIssuingCardCreated(event: Stripe.IssuingCardCreatedEvent): Promise<void> {}
  protected async handleIssuingCardUpdated(event: Stripe.IssuingCardUpdatedEvent): Promise<void> {}
  protected async handleIssuingCardholderCreated(event: Stripe.IssuingCardholderCreatedEvent): Promise<void> {}
  protected async handleIssuingCardholderUpdated(event: Stripe.IssuingCardholderUpdatedEvent): Promise<void> {}
  protected async handleIssuingDisputeClosed(event: Stripe.IssuingDisputeClosedEvent): Promise<void> {}
  protected async handleIssuingDisputeCreated(event: Stripe.IssuingDisputeCreatedEvent): Promise<void> {}
  protected async handleIssuingDisputeFundsReinstated(event: Stripe.IssuingDisputeFundsReinstatedEvent): Promise<void> {}
  protected async handleIssuingDisputeFundsRescinded(event: Stripe.IssuingDisputeFundsRescindedEvent): Promise<void> {}
  protected async handleIssuingDisputeSubmitted(event: Stripe.IssuingDisputeSubmittedEvent): Promise<void> {}
  protected async handleIssuingDisputeUpdated(event: Stripe.IssuingDisputeUpdatedEvent): Promise<void> {}
  protected async handleIssuingPersonalizationDesignActivated(event: Stripe.IssuingPersonalizationDesignActivatedEvent): Promise<void> {}
  protected async handleIssuingPersonalizationDesignDeactivated(event: Stripe.IssuingPersonalizationDesignDeactivatedEvent): Promise<void> {}
  protected async handleIssuingPersonalizationDesignRejected(event: Stripe.IssuingPersonalizationDesignRejectedEvent): Promise<void> {}
  protected async handleIssuingPersonalizationDesignUpdated(event: Stripe.IssuingPersonalizationDesignUpdatedEvent): Promise<void> {}
  protected async handleIssuingTokenCreated(event: Stripe.IssuingTokenCreatedEvent): Promise<void> {}
  protected async handleIssuingTokenUpdated(event: Stripe.IssuingTokenUpdatedEvent): Promise<void> {}
  protected async handleIssuingTransactionCreated(event: Stripe.IssuingTransactionCreatedEvent): Promise<void> {}
  protected async handleIssuingTransactionPurchaseDetailsReceiptUpdated(event: Stripe.IssuingTransactionPurchaseDetailsReceiptUpdatedEvent): Promise<void> {}
  protected async handleIssuingTransactionUpdated(event: Stripe.IssuingTransactionUpdatedEvent): Promise<void> {}
  protected async handleMandateUpdated(event: Stripe.MandateUpdatedEvent): Promise<void> {}
  protected async handlePaymentIntentAmountCapturableUpdated(event: Stripe.PaymentIntentAmountCapturableUpdatedEvent): Promise<void> {}
  protected async handlePaymentIntentCanceled(event: Stripe.PaymentIntentCanceledEvent): Promise<void> {}
  protected async handlePaymentIntentCreated(event: Stripe.PaymentIntentCreatedEvent): Promise<void> {}
  protected async handlePaymentIntentPartiallyFunded(event: Stripe.PaymentIntentPartiallyFundedEvent): Promise<void> {}
  protected async handlePaymentIntentPaymentFailed(event: Stripe.PaymentIntentPaymentFailedEvent): Promise<void> {}
  protected async handlePaymentIntentProcessing(event: Stripe.PaymentIntentProcessingEvent): Promise<void> {}
  protected async handlePaymentIntentRequiresAction(event: Stripe.PaymentIntentRequiresActionEvent): Promise<void> {}
  protected async handlePaymentIntentSucceeded(event: Stripe.PaymentIntentSucceededEvent): Promise<void> {}
  protected async handlePaymentLinkCreated(event: Stripe.PaymentLinkCreatedEvent): Promise<void> {}
  protected async handlePaymentLinkUpdated(event: Stripe.PaymentLinkUpdatedEvent): Promise<void> {}
  protected async handlePaymentMethodAttached(event: Stripe.PaymentMethodAttachedEvent): Promise<void> {}
  protected async handlePaymentMethodAutomaticallyUpdated(event: Stripe.PaymentMethodAutomaticallyUpdatedEvent): Promise<void> {}
  protected async handlePaymentMethodDetached(event: Stripe.PaymentMethodDetachedEvent): Promise<void> {}
  protected async handlePaymentMethodUpdated(event: Stripe.PaymentMethodUpdatedEvent): Promise<void> {}
  protected async handlePayoutCanceled(event: Stripe.PayoutCanceledEvent): Promise<void> {}
  protected async handlePayoutCreated(event: Stripe.PayoutCreatedEvent): Promise<void> {}
  protected async handlePayoutFailed(event: Stripe.PayoutFailedEvent): Promise<void> {}
  protected async handlePayoutPaid(event: Stripe.PayoutPaidEvent): Promise<void> {}
  protected async handlePayoutReconciliationCompleted(event: Stripe.PayoutReconciliationCompletedEvent): Promise<void> {}
  protected async handlePayoutUpdated(event: Stripe.PayoutUpdatedEvent): Promise<void> {}
  protected async handlePersonCreated(event: Stripe.PersonCreatedEvent): Promise<void> {}
  protected async handlePersonDeleted(event: Stripe.PersonDeletedEvent): Promise<void> {}
  protected async handlePersonUpdated(event: Stripe.PersonUpdatedEvent): Promise<void> {}
  protected async handlePlanCreated(event: Stripe.PlanCreatedEvent): Promise<void> {}
  protected async handlePlanDeleted(event: Stripe.PlanDeletedEvent): Promise<void> {}
  protected async handlePlanUpdated(event: Stripe.PlanUpdatedEvent): Promise<void> {}
  protected async handlePriceCreated(event: Stripe.PriceCreatedEvent): Promise<void> {}
  protected async handlePriceDeleted(event: Stripe.PriceDeletedEvent): Promise<void> {}
  protected async handlePriceUpdated(event: Stripe.PriceUpdatedEvent): Promise<void> {}
  protected async handleProductCreated(event: Stripe.ProductCreatedEvent): Promise<void> {}
  protected async handleProductDeleted(event: Stripe.ProductDeletedEvent): Promise<void> {}
  protected async handleProductUpdated(event: Stripe.ProductUpdatedEvent): Promise<void> {}
  protected async handlePromotionCodeCreated(event: Stripe.PromotionCodeCreatedEvent): Promise<void> {}
  protected async handlePromotionCodeUpdated(event: Stripe.PromotionCodeUpdatedEvent): Promise<void> {}
  protected async handleQuoteAccepted(event: Stripe.QuoteAcceptedEvent): Promise<void> {}
  protected async handleQuoteCanceled(event: Stripe.QuoteCanceledEvent): Promise<void> {}
  protected async handleQuoteCreated(event: Stripe.QuoteCreatedEvent): Promise<void> {}
  protected async handleQuoteFinalized(event: Stripe.QuoteFinalizedEvent): Promise<void> {}
  protected async handleRadarEarlyFraudWarningCreated(event: Stripe.RadarEarlyFraudWarningCreatedEvent): Promise<void> {}
  protected async handleRadarEarlyFraudWarningUpdated(event: Stripe.RadarEarlyFraudWarningUpdatedEvent): Promise<void> {}
  protected async handleRefundCreated(event: Stripe.RefundCreatedEvent): Promise<void> {}
  protected async handleRefundFailed(event: Stripe.RefundFailedEvent): Promise<void> {}
  protected async handleRefundUpdated(event: Stripe.RefundUpdatedEvent): Promise<void> {}
  protected async handleReportingReportRunFailed(event: Stripe.ReportingReportRunFailedEvent): Promise<void> {}
  protected async handleReportingReportRunSucceeded(event: Stripe.ReportingReportRunSucceededEvent): Promise<void> {}
  protected async handleReportingReportTypeUpdated(event: Stripe.ReportingReportTypeUpdatedEvent): Promise<void> {}
  protected async handleReviewClosed(event: Stripe.ReviewClosedEvent): Promise<void> {}
  protected async handleReviewOpened(event: Stripe.ReviewOpenedEvent): Promise<void> {}
  protected async handleSetupIntentCanceled(event: Stripe.SetupIntentCanceledEvent): Promise<void> {}
  protected async handleSetupIntentCreated(event: Stripe.SetupIntentCreatedEvent): Promise<void> {}
  protected async handleSetupIntentRequiresAction(event: Stripe.SetupIntentRequiresActionEvent): Promise<void> {}
  protected async handleSetupIntentSetupFailed(event: Stripe.SetupIntentSetupFailedEvent): Promise<void> {}
  protected async handleSetupIntentSucceeded(event: Stripe.SetupIntentSucceededEvent): Promise<void> {}
  protected async handleSigmaScheduledQueryRunCreated(event: Stripe.SigmaScheduledQueryRunCreatedEvent): Promise<void> {}
  protected async handleSourceCanceled(event: Stripe.SourceCanceledEvent): Promise<void> {}
  protected async handleSourceChargeable(event: Stripe.SourceChargeableEvent): Promise<void> {}
  protected async handleSourceFailed(event: Stripe.SourceFailedEvent): Promise<void> {}
  protected async handleSourceMandateNotification(event: Stripe.SourceMandateNotificationEvent): Promise<void> {}
  protected async handleSourceRefundAttributesRequired(event: Stripe.SourceRefundAttributesRequiredEvent): Promise<void> {}
  protected async handleSourceTransactionCreated(event: Stripe.SourceTransactionCreatedEvent): Promise<void> {}
  protected async handleSourceTransactionUpdated(event: Stripe.SourceTransactionUpdatedEvent): Promise<void> {}
  protected async handleSubscriptionScheduleAborted(event: Stripe.SubscriptionScheduleAbortedEvent): Promise<void> {}
  protected async handleSubscriptionScheduleCanceled(event: Stripe.SubscriptionScheduleCanceledEvent): Promise<void> {}
  protected async handleSubscriptionScheduleCompleted(event: Stripe.SubscriptionScheduleCompletedEvent): Promise<void> {}
  protected async handleSubscriptionScheduleCreated(event: Stripe.SubscriptionScheduleCreatedEvent): Promise<void> {}
  protected async handleSubscriptionScheduleExpiring(event: Stripe.SubscriptionScheduleExpiringEvent): Promise<void> {}
  protected async handleSubscriptionScheduleReleased(event: Stripe.SubscriptionScheduleReleasedEvent): Promise<void> {}
  protected async handleSubscriptionScheduleUpdated(event: Stripe.SubscriptionScheduleUpdatedEvent): Promise<void> {}
  protected async handleTaxSettingsUpdated(event: Stripe.TaxSettingsUpdatedEvent): Promise<void> {}
  protected async handleTaxRateCreated(event: Stripe.TaxRateCreatedEvent): Promise<void> {}
  protected async handleTaxRateUpdated(event: Stripe.TaxRateUpdatedEvent): Promise<void> {}
  protected async handleTerminalReaderActionFailed(event: Stripe.TerminalReaderActionFailedEvent): Promise<void> {}
  protected async handleTerminalReaderActionSucceeded(event: Stripe.TerminalReaderActionSucceededEvent): Promise<void> {}
  protected async handleTerminalReaderActionUpdated(event: Stripe.TerminalReaderActionUpdatedEvent): Promise<void> {}
  protected async handleTestHelpersTestClockAdvancing(event: Stripe.TestHelpersTestClockAdvancingEvent): Promise<void> {}
  protected async handleTestHelpersTestClockCreated(event: Stripe.TestHelpersTestClockCreatedEvent): Promise<void> {}
  protected async handleTestHelpersTestClockDeleted(event: Stripe.TestHelpersTestClockDeletedEvent): Promise<void> {}
  protected async handleTestHelpersTestClockInternalFailure(event: Stripe.TestHelpersTestClockInternalFailureEvent): Promise<void> {}
  protected async handleTestHelpersTestClockReady(event: Stripe.TestHelpersTestClockReadyEvent): Promise<void> {}
  protected async handleTopupCanceled(event: Stripe.TopupCanceledEvent): Promise<void> {}
  protected async handleTopupCreated(event: Stripe.TopupCreatedEvent): Promise<void> {}
  protected async handleTopupFailed(event: Stripe.TopupFailedEvent): Promise<void> {}
  protected async handleTopupReversed(event: Stripe.TopupReversedEvent): Promise<void> {}
  protected async handleTopupSucceeded(event: Stripe.TopupSucceededEvent): Promise<void> {}
  protected async handleTransferCreated(event: Stripe.TransferCreatedEvent): Promise<void> {}
  protected async handleTransferReversed(event: Stripe.TransferReversedEvent): Promise<void> {}
  protected async handleTransferUpdated(event: Stripe.TransferUpdatedEvent): Promise<void> {}
  protected async handleTreasuryCreditReversalCreated(event: Stripe.TreasuryCreditReversalCreatedEvent): Promise<void> {}
  protected async handleTreasuryCreditReversalPosted(event: Stripe.TreasuryCreditReversalPostedEvent): Promise<void> {}
  protected async handleTreasuryDebitReversalCompleted(event: Stripe.TreasuryDebitReversalCompletedEvent): Promise<void> {}
  protected async handleTreasuryDebitReversalCreated(event: Stripe.TreasuryDebitReversalCreatedEvent): Promise<void> {}
  protected async handleTreasuryDebitReversalInitialCreditGranted(event: Stripe.TreasuryDebitReversalInitialCreditGrantedEvent): Promise<void> {}
  protected async handleTreasuryFinancialAccountClosed(event: Stripe.TreasuryFinancialAccountClosedEvent): Promise<void> {}
  protected async handleTreasuryFinancialAccountCreated(event: Stripe.TreasuryFinancialAccountCreatedEvent): Promise<void> {}
  protected async handleTreasuryFinancialAccountFeaturesStatusUpdated(event: Stripe.TreasuryFinancialAccountFeaturesStatusUpdatedEvent): Promise<void> {}
  protected async handleTreasuryInboundTransferCanceled(event: Stripe.TreasuryInboundTransferCanceledEvent): Promise<void> {}
  protected async handleTreasuryInboundTransferCreated(event: Stripe.TreasuryInboundTransferCreatedEvent): Promise<void> {}
  protected async handleTreasuryInboundTransferFailed(event: Stripe.TreasuryInboundTransferFailedEvent): Promise<void> {}
  protected async handleTreasuryInboundTransferSucceeded(event: Stripe.TreasuryInboundTransferSucceededEvent): Promise<void> {}
  protected async handleTreasuryOutboundPaymentCanceled(event: Stripe.TreasuryOutboundPaymentCanceledEvent): Promise<void> {}
  protected async handleTreasuryOutboundPaymentCreated(event: Stripe.TreasuryOutboundPaymentCreatedEvent): Promise<void> {}
  protected async handleTreasuryOutboundPaymentExpectedArrivalDateUpdated(event: Stripe.TreasuryOutboundPaymentExpectedArrivalDateUpdatedEvent): Promise<void> {}
  protected async handleTreasuryOutboundPaymentFailed(event: Stripe.TreasuryOutboundPaymentFailedEvent): Promise<void> {}
  protected async handleTreasuryOutboundPaymentPosted(event: Stripe.TreasuryOutboundPaymentPostedEvent): Promise<void> {}
  protected async handleTreasuryOutboundPaymentReturned(event: Stripe.TreasuryOutboundPaymentReturnedEvent): Promise<void> {}
  protected async handleTreasuryOutboundPaymentTrackingDetailsUpdated(event: Stripe.TreasuryOutboundPaymentTrackingDetailsUpdatedEvent): Promise<void> {}
  protected async handleTreasuryOutboundTransferCanceled(event: Stripe.TreasuryOutboundTransferCanceledEvent): Promise<void> {}
  protected async handleTreasuryOutboundTransferCreated(event: Stripe.TreasuryOutboundTransferCreatedEvent): Promise<void> {}
  protected async handleTreasuryOutboundTransferExpectedArrivalDateUpdated(event: Stripe.TreasuryOutboundTransferExpectedArrivalDateUpdatedEvent): Promise<void> {}
  protected async handleTreasuryOutboundTransferFailed(event: Stripe.TreasuryOutboundTransferFailedEvent): Promise<void> {}
  protected async handleTreasuryOutboundTransferPosted(event: Stripe.TreasuryOutboundTransferPostedEvent): Promise<void> {}
  protected async handleTreasuryOutboundTransferReturned(event: Stripe.TreasuryOutboundTransferReturnedEvent): Promise<void> {}
  protected async handleTreasuryOutboundTransferTrackingDetailsUpdated(event: Stripe.TreasuryOutboundTransferTrackingDetailsUpdatedEvent): Promise<void> {}
  protected async handleTreasuryReceivedCreditCreated(event: Stripe.TreasuryReceivedCreditCreatedEvent): Promise<void> {}
  protected async handleTreasuryReceivedCreditFailed(event: Stripe.TreasuryReceivedCreditFailedEvent): Promise<void> {}
  protected async handleTreasuryReceivedCreditSucceeded(event: Stripe.TreasuryReceivedCreditSucceededEvent): Promise<void> {}
  protected async handleTreasuryReceivedDebitCreated(event: Stripe.TreasuryReceivedDebitCreatedEvent): Promise<void> {}
  protected async handleBillingCreditBalanceTransactionCreated(event: Stripe.BillingCreditBalanceTransactionCreatedEvent): Promise<void> {}
  protected async handleBillingCreditGrantCreated(event: Stripe.BillingCreditGrantCreatedEvent): Promise<void> {}
  protected async handleBillingCreditGrantUpdated(event: Stripe.BillingCreditGrantUpdatedEvent): Promise<void> {}
  protected async handleBillingMeterCreated(event: Stripe.BillingMeterCreatedEvent): Promise<void> {}
  protected async handleBillingMeterDeactivated(event: Stripe.BillingMeterDeactivatedEvent): Promise<void> {}
  protected async handleBillingMeterReactivated(event: Stripe.BillingMeterReactivatedEvent): Promise<void> {}
  protected async handleBillingMeterUpdated(event: Stripe.BillingMeterUpdatedEvent): Promise<void> {}
}
