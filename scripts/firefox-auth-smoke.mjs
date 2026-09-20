// No Google credentials or real backend required. The local HTTP fixture simulates
// a provider-denied callback; Firefox's identity API and built extension are real.
import { createServer } from 'node:http';
import { once } from 'node:events';
import { randomUUID, createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { Builder, By, until } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import { createInterface } from 'node:readline';

const ui = process.argv.includes('--ui');
const manifest = JSON.parse(await readFile('dist/firefox/manifest.json', 'utf8'));
assert.ok(
  manifest.host_permissions.includes('http://127.0.0.1:3210/*'),
  'Build for the local fixture first',
);
assert.ok(
  manifest.host_permissions.includes('http://127.0.0.1:3211/*'),
  'Build for the local fixture first',
);
const addonId = manifest.browser_specific_settings.gecko.id;
const expectedRedirect = `https://${createHash('sha1').update(addonId).digest('hex')}.extensions.allizom.org/auth`;
let mode = 'callback';
let callback;
let relayRequests = 0;
const servers = [];
let driver;
const modes = ['callback', 'missing-origins', 'old-backend', 'unconfigured'];
const handler = async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Convex-Client');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  const json = (body, status = 200) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (url.pathname === '/__fixture/mode') {
    if (!modes.includes(url.searchParams.get('value')))
      return json({ error: 'Unknown fixture mode' }, 400);
    mode = url.searchParams.get('value');
    return json({ mode });
  }
  if (url.pathname === '/api/query') {
    return json({
      status: 'success',
      value: {
        googleConfigured: mode !== 'unconfigured',
        firefoxLaunchSupported: mode !== 'old-backend',
      },
      logLines: [],
    });
  }
  if (url.pathname === '/api/auth/sign-in/social') {
    if (mode === 'missing-origins')
      return json({ code: 'INVALID_CALLBACK_URL', message: 'Invalid callbackURL' }, 403);
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    callback = body.callbackURL;
    assert.equal(new URL(callback).origin + new URL(callback).pathname, expectedRedirect);
    assert.equal(body.errorCallbackURL, callback);
    const authorization = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authorization.search = new URLSearchParams({
      client_id: 'fixture-only',
      redirect_uri: 'http://127.0.0.1:3211/api/auth/callback/google',
      response_type: 'code',
      state: 'fixture-server-state',
    }).toString();
    return json({ url: authorization.href });
  }
  if (url.pathname === '/extension/google-launch') {
    relayRequests++;
    assert.equal(url.searchParams.has('redirect_uri'), false);
    assert.equal(
      new URL(url.searchParams.get('authorization')).searchParams.get('redirect_uri'),
      'http://127.0.0.1:3211/api/auth/callback/google',
    );
    // Simulate the final provider failure, never issue a session or contact Google.
    const completed = new URL(callback);
    completed.searchParams.set('error', 'access_denied');
    res.writeHead(302, { Location: completed.href });
    res.end();
    return;
  }
  json({ error: 'Unknown fixture route' }, 404);
};
async function fx(fn) {
  return driver.executeAsyncScript(
    `const done=arguments[arguments.length-1];Promise.resolve((${fn.toString()})()).then(value=>done({value}),error=>done({error:String(error)}));`,
  );
}
try {
  for (const port of [3210, 3211]) {
    const server = createServer((req, res) =>
      handler(req, res).catch((error) => {
        console.error(error);
        res.writeHead(500);
        res.end('Fixture failed');
      }),
    );
    server.listen(port, '127.0.0.1');
    servers.push(server);
    await once(server, 'listening');
  }
  const uuid = randomUUID();
  const options = new firefox.Options().setPreference(
    'extensions.webextensions.uuids',
    JSON.stringify({ [addonId]: uuid }),
  );
  if (!ui) options.addArguments('-headless');
  if (process.env.FIREFOX_BINARY) options.setBinary(process.env.FIREFOX_BINARY);
  else if (process.platform === 'win32')
    options.setBinary('C:/Program Files/Mozilla Firefox/firefox.exe');
  else if (process.platform === 'darwin')
    options.setBinary('/Applications/Firefox.app/Contents/MacOS/firefox');
  driver = await new Builder()
    .forBrowser('firefox')
    .setFirefoxOptions(options)
    .setFirefoxService(new firefox.ServiceBuilder().addArguments('--allow-system-access'))
    .build();
  await driver.manage().setTimeouts({ script: 30000 });
  await driver.installAddon(resolve('dist/firefox'), true);
  await driver.setContext('chrome');
  await driver.executeScript(
    'window.gBrowser.selectedBrowser.loadURI(Services.io.newURI(arguments[0]), {triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal()});',
    `moz-extension://${uuid}/${manifest.action.default_popup}`,
  );
  await driver.setContext('content');
  await driver.wait(until.elementLocated(By.css('#browser-name')), 15000);
  const actual = await fx(() => browser.identity.getRedirectURL('auth'));
  assert.equal(actual.value, expectedRedirect);
  // Reproduce the old failure using the real Firefox implementation.
  const old = await fx(() =>
    browser.identity
      .launchWebAuthFlow({
        url: 'https://accounts.google.com/o/oauth2/v2/auth?redirect_uri=http%3A%2F%2F127.0.0.1%3A3211%2Fapi%2Fauth%2Fcallback%2Fgoogle',
        interactive: false,
      })
      .catch((e) => e.message),
  );
  assert.equal(old.value, 'redirect_uri not allowed');
  await fx(() => browser.storage.local.set({ crossmarkDebugEnabled: true }));
  console.log(
    `Firefox ready (${ui ? 'computer-use UI' : 'headless'}). Verified original rejection and generated callback: ${actual.value}`,
  );
  if (ui) {
    console.log(
      'Use the Firefox UI. Fixture modes: GET http://127.0.0.1:3211/__fixture/mode?value=callback|missing-origins|old-backend|unconfigured. Send finish on stdin to save diagnostics and close.',
    );
    const lines = createInterface({ input: process.stdin });
    for await (const line of lines) {
      if (line.trim() === 'finish') {
        lines.close();
        break;
      }
    }
  } else {
    for (const [fixture, message] of [
      ['callback', 'Google login was not completed. Try again.'],
      ['missing-origins', 'AUTH_TRUSTED_ORIGINS'],
      ['old-backend', 'Deploy the current Convex functions'],
      ['unconfigured', 'Google login is not configured on the backend.'],
    ]) {
      mode = fixture;
      await driver
        .findElement(By.xpath('//button[normalize-space(.)="Sign in with Google"]'))
        .click();
      await driver.wait(
        async () => (await driver.findElement(By.css('body')).getText()).includes(message),
        15000,
      );
    }
  }
  assert.ok(relayRequests > 0, 'The real identity API must reach the launch route');
  const diagnostics = await fx(async () =>
    (await browser.runtime.getBackgroundPage()).crossmarkDebug.export(),
  );
  assert.ok(!diagnostics.error, diagnostics.error);
  const debug = JSON.parse(diagnostics.value);
  assert.ok(debug.entries.some((e) => e.operation === 'auth.signIn' && e.outcome === 'failure'));
  assert.ok(!diagnostics.value.includes('fixture-server-state'));
  const saved = await fx(() => browser.storage.local.get('googleSession'));
  assert.equal(saved.value.googleSession, undefined);
  await mkdir('output/verification', { recursive: true });
  await writeFile(
    'output/verification/firefox-auth-results.json',
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        firefoxVersion: (await driver.getCapabilities()).get('browserVersion'),
        ui,
        redirect: actual.value,
        originalError: old.value,
        relayRequests,
        debug,
        liveGoogleLogin: 'Not tested; local fixture simulates provider denial',
      },
      null,
      2,
    ),
  );
  console.log(
    'Firefox auth smoke passed: original rejection, runtime callback, backend relay, configuration errors, debug events, no session after provider denial.',
  );
} finally {
  await driver?.quit();
  for (const server of servers) {
    server.closeAllConnections();
    server.close();
  }
}
