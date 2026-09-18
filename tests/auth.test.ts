import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  storage: {} as Record<string, unknown>,
  launch: vi.fn(),
  query: vi.fn(),
  setAuth: vi.fn(),
  runtimeURL: vi.fn(),
  redirectURL: vi.fn(),
}));
vi.mock('webextension-polyfill', () => ({
  default: {
    runtime: { getURL: mocks.runtimeURL },
    storage: {
      local: {
        get: async (key: string) => ({ [key]: mocks.storage[key] }),
        set: async (value: Record<string, unknown>) => Object.assign(mocks.storage, value),
        remove: async (key: string) => {
          delete mocks.storage[key];
        },
      },
    },
    identity: {
      getRedirectURL: mocks.redirectURL,
      launchWebAuthFlow: mocks.launch,
    },
  },
}));
vi.mock('convex/browser', () => ({
  ConvexHttpClient: class {
    query = mocks.query;
    setAuth = mocks.setAuth;
  },
}));
import { GoogleSession } from '../apps/extension/src/auth';
let callback = '';
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.storage = {};
  mocks.runtimeURL.mockReturnValue('chrome-extension://test/');
  mocks.redirectURL.mockReturnValue('https://test.chromiumapp.org/auth');
  callback = '';
  mocks.query
    .mockResolvedValueOnce({ googleConfigured: true, firefoxLaunchSupported: true })
    .mockResolvedValue({ id: 'user-1', email: 'one@example.com', name: 'One' });
  fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    if (url.endsWith('/sign-in/social')) {
      const body = JSON.parse(init.body as string);
      expect(body.provider).toBe('google');
      callback = body.callbackURL;
      return Response.json({
        url: 'https://accounts.google.com/o/oauth2/v2/auth?state=server-nonce',
      });
    }
    if (url.endsWith('/cross-domain/one-time-token/verify'))
      return Response.json(
        { session: { token: 'session-secret' } },
        { headers: { 'set-auth-token': 'signed-session-secret' } },
      );
    if (url.endsWith('/convex/token')) return Response.json({ token: 'convex-jwt' });
    return Response.json({ success: true });
  });
  vi.stubGlobal('fetch', fetchMock);
  mocks.launch.mockImplementation(async () => `${callback}&ott=internal-handoff`);
});
const session = () =>
  new GoogleSession('https://backend.convex.cloud', 'https://backend.convex.site');
it('exchanges the Google callback for a private session and a Convex JWT', async () => {
  const auth = session();
  expect(await auth.signIn()).toEqual({ id: 'user-1', email: 'one@example.com', name: 'One' });
  expect(mocks.setAuth).toHaveBeenCalledWith('convex-jwt');
  expect(mocks.launch).toHaveBeenCalledWith({
    url: 'https://accounts.google.com/o/oauth2/v2/auth?state=server-nonce',
    interactive: true,
  });
  expect(mocks.storage.googleSession).toMatchObject({ token: 'signed-session-secret' });
  const jwtCall = fetchMock.mock.calls.find(([url]) => url.endsWith('/convex/token'))!;
  expect(jwtCall[1].headers).toMatchObject({ Authorization: 'Bearer signed-session-secret' });
  expect(await auth.token()).toBe('convex-jwt');
  await auth.signOut();
  expect(mocks.storage.googleSession).toBeUndefined();
  await expect(auth.token()).rejects.toThrow('Sign in with Google');
});
it('launches Firefox through Convex and validates its runtime-generated callback', async () => {
  mocks.runtimeURL.mockReturnValue('moz-extension://profile-uuid/');
  mocks.redirectURL.mockReturnValue('https://installed-addon.extensions.allizom.org/auth');
  await session().signIn();
  const launch = new URL(mocks.launch.mock.calls[0][0].url);
  expect(launch.origin).toBe('https://backend.convex.site');
  expect(launch.pathname).toBe('/extension/google-launch');
  expect(launch.searchParams.has('redirect_uri')).toBe(false);
  expect(launch.searchParams.get('authorization')).toBe(
    'https://accounts.google.com/o/oauth2/v2/auth?state=server-nonce',
  );
  expect(new URL(callback).origin).toBe('https://installed-addon.extensions.allizom.org');
  expect(new URL(callback).pathname).toBe('/auth');
  expect(mocks.redirectURL).toHaveBeenCalledWith('auth');
});
it('reports an actionable error for Firefox against an older backend', async () => {
  mocks.runtimeURL.mockReturnValue('moz-extension://profile-uuid/');
  mocks.query.mockReset().mockResolvedValue({ googleConfigured: true });
  await expect(session().signIn()).rejects.toThrow('Deploy the current Convex functions');
  expect(mocks.launch).not.toHaveBeenCalled();
  expect(fetchMock).not.toHaveBeenCalled();
});
it.each(['INVALID_ORIGIN', 'INVALID_CALLBACK_URL', 'INVALID_ERROR_CALLBACK_URL'])(
  'explains missing trusted origins: %s',
  async (code) => {
    mocks.runtimeURL.mockReturnValue('moz-extension://profile-uuid/');
    mocks.redirectURL.mockReturnValue('https://installed-addon.extensions.allizom.org/auth');
    fetchMock.mockResolvedValue(
      Response.json({ code, message: 'Invalid callbackURL' }, { status: 403 }),
    );
    await expect(session().signIn()).rejects.toThrow(
      'Add moz-extension://profile-uuid and https://installed-addon.extensions.allizom.org to AUTH_TRUSTED_ORIGINS',
    );
    expect(mocks.launch).not.toHaveBeenCalled();
  },
);
it.each([
  'https://attacker.example/auth?state=wrong&ott=x',
  'https://test.chromiumapp.org/auth?state=wrong&ott=x',
  'https://test.chromiumapp.org/other?state=wrong&ott=x',
])('rejects mismatched callback %s', async (url) => {
  mocks.launch.mockResolvedValue(url);
  await expect(session().signIn()).rejects.toThrow('invalid callback');
  expect(mocks.storage.googleSession).toBeUndefined();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
it('does not launch a browser when Google is unconfigured', async () => {
  mocks.query.mockReset().mockResolvedValue({ googleConfigured: false });
  await expect(session().signIn()).rejects.toThrow('not configured');
  expect(mocks.launch).not.toHaveBeenCalled();
});
it('requires login after an expired session and still allows sign-out', async () => {
  mocks.storage.googleSession = { token: 'expired' };
  fetchMock.mockImplementation(async () =>
    Response.json({ message: 'Unauthenticated' }, { status: 401 }),
  );
  const auth = session();
  await expect(auth.token()).rejects.toThrow('Sign in with Google');
  await auth.signOut();
  expect(mocks.storage.googleSession).toBeUndefined();
});
it('rejects an authorization URL outside Google', async () => {
  fetchMock.mockResolvedValue(Response.json({ url: 'https://attacker.example/oauth' }));
  await expect(session().signIn()).rejects.toThrow('Invalid Google authorization URL');
  expect(mocks.launch).not.toHaveBeenCalled();
});
