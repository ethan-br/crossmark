import { spawn } from 'node:child_process';
import { copyFile, readdir, rm } from 'node:fs/promises';

const issuer = process.env.AMO_JWT_ISSUER?.trim();
const secret = process.env.AMO_JWT_SECRET?.trim();

if (!issuer || !secret) {
  console.error(
    'Set AMO_JWT_ISSUER and AMO_JWT_SECRET before signing. Create them at https://addons.mozilla.org/developers/addon/api/key/.',
  );
  process.exitCode = 1;
} else {
  // Remove previous outputs so a successful command cannot reuse a stale signature.
  await rm('dist/signed', { recursive: true, force: true });
  await rm('dist/crossmark-firefox-signed.xpi', { force: true });
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
  child.on('error', (error) => {
    console.error(`Unable to start web-ext: ${error.message}`);
    process.exitCode = 1;
  });
  child.on('close', async (code, signal) => {
    if (signal) {
      console.error(`web-ext was terminated by ${signal}.`);
      process.exitCode = 1;
    } else {
      process.exitCode = code ?? 1;
      if (code === 0) {
        try {
          const artifacts = (await readdir('dist/signed')).filter((name) => name.endsWith('.xpi'));
          if (artifacts.length !== 1) {
            throw new Error(`Expected one signed XPI, found ${artifacts.length}.`);
          }
          await copyFile(`dist/signed/${artifacts[0]}`, 'dist/crossmark-firefox-signed.xpi');
          console.log('Signed package copied to dist/crossmark-firefox-signed.xpi.');
        } catch (error) {
          console.error(error.message);
          process.exitCode = 1;
        }
      }
    }
  });
}
