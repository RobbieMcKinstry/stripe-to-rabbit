import { expect } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

const { Given, When, Then } = createBdd();

let response: Response;
let responseData: {
  status?: string;
  message?: string;
  timestamp?: string;
};

Given('the webhook service is running', async ({ page }) => {
  // Service is assumed to be running via webServer config
  // This step just validates we can access the page
  await page.goto('/');
});

When('I send a GET request to the health check endpoint', async ({ request }) => {
  response = await request.get('/api/webhooks/stripe');
  responseData = await response.json();
});

Then('the response status should be {int}', async ({}, expectedStatus: number) => {
  expect(response.status()).toBe(expectedStatus);
});

Then('the response should contain status {string}', async ({}, expectedStatus: string) => {
  expect(responseData.status).toBe(expectedStatus);
});

Then('the response should contain message {string}', async ({}, expectedMessage: string) => {
  expect(responseData.message).toBe(expectedMessage);
});

Then('the response should contain a valid timestamp', async () => {
  expect(responseData.timestamp).toBeDefined();
  expect(typeof responseData.timestamp).toBe('string');

  // Verify it's a valid ISO 8601 timestamp
  const date = new Date(responseData.timestamp!);
  expect(date.toString()).not.toBe('Invalid Date');
  expect(responseData.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
});
