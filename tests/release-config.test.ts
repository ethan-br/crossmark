import { spawnSync } from 'node:child_process';
import { mkdtempSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
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

it('validates CLI invocations directly and through a symlink where supported', () => {
  const dir = mkdtempSync(join(tmpdir(), 'crossmark-release-'));
  try {
    const script = resolve('scripts/validate-release-config.mjs');
    const link = join(dir, 'release guard.mjs');
    const entries = [script];
    // Windows symlinks require Developer Mode or elevated privileges.
    if (process.platform !== 'win32') {
      symlinkSync(script, link, 'file');
      entries.push(link);
    }
    for (const entry of entries) {
      const invalid = spawnSync(process.execPath, [entry], {
        env: {
          ...process.env,
          VITE_CONVEX_URL: 'http://127.0.0.1:3210',
          VITE_CONVEX_SITE_URL: 'http://127.0.0.1:3211',
        },
        encoding: 'utf8',
      });
      expect(invalid.status).toBe(1);
      expect(invalid.stderr).toContain('Release URLs must name');
      const valid = spawnSync(process.execPath, [entry], {
        env: {
          ...process.env,
          VITE_CONVEX_URL: 'https://example-123.convex.cloud',
          VITE_CONVEX_SITE_URL: 'https://example-123.convex.site',
        },
      });
      expect(valid.status).toBe(0);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
