import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
  copyFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { it, expect } from 'vitest';

it('rejects missing signing output instead of publishing a stale XPI', () => {
  if (process.platform === 'win32') return;
  const dir = mkdtempSync(join(tmpdir(), 'crossmark-sign-'));
  try {
    mkdirSync(join(dir, 'dist/signed'), { recursive: true });
    mkdirSync(join(dir, 'bin'));
    copyFileSync(resolve('scripts/sign-firefox.mjs'), join(dir, 'sign.mjs'));
    writeFileSync(join(dir, 'dist/signed/stale.xpi'), 'stale');
    writeFileSync(join(dir, 'dist/crossmark-firefox-signed.xpi'), 'stale');
    writeFileSync(join(dir, 'bin/web-ext'), '#!/bin/sh\nmkdir -p dist/signed\nexit 0\n', {
      mode: 0o755,
    });
    const env = {
      ...process.env,
      PATH: `${dir}/bin:${process.env.PATH}`,
      AMO_JWT_ISSUER: 'test',
      AMO_JWT_SECRET: 'test',
    };
    expect(() =>
      execFileSync(process.execPath, ['sign.mjs'], { cwd: dir, env, stdio: 'pipe' }),
    ).toThrow();
    expect(existsSync(join(dir, 'dist/crossmark-firefox-signed.xpi'))).toBe(false);
    writeFileSync(
      join(dir, 'bin/web-ext'),
      '#!/bin/sh\nmkdir -p dist/signed\nprintf fresh > dist/signed/new.xpi\n',
      { mode: 0o755 },
    );
    execFileSync(process.execPath, ['sign.mjs'], { cwd: dir, env, stdio: 'pipe' });
    expect(readFileSync(join(dir, 'dist/crossmark-firefox-signed.xpi'), 'utf8')).toBe('fresh');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
