import type { UserManifest } from 'wxt';
import { key } from './chromium-key.json';

interface PublicEnvironment {
  VITE_CONVEX_URL?: string;
  VITE_CONVEX_SITE_URL?: string;
}

export function extensionManifest(browser: string, env: PublicEnvironment): UserManifest {
  const origin = env.VITE_CONVEX_URL || 'http://127.0.0.1:3210';
  const siteOrigin = env.VITE_CONVEX_SITE_URL || 'http://127.0.0.1:3211';
  for (const endpoint of [origin, siteOrigin]) {
    const parsed = new URL(endpoint);
    if (
      parsed.origin !== endpoint ||
      (parsed.protocol !== 'https:' &&
        !(parsed.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(parsed.hostname)))
    ) {
      throw new Error('Use HTTPS backend origins, or loopback HTTP for development.');
    }
  }
  const icons = Object.fromEntries([16, 32, 48, 128].map((size) => [size, `icons/${size}.png`]));
  return {
    name: 'Crossmark',
    description: 'Synchronize native bookmarks across desktop browsers.',
    permissions: ['bookmarks', 'storage', 'alarms', 'identity'],
    host_permissions: [...new Set([`${origin}/*`, `${siteOrigin}/*`])],
    icons,
    action: { default_icon: icons },
    content_security_policy: {
      extension_pages: `script-src 'self'; object-src 'self'; connect-src 'self' ${origin} ${siteOrigin}`,
    },
    ...(browser === 'firefox'
      ? {
          browser_specific_settings: {
            gecko: {
              id: 'braunstein.ethan@gmail.com',
              strict_min_version: '128.0',
              data_collection_permissions: { required: ['bookmarksInfo', 'authenticationInfo'] },
            },
          },
        }
      : { key, minimum_chrome_version: '120' }),
  };
}
