import { chromium, expect } from '@playwright/test';
import { resolve } from 'node:path';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
const profile = await mkdtemp(`${tmpdir()}/crossmark-chromium-`);
const path = resolve('dist/chromium');
const context = await chromium.launchPersistentContext(profile, {
  channel: 'chromium',
  headless: true,
  args: [`--disable-extensions-except=${path}`, `--load-extension=${path}`],
});
try {
  await mkdir('output/verification', { recursive: true });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const id = new URL(worker.url()).host;
  const page = await context.newPage();
  await worker.evaluate(() =>
    chrome.bookmarks.create({
      parentId: '1',
      title: 'Native bookmark',
      url: 'https://example.com/native',
    }),
  );
  await page.goto(`chrome-extension://${id}/index.html`);
  await expect(
    page.getByRole('button', { name: 'Sign in with Google', exact: true }),
  ).toBeVisible();
  const command = (message) =>
    page.evaluate((message) => chrome.runtime.sendMessage(message), message);
  const { data: state } = await command({ type: 'state' });
  assert.equal(state.connected, false);
  assert.ok(state.baseline.some((n) => n.title === 'Native bookmark'));
  assert.ok(!('token' in state));
  assert.equal(await page.locator('input').count(), 1);
  await page.getByRole('button', { name: 'Sign in with Google', exact: true }).click();
  await expect(
    page.getByText('Google login is not configured on the backend.', { exact: false }),
  ).toBeVisible();
  assert.equal((await command({ type: 'state' })).data.connected, false);
  assert.equal(
    (await worker.evaluate(() => chrome.bookmarks.search({ title: 'Native bookmark' }))).length,
    1,
  );
  const { data: exported } = await command({ type: 'export' });
  assert.ok(exported.nodes.some((n) => n.title === 'Native bookmark'));
  assert.ok(!('account' in exported) && !('token' in exported));
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Sign in with Google', exact: true }),
  ).toBeVisible();
  await page
    .locator('.cm-window')
    .screenshot({ path: 'output/verification/chromium-google-login.png' });
  const auth = await worker.evaluate(() => ({
    origin: chrome.runtime.getURL('').replace(/\/$/, ''),
    redirect: chrome.identity.getRedirectURL('auth'),
  }));
  await writeFile(
    'output/verification/chromium-results.json',
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        auth,
        checks: [
          'Built extension startup',
          'Native bookmark read',
          'Google-only sign-in UI',
          'Missing OAuth configuration reported',
          'No bookmark changes without login',
          'Credential-free export',
          'Popup reload',
        ],
        liveGoogleLogin: 'Not tested: Google OAuth client not configured',
      },
      null,
      2,
    ),
  );
  console.log('Chromium: 7 extension checks passed.', auth);
} finally {
  await context.close();
  await rm(profile, { recursive: true, force: true });
}
