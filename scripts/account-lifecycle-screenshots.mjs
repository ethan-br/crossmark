import { chromium, expect } from '@playwright/test';
import { resolve } from 'node:path';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';

// Capture the actual packaged popup with fixture account state. Runtime commands
// are stubbed in the page: no backend, email, credentials or deletion is used.
// Run after npm run build:chromium.
const output = 'docs/screenshots/account-lifecycle';
const profile = await mkdtemp(`${tmpdir()}/crossmark-lifecycle-`);
const extension = resolve('dist/chromium');
let context;
try {
  await mkdir(output, { recursive: true });
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    viewport: { width: 340, height: 640 },
    reducedMotion: 'reduce',
    colorScheme: 'light',
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const popup = await worker.evaluate(() => chrome.runtime.getManifest().action.default_popup);
  const page = await context.newPage();
  await page.addInitScript(() => {
    window.fixtureConnected = false;
    chrome.runtime.sendMessage = (message, callback) => {
      if (!['state', 'requestReset', 'resetPassword'].includes(message.type))
        throw new Error(`Screenshot fixture does not support ${message.type}`);
      const state = {
        version: 2,
        installationId: 'screenshot-installation',
        name: 'This browser',
        browser: 'Chromium',
        connected: window.fixtureConnected,
        paused: false,
        status: window.fixtureConnected ? 'ready' : 'setup',
        baseline: [],
        mappings: {},
        roots: {},
        outbox: [],
        sequence: 0,
        cursor: 0,
        joining: false,
        initialized: false,
        safetyApproved: false,
        failures: 0,
        ...(window.fixtureConnected
          ? { account: { id: 'screenshot-account', email: 'reader@example.com', name: 'Reader' } }
          : {}),
      };
      const response = { data: state };
      if (callback) {
        callback(response);
        return;
      }
      return Promise.resolve(response);
    };
  });
  await page.goto(`chrome-extension://${new URL(worker.url()).host}/${popup}`);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  const capture = (name) =>
    page.screenshot({ path: `${output}/${name}.png`, animations: 'disabled' });
  await expect(page.getByRole('button', { name: 'Forgot password?' })).toBeVisible();
  await capture('sign-in');
  await page.getByRole('button', { name: 'Forgot password?' }).click();
  await page.getByLabel('Email', { exact: true }).fill('reader@example.com');
  await capture('request-reset');
  await page.getByRole('button', { name: 'Email reset code' }).click();
  await expect(page.getByLabel('Reset code')).toBeVisible();
  await capture('reset-password');
  await page.getByRole('button', { name: 'Return to sign in' }).click();
  // Trigger the app's normal storage listener to request our connected fixture.
  await page.evaluate(async () => {
    window.fixtureConnected = true;
    await chrome.storage.local.set({ screenshotFixture: true });
  });
  await page.setViewportSize({ width: 340, height: 900 });
  await page.getByRole('tab', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Delete account', exact: true })).toBeVisible();
  await capture('account-settings');
  await page.setViewportSize({ width: 340, height: 640 });
  await page.getByLabel('Current password').fill('fixture-only-password');
  await page.getByRole('button', { name: 'Delete account', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
  const bounds = await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Delete account', exact: true })
    .boundingBox();
  if (!bounds || bounds.x + bounds.width > 340)
    throw new Error('Deletion confirmation button overflows popup');
  await capture('delete-confirmation');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  console.log(`Saved five popup screenshots to ${output}; no backend requests made.`);
} finally {
  await context?.close();
  await rm(profile, { recursive: true, force: true });
}
