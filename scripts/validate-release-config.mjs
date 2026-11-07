// Release artifacts must never silently target a local development backend.
export function validateReleaseConfig(env) {
  const match = /^https:\/\/([a-z0-9-]+)\.convex\.cloud$/.exec(env.VITE_CONVEX_URL || '');
  if (!match || env.VITE_CONVEX_SITE_URL !== `https://${match[1]}.convex.site`) {
    throw new Error('Release URLs must name the same HTTPS Convex production deployment.');
  }
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  validateReleaseConfig(process.env);
}
