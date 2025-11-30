import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { expect } from 'vitest';
import { request, APIResponse } from 'playwright';

const feature = await loadFeature('./e2e/features/health-check.feature');

let response: APIResponse;
let responseData: {
  status?: string;
  message?: string;
  timestamp?: string;
};

describeFeature(feature, ({ Scenario }) => {
  Scenario('Health check endpoint returns success', ({ Given, When, Then, And }) => {
    Given('the webhook service is running', () => {
      // Service is assumed to be running at http://localhost:3000
      // This step is a no-op for API testing
    });

    When('I send a GET request to the health check endpoint', async () => {
      // Create a Playwright request context for API testing
      const requestContext = await request.newContext({
        baseURL: 'http://localhost:3000',
      });

      // Make a GET request using Playwright's API
      response = await requestContext.get('/api/webhooks/stripe');
      responseData = await response.json();

      // Clean up the request context
      await requestContext.dispose();
    });

    Then('the response status should be 200', () => {
      expect(response.status()).toBe(200);
    });

    And('the response should contain status "ok"', () => {
      expect(responseData.status).toBe('ok');
    });

    And('the response should contain message "Stripe webhook endpoint is ready"', () => {
      expect(responseData.message).toBe('Stripe webhook endpoint is ready');
    });

    And('the response should contain a valid timestamp', () => {
      expect(responseData.timestamp).toBeDefined();
      expect(typeof responseData.timestamp).toBe('string');

      // Verify it's a valid ISO 8601 timestamp
      const date = new Date(responseData.timestamp!);
      expect(date.toString()).not.toBe('Invalid Date');
      expect(responseData.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });
  });
});
