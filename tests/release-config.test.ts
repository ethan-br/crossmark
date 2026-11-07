import { describe, expect, it } from 'vitest';
// @ts-expect-error Node release helper intentionally runs without a TypeScript loader.
import { validateReleaseConfig } from '../scripts/validate-release-config.mjs';

describe('release backend configuration', () => {
  it('accepts matching HTTPS deployment origins', () => {
    expect(() =>
      validateReleaseConfig({
        VITE_CONVEX_URL: 'https://example-123.convex.cloud',
        VITE_CONVEX_SITE_URL: 'https://example-123.convex.site',
      }),
    ).not.toThrow();
  });
  it.each([
    {},
    { VITE_CONVEX_URL: 'http://127.0.0.1:3210', VITE_CONVEX_SITE_URL: 'http://127.0.0.1:3211' },
    {
      VITE_CONVEX_URL: 'https://example-123.convex.cloud',
      VITE_CONVEX_SITE_URL: 'https://other.convex.site',
    },
    {
      VITE_CONVEX_URL: 'https://example-123.convex.cloud/',
      VITE_CONVEX_SITE_URL: 'https://example-123.convex.site',
    },
  ])('rejects missing, local or mismatched origins: %j', (env) => {
    expect(() => validateReleaseConfig(env)).toThrow();
  });
});
