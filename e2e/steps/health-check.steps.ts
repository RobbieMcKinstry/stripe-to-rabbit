import { Given, When, Then } from 'quickpickle';
import { expect } from 'vitest';

let response: Response;
let responseData: {
  status?: string;
  message?: string;
  timestamp?: string;
};

Given('the webhook service is running', async function () {
  // Service is assumed to be running
  // In a real scenario, we might navigate to the page to verify
  // For now, this is a no-op as the health check is API-only
});

When('I send a GET request to the health check endpoint', async function () {
  // Make a direct HTTP request to the health check endpoint
  response = await fetch('http://localhost:3000/api/webhooks/stripe');
  responseData = await response.json();
});

Then('the response status should be {int}', async function (expectedStatus) {
  expect(response.status).toBe(expectedStatus);
});

Then('the response should contain status {string}', async function (expectedStatus) {
  expect(responseData.status).toBe(expectedStatus);
});

Then('the response should contain message {string}', async function (expectedMessage) {
  expect(responseData.message).toBe(expectedMessage);
});

Then('the response should contain a valid timestamp', async function () {
  expect(responseData.timestamp).toBeDefined();
  expect(typeof responseData.timestamp).toBe('string');

  // Verify it's a valid ISO 8601 timestamp
  const date = new Date(responseData.timestamp!);
  expect(date.toString()).not.toBe('Invalid Date');
  expect(responseData.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
});
