import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { rm } from 'node:fs/promises';

const run = promisify(execFile);
const archive = 'dist/crossmark-firefox.xpi';

await rm(archive, { force: true });
await run('zip', ['-qr', '../crossmark-firefox.xpi', '.'], { cwd: 'dist/firefox' });
console.log(`Created ${archive} with manifest.json at the archive root.`);
