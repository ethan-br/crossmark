import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

export default defineConfig({
  plugins: [WxtVitest()],
  test: {
    setupFiles: ['./tests/setup/wxt.ts'],
    // Keep Convex/backend modules on Node resolution; WXT's SSR bundling is for extension code.
    server: {
      deps: {
        inline: ['webextension-polyfill'],
      },
    },
  },
});
