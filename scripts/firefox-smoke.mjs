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
  await driver.wait(
    until.elementLocated(By.xpath('//button[normalize-space(.)="Create account"]')),
    15000,
  );
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
  await driver.findElement(By.xpath('//button[normalize-space(.)="Sign in"]')).click();
  await driver.wait(until.elementLocated(By.css('#email')), 15000);
  assert.equal((await driver.findElements(By.css('input'))).length, 2);
  await driver.findElement(By.css('#email')).sendKeys('smoke@example.com');
  await driver.findElement(By.css('#password')).sendKeys('not-a-real-password');
  await driver.findElement(By.xpath('//button[normalize-space(.)="Sign in"]')).click();
  // Without a backend the request fails; with one, the unknown account is rejected.
  await driver.wait(until.elementLocated(By.css('[role="alert"]')), 15000);
  assert.equal((await command({ type: 'state' })).data.connected, false);
  assert.equal(
    (await fx(() => browser.bookmarks.search({ title: 'Native menu bookmark' }))).length,
    1,
  );
  const { data: exported } = await command({ type: 'export' });
  assert.ok(exported.nodes.some((n) => n.kind === 'separator'));
  assert.ok(!('account' in exported) && !('token' in exported));
  await driver.navigate().refresh();
  await driver.wait(
    until.elementLocated(By.xpath('//button[normalize-space(.)="Create account"]')),
    15000,
  );
  await writeFile(
    'output/verification/firefox-login.png',
    await driver.findElement(By.css('#root')).takeScreenshot(),
    'base64',
  );
  const auth = await fx(() => ({
    origin: browser.runtime.getURL('').replace(/\/$/, ''),
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
          'Welcome and email/password sign-in UI',
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
  console.log(`Firefox ${firefoxVersion}: 7 extension checks passed.`, auth);
} finally {
  await driver.quit();
}
