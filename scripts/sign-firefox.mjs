import { spawn } from 'node:child_process';
import { copyFile, readdir, stat } from 'node:fs/promises';

const issuer = process.env.AMO_JWT_ISSUER?.trim();
const secret = process.env.AMO_JWT_SECRET?.trim();

if (!issuer || !secret) {
  console.error(
    'Set AMO_JWT_ISSUER and AMO_JWT_SECRET before signing. Create them at https://addons.mozilla.org/developers/addon/api/key/.',
  );
  process.exitCode = 1;
} else {
  const command = process.platform === 'win32' ? 'web-ext.cmd' : 'web-ext';
  const child = spawn(
    command,
    [
      'sign',
      '--channel=unlisted',
      '--source-dir=dist/firefox',
      '--artifacts-dir=dist/signed',
      '--api-key',
      issuer,
      '--api-secret',
      secret,
    ],
    { stdio: 'inherit', shell: false },
  );
  child.on('exit', async (code, signal) => {
    if (signal) {
      console.error(`web-ext was terminated by ${signal}.`);
      process.exitCode = 1;
    } else {
      process.exitCode = code ?? 1;
      if (code === 0) {
        const artifacts = await Promise.all(
          (await readdir('dist/signed'))
            .filter((name) => name.endsWith('.xpi'))
            .map(async (name) => ({
              name,
              modified: (await stat(`dist/signed/${name}`)).mtimeMs,
            })),
        );
        const newest = artifacts.sort((a, b) => b.modified - a.modified)[0];
        if (newest) {
          await copyFile(`dist/signed/${newest.name}`, 'dist/crossmark-firefox-signed.xpi');
          console.log('Signed package copied to dist/crossmark-firefox-signed.xpi.');
        }
      }
    }
  });
}
