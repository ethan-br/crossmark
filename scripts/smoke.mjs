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
  const popup = await worker.evaluate(() => chrome.runtime.getManifest().action.default_popup);
  const page = await context.newPage();
  await worker.evaluate(() =>
    chrome.bookmarks.create({
      parentId: '1',
      title: 'Native bookmark',
      url: 'https://example.com/native',
    }),
  );
  await page.goto(`chrome-extension://${id}/${popup}`);
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  assert.match(await page.locator('.cm-source-note').innerText(), /signing in replaces these/);
  const command = (message) =>
    page.evaluate((message) => chrome.runtime.sendMessage(message), message);
  const { data: state } = await command({ type: 'state' });
  assert.equal(state.connected, false);
  assert.ok(state.baseline.some((n) => n.title === 'Native bookmark'));
  assert.ok(!('token' in state));
  assert.equal(await page.locator('input').count(), 3);
  await page.getByLabel('Email').fill('smoke@example.com');
  await page.getByLabel('Password').fill('not-a-real-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  // Without a backend the request fails; with one, the unknown account is rejected.
  await expect(page.getByRole('alert')).toBeVisible();
  assert.equal((await command({ type: 'state' })).data.connected, false);
  assert.equal(
    (await worker.evaluate(() => chrome.bookmarks.search({ title: 'Native bookmark' }))).length,
    1,
  );
  const { data: exported } = await command({ type: 'export' });
  assert.ok(exported.nodes.some((n) => n.title === 'Native bookmark'));
  assert.ok(!('account' in exported) && !('token' in exported));
  await page.reload();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  await page.locator('#root').screenshot({ path: 'output/verification/chromium-login.png' });
  const auth = await worker.evaluate(() => ({
    origin: chrome.runtime.getURL('').replace(/\/$/, ''),
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
          'Email/password sign-in UI',
          'Failed sign-in reported',
          'No bookmark changes without login',
          'Credential-free export',
          'Popup reload',
        ],
        liveLogin: 'Not tested: requires a running backend and account',
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
