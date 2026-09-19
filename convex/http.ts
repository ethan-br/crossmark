import { httpRouter } from 'convex/server';
import { authComponent, createAuth } from './auth';
import { httpAction } from './_generated/server';
const http = httpRouter();
// Firefox must not see Google's backend redirect_uri in the initial URL.
// Only relay Google authorization requests for this deployment.
http.route({
  path: '/extension/google-launch',
  method: 'GET',
  handler: httpAction(async (_ctx, request) => {
    const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };
    let url: URL;
    try {
      url = new URL(new URL(request.url).searchParams.get('authorization') ?? '');
    } catch {
      return new Response('Invalid Google authorization URL.', { status: 400, headers });
    }
    if (
      url.origin !== 'https://accounts.google.com' ||
      url.pathname !== '/o/oauth2/v2/auth' ||
      url.username ||
      url.password ||
      url.hash ||
      !process.env.GOOGLE_CLIENT_ID ||
      url.searchParams.getAll('client_id').length !== 1 ||
      url.searchParams.get('client_id') !== process.env.GOOGLE_CLIENT_ID ||
      url.searchParams.getAll('redirect_uri').length !== 1 ||
      url.searchParams.get('redirect_uri') !==
        `${process.env.CONVEX_SITE_URL}/api/auth/callback/google` ||
      url.searchParams.get('response_type') !== 'code' ||
      !url.searchParams.get('state')
    ) {
      return new Response('Invalid Google authorization URL for this backend.', {
        status: 400,
        headers,
      });
    }
    return new Response(null, { status: 302, headers: { ...headers, Location: url.href } });
  }),
});
authComponent.registerRoutes(http, createAuth, { cors: { exposedHeaders: ['Set-Auth-Token'] } });
export default http;
