import { build as viteBuild, loadEnv } from 'vite';
import { build } from 'esbuild';
import { mkdir, cp, writeFile, rm } from 'node:fs/promises';
import sharp from 'sharp';
import { readFile } from 'node:fs/promises';
const chromiumKey = JSON.parse(
  await readFile(new URL('./chromium-key.json', import.meta.url), 'utf8'),
).key;
const packageJson = JSON.parse(
  await readFile(new URL('../package.json', import.meta.url), 'utf8'),
);
const env = loadEnv('production', process.cwd(), '');
const url = env.VITE_CONVEX_URL || 'http://127.0.0.1:3210';
const origin = new URL(url).origin;
const siteURL = env.VITE_CONVEX_SITE_URL || 'http://127.0.0.1:3211';
const siteOrigin = new URL(siteURL).origin;
for (const endpoint of [url, siteURL]) {
  const parsed = new URL(endpoint);
  if (
    parsed.origin !== endpoint ||
    (parsed.protocol !== 'https:' &&
      !(parsed.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(parsed.hostname)))
  )
    throw new Error('Use HTTPS backend origins, or loopback HTTP for development.');
}
await viteBuild({ build: { target: 'esnext', outDir: 'dist/popup' } });
for (const browser of ['chromium', 'firefox']) {
  const dir = `dist/${browser}`;
  await rm(dir, { recursive: true, force: true });
  await mkdir(`${dir}/icons`, { recursive: true });
  await cp('dist/popup', dir, { recursive: true });
  await build({
    entryPoints: ['apps/extension/src/background.ts'],
    bundle: true,
    outfile: `${dir}/background.js`,
    format: 'iife',
    target: browser === 'firefox' ? 'firefox128' : 'chrome120',
    define: {
      'import.meta.env.VITE_CONVEX_URL': JSON.stringify(url),
      'import.meta.env.VITE_CONVEX_SITE_URL': JSON.stringify(siteURL),
    },
    minify: true,
  });
  const icons = {};
  for (const size of [16, 32, 48, 128]) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#247653"/><path d="M10 7h12v19l-6-4-6 4V7Z" stroke="#fff" fill="none" stroke-width="1.8" stroke-linejoin="round"/><path d="m13 13 2 2 4-4" stroke="#fff" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    await sharp(Buffer.from(svg)).png().toFile(`${dir}/icons/${size}.png`);
    icons[size] = `icons/${size}.png`;
  }
  const manifest = {
    manifest_version: 3,
    name: 'Crossmark',
    version: packageJson.version,
    description: 'Synchronize native bookmarks across desktop browsers.',
    permissions: ['bookmarks', 'storage', 'alarms', 'identity'],
    host_permissions: [...new Set([`${origin}/*`, `${siteOrigin}/*`])],
    icons,
    action: { default_popup: 'index.html', default_title: 'Crossmark', default_icon: icons },
    content_security_policy: {
      extension_pages: `script-src 'self'; object-src 'self'; connect-src 'self' ${origin} ${siteOrigin}`,
    },
    ...(browser === 'firefox'
      ? {
          background: { scripts: ['background.js'] },
          browser_specific_settings: {
            gecko: {
              id: 'braunstein.ethan@gmail.com',
              strict_min_version: '128.0',
              data_collection_permissions: { required: ['bookmarksInfo', 'authenticationInfo'] },
            },
          },
        }
      : {
          key: chromiumKey,
          minimum_chrome_version: '120',
          background: { service_worker: 'background.js' },
        }),
  };
  await writeFile(`${dir}/manifest.json`, JSON.stringify(manifest, null, 2));
  console.log(`Built ${dir} → ${origin}`);
}

await rm('dist/popup', { recursive: true, force: true });
