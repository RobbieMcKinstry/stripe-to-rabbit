Feature: Stripe Webhook Endpoint
  As a Stripe integration
  I want to receive and process webhook events
  So that I can publish them to RabbitMQ for asynchronous processing

  Scenario: Reject webhook with invalid signature
    Given the webhook service is running
    And I have a Stripe webhook payload
    When I send a POST request with an invalid signature
    Then the response status should be 400
    And the response should contain an error about signature verification

  Scenario: GET request returns health check instead of processing webhook
    Given the webhook service is running
    When I send a GET request to the webhook endpoint
    Then the response status should be 200
    And the response should contain status "ok"
    And the response should contain message "Stripe webhook endpoint is ready"
    And the response should not process any webhook data

  Scenario: Reject webhook with empty request body
    Given the webhook service is running
    When I send a POST request with an empty body and valid signature header
    Then the response status should be 400
    And the response should contain an error about signature verification

  Scenario: Successfully process valid webhook and publish to RabbitMQ
    Given the webhook service is running
    And I have a valid Stripe webhook event
    And RabbitMQ is ready to receive messages
    When I send a POST request with valid signature and payload
    Then the response status should be 200
    And the response should indicate the event was received
    And the response should contain the event ID
    And the response should contain the event type
    And the event should be published to RabbitMQ
