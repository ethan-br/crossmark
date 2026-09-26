import { Builder, By, until } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const manifest = JSON.parse(await readFile('dist/firefox/manifest.json', 'utf8'));
const uuid = randomUUID();
const options = new firefox.Options()
  .addArguments('-headless')
  .setPreference(
    'extensions.webextensions.uuids',
    JSON.stringify({ [manifest.browser_specific_settings.gecko.id]: uuid }),
  );
if (process.env.FIREFOX_BINARY) options.setBinary(process.env.FIREFOX_BINARY);
else if (process.platform === 'darwin')
  options.setBinary('/Applications/Firefox.app/Contents/MacOS/firefox');
const driver = await new Builder()
  .forBrowser('firefox')
  .setFirefoxOptions(options)
  .setFirefoxService(new firefox.ServiceBuilder().addArguments('--allow-system-access'))
  .build();
async function fx(fn, arg = null) {
  const result = await driver.executeAsyncScript(
    `const done=arguments[arguments.length-1];Promise.resolve((${fn.toString()})(arguments[0])).then(value=>done({value}),error=>done({error:String(error)}));`,
    arg,
  );
  if (result.error) throw new Error(result.error);
  return result.value;
}
const command = (message) => fx((message) => browser.runtime.sendMessage(message), message);
try {
  await mkdir('output/verification', { recursive: true });
  await driver.manage().setTimeouts({ script: 30000 });
  await driver.installAddon(resolve('dist/firefox'), true);
  await driver.setContext('chrome');
  await driver.executeScript(
    'window.gBrowser.selectedBrowser.loadURI(Services.io.newURI(arguments[0]), {triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal()});',
    `moz-extension://${uuid}/${manifest.action.default_popup}`,
  );
  await driver.setContext('content');
  await driver.wait(until.elementLocated(By.css('#browser-name')), 15000);
  await fx(() =>
    browser.bookmarks.create({
      parentId: 'menu________',
      title: 'Native menu bookmark',
      url: 'https://example.com/menu',
    }),
  );
  await fx(() => browser.bookmarks.create({ parentId: 'toolbar_____', type: 'separator' }));
  const { data: state } = await command({ type: 'state' });
  assert.equal(state.connected, false);
  assert.ok(
    state.baseline.some((n) => n.title === 'Native menu bookmark' && n.parentId === 'menu'),
  );
  assert.ok(state.baseline.some((n) => n.kind === 'separator'));
  assert.equal((await driver.findElements(By.css('input'))).length, 1);
  await driver.findElement(By.xpath('//button[normalize-space(.)="Sign in with Google"]')).click();
  await driver.wait(
    async () =>
      /Google login is not configured on the backend|Failed to fetch|NetworkError/.test(
        await driver.findElement(By.css('body')).getText(),
      ),
    15000,
  );
  assert.equal((await command({ type: 'state' })).data.connected, false);
  assert.equal(
    (await fx(() => browser.bookmarks.search({ title: 'Native menu bookmark' }))).length,
    1,
  );
  const { data: exported } = await command({ type: 'export' });
  assert.ok(exported.nodes.some((n) => n.kind === 'separator'));
  assert.ok(!('account' in exported) && !('token' in exported));
  await driver.navigate().refresh();
  await driver.wait(until.elementLocated(By.css('#browser-name')), 15000);
  await writeFile(
    'output/verification/firefox-google-login.png',
    await driver.findElement(By.css('.cm-window')).takeScreenshot(),
    'base64',
  );
  const auth = await fx(() => ({
    origin: browser.runtime.getURL('').replace(/\/$/, ''),
    redirect: browser.identity.getRedirectURL('auth'),
  }));
  const firefoxVersion = (await driver.getCapabilities()).get('browserVersion');
  await writeFile(
    'output/verification/firefox-results.json',
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        firefoxVersion,
        auth,
        checks: [
          'Built extension startup',
          'Native menu and separator read',
          'Google-only sign-in UI',
          'Unavailable or unconfigured backend reported',
          'No bookmark changes without login',
          'Credential-free export',
          'Popup reload',
        ],
        liveGoogleLogin: 'Not tested: backend unavailable or Google OAuth client not configured',
      },
      null,
      2,
    ),
  );
  console.log(`Firefox ${firefoxVersion}: 7 extension checks passed.`, auth);
} finally {
  await driver.quit();
}
