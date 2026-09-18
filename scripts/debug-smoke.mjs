import { chromium, expect } from '@playwright/test';
import { resolve } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';

// No backend or account needed; exercise the packaged background entry point.
const profile = await mkdtemp(`${tmpdir()}/crossmark-debug-`);
let context;
try {
  const path = resolve('dist/chromium');
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${path}`, `--load-extension=${path}`],
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const page = await context.newPage();
  await page.goto(`chrome-extension://${new URL(worker.url()).host}/index.html`);
  const command = (message) => page.evaluate((m) => chrome.runtime.sendMessage(m), message);
  await command({ type: 'state' });
  const snapshot = () => worker.evaluate(() => JSON.parse(crossmarkDebug.export()));
  assert.equal((await snapshot()).enabled, false);
  assert.deepEqual((await snapshot()).entries, []);
  await worker.evaluate(() => crossmarkDebug.setEnabled(true));
  await worker.evaluate(() =>
    chrome.bookmarks.create({
      parentId: '1',
      title: 'Private smoke title',
      url: 'https://private.example/smoke',
    }),
  );
  await command({ type: 'state' });
  const logged = await snapshot();
  assert.ok(
    logged.entries.some((e) => e.operation === 'bookmarks.read' && e.outcome === 'success'),
  );
  assert.ok(!JSON.stringify(logged).includes('Private smoke title'));
  assert.ok(!JSON.stringify(logged).includes('private.example'));
  // Exercise the documented storage setting independently of the helper.
  await page.evaluate(() => chrome.storage.local.set({ crossmarkDebugEnabled: false }));
  await expect.poll(async () => (await snapshot()).enabled).toBe(false);
  await worker.evaluate(() => crossmarkDebug.clear());
  await command({ type: 'state' });
  assert.deepEqual((await snapshot()).entries, []);
  assert.equal(
    await worker.evaluate(
      async () => (await chrome.storage.local.get('crossmarkDebugEnabled')).crossmarkDebugEnabled,
    ),
    false,
  );
  console.log(
    'Chromium debug smoke passed: default off, opt-in, bookmark logs, privacy, live storage toggle, export and clear.',
  );
} finally {
  await context?.close();
  await rm(profile, { recursive: true, force: true });
}
