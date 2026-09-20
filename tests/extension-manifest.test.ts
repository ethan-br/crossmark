import { describe, expect, it } from 'vitest';
import { extensionManifest } from '../apps/extension/manifest';

describe('extension backend configuration', () => {
  it('uses the existing loopback defaults when endpoints are absent', () => {
    expect(extensionManifest('chrome', {}).host_permissions).toEqual([
      'http://127.0.0.1:3210/*',
      'http://127.0.0.1:3211/*',
    ]);
  });

  it.each(['chrome', 'firefox'])(
    'limits %s network access to the configured origins',
    (browser) => {
      const manifest = extensionManifest(browser, {
        VITE_CONVEX_URL: 'https://example.convex.cloud',
        VITE_CONVEX_SITE_URL: 'https://example.convex.site',
      });
      expect(manifest.host_permissions).toEqual([
        'https://example.convex.cloud/*',
        'https://example.convex.site/*',
      ]);
      expect(manifest.content_security_policy).toEqual({
        extension_pages:
          "script-src 'self'; object-src 'self'; connect-src 'self' https://example.convex.cloud https://example.convex.site",
      });
    },
  );

  it('deduplicates permissions when both services share an origin', () => {
    expect(
      extensionManifest('chrome', {
        VITE_CONVEX_URL: 'https://example.com',
        VITE_CONVEX_SITE_URL: 'https://example.com',
      }).host_permissions,
    ).toEqual(['https://example.com/*']);
  });

  it('allows localhost HTTP for local development', () => {
    expect(
      extensionManifest('firefox', {
        VITE_CONVEX_URL: 'http://localhost:3210',
        VITE_CONVEX_SITE_URL: 'http://localhost:3211',
      }).host_permissions,
    ).toEqual(['http://localhost:3210/*', 'http://localhost:3211/*']);
  });

  it.each([
    'http://example.com',
    'http://127.0.0.1.example.com',
    'https://example.com/',
    'https://example.com/api',
    'https://example.com?query=1',
    'https://example.com#fragment',
    'https://user:password@example.com',
    'file:///tmp/backend',
    'not-a-url',
  ])('rejects unsafe or non-origin endpoints: %s', (endpoint) => {
    for (const name of ['VITE_CONVEX_URL', 'VITE_CONVEX_SITE_URL']) {
      expect(() => extensionManifest('chrome', { [name]: endpoint })).toThrow();
    }
  });
});
