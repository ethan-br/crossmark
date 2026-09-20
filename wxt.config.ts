import { basename, join } from 'node:path';
import { defineConfig } from 'wxt';
import { extensionManifest } from './apps/extension/manifest';

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
  hooks: {
    'config:resolved': ({ config }) => {
      // Keep the existing installation/signing paths, including separate dev builds.
      if (config.browser === 'chrome') {
        config.outDir = join(
          config.outBaseDir,
          basename(config.outDir).replace('chrome', 'chromium'),
        );
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
    // The existing command produces an unsigned installable XPI, not a store submission.
    zipSources: false,
  },
});
