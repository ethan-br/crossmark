import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import { defineConfig } from 'wxt';
import { extensionManifest } from './apps/extension/manifest';

function existingPath(...candidates: Array<string | undefined>): string | undefined {
  return candidates.find((candidate) => candidate !== undefined && existsSync(candidate));
}

function browserBinaries(): Record<string, string> {
  // Env values win even when they are web-ext binary names rather than paths.
  const chrome =
    process.env.CHROME_BINARY ||
    process.env.CHROMIUM_BINARY ||
    existingPath(
      process.platform === 'darwin'
        ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
        : undefined,
      process.platform === 'darwin'
        ? '/Applications/Chromium.app/Contents/MacOS/Chromium'
        : undefined,
      process.platform === 'darwin' ? '/Applications/Helium.app/Contents/MacOS/Helium' : undefined,
      process.platform === 'linux' ? '/usr/bin/google-chrome-stable' : undefined,
      process.platform === 'linux' ? '/usr/bin/google-chrome' : undefined,
      process.platform === 'linux' ? '/usr/bin/chromium-browser' : undefined,
      process.platform === 'linux' ? '/usr/bin/chromium' : undefined,
      process.platform === 'win32'
        ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
        : undefined,
    );
  const firefox =
    process.env.FIREFOX_BINARY ||
    existingPath(
      process.platform === 'darwin'
        ? '/Applications/Firefox.app/Contents/MacOS/firefox'
        : undefined,
      process.platform === 'linux' ? '/usr/bin/firefox' : undefined,
      process.platform === 'linux' ? '/usr/bin/firefox-esr' : undefined,
      process.platform === 'win32' ? 'C:\\Program Files\\Mozilla Firefox\\firefox.exe' : undefined,
    );
  return {
    ...(chrome ? { chrome } : {}),
    ...(firefox ? { firefox } : {}),
  };
}

export default defineConfig({
  srcDir: 'apps/extension',
  publicDir: 'apps/extension/public',
  outDir: 'dist',
  outDirTemplate: '{{browser}}{{modeSuffix}}',
  manifestVersion: 3,
  targetBrowsers: ['chrome', 'firefox'],
  modules: ['@wxt-dev/module-react'],
  imports: false,
  // WXT loads mode/browser dotenv files before invoking this function.
  manifest: ({ browser }) =>
    extensionManifest(browser, {
      VITE_CONVEX_URL: process.env.VITE_CONVEX_URL,
      VITE_CONVEX_SITE_URL: process.env.VITE_CONVEX_SITE_URL,
    }),
  vite: ({ browser }) => ({
    build: { target: browser === 'firefox' ? 'firefox128' : 'chrome120' },
  }),
  webExt: {
    binaries: browserBinaries(),
    // Chrome 137+ dropped --load-extension unless this feature flag is disabled.
    chromiumArgs: ['--disable-features=DisableLoadExtensionCommandLineSwitch'],
    disabled: process.env.WXT_OPEN_BROWSER === '0',
  },
  hooks: {
    'config:resolved': ({ config }) => {
      // Keep the existing installation/signing paths, including separate dev builds.
      if (config.browser === 'chrome') {
        config.outDir = join(
          config.outBaseDir,
          basename(config.outDir).replace(/^chrome/, 'chromium'),
        );
        config.zip.artifactTemplate = 'crossmark-chromium.zip';
      } else if (config.browser === 'firefox') {
        config.zip.artifactTemplate = 'crossmark-firefox.xpi';
      }
    },
    'build:manifestGenerated': (wxt, manifest) => {
      if (wxt.config.command !== 'serve' || !wxt.server) return;
      const policy = manifest.content_security_policy;
      if (typeof policy !== 'object' || !policy.extension_pages) return;
      // WXT adds script-src for development, but our explicit connect-src also
      // needs the dev server and its WebSocket for popup HMR/background reloads.
      const server = new URL(wxt.server.origin);
      const socket = new URL(server);
      socket.protocol = server.protocol === 'https:' ? 'wss:' : 'ws:';
      policy.extension_pages = policy.extension_pages.replace(
        'connect-src',
        `connect-src ${server.origin} ${socket.origin}`,
      );
    },
  },
  zip: {
    artifactTemplate: 'crossmark-{{browser}}.zip',
    // Local package commands produce unsigned installable archives, not store source-review bundles.
    zipSources: false,
    exclude: ['**/*.map'],
  },
});
