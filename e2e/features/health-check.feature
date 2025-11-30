Feature: Health Check
  As a system administrator
  I want to verify the webhook endpoint is running
  So that I can monitor the service health

  Scenario: Health check endpoint returns success
    Given the webhook service is running
    When I send a GET request to the health check endpoint
    Then the response status should be 200
    And the response should contain status "ok"
    And the response should contain message "Stripe webhook endpoint is ready"
    And the response should contain a valid timestamp
