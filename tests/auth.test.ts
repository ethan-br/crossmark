import { beforeEach, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  setAuth: vi.fn(),
}));

vi.mock('convex/browser', () => ({
  ConvexHttpClient: class {
    query = mocks.query;
    setAuth = mocks.setAuth;
  },
}));

import { PasswordSession } from '../apps/extension/src/auth';

let fetchMock: ReturnType<typeof vi.fn>;
const credentials = { email: ' one@example.com ', password: 'correct horse' };
const extensionOrigin = () => fakeBrowser.runtime.getURL('').replace(/\/$/, '');

beforeEach(() => {
  vi.clearAllMocks();
  mocks.query.mockResolvedValue({ id: 'user-1', email: 'one@example.com', name: 'One' });
  fetchMock = vi.fn(async (url: string) => {
    if (url.endsWith('/sign-in/email') || url.endsWith('/sign-up/email'))
      return Response.json(
        { token: 'session-secret' },
        { headers: { 'set-auth-token': 'signed-session-secret' } },
      );
    if (url.endsWith('/convex/token')) return Response.json({ token: 'convex-jwt' });
    return Response.json({ success: true });
  });
  vi.stubGlobal('fetch', fetchMock);
});

const session = () =>
  new PasswordSession('https://backend.convex.cloud', 'https://backend.convex.site');
const body = (path: string) =>
  JSON.parse(fetchMock.mock.calls.find(([url]) => url.endsWith(path))![1].body);
const storedSession = async () =>
  (await fakeBrowser.storage.local.get('authSession')).authSession as
    { token?: string } | undefined;

it('exchanges email and password for a private session and a Convex JWT', async () => {
  const auth = session();
  expect(await auth.signIn(credentials)).toEqual({
    id: 'user-1',
    email: 'one@example.com',
    name: 'One',
  });
  expect(body('/sign-in/email')).toEqual({ email: 'one@example.com', password: 'correct horse' });
  expect(mocks.setAuth).toHaveBeenCalledWith('convex-jwt');
  expect(await storedSession()).toMatchObject({ token: 'signed-session-secret' });
  expect(JSON.stringify(await fakeBrowser.storage.local.get(null))).not.toContain('correct horse');
  const jwtCall = fetchMock.mock.calls.find(([url]) => url.endsWith('/convex/token'))!;
  expect(jwtCall[1].headers).toMatchObject({ Authorization: 'Bearer signed-session-secret' });
  expect(await auth.token()).toBe('convex-jwt');
  await auth.signOut();
  expect(await storedSession()).toBeUndefined();
  await expect(auth.token()).rejects.toThrow('Sign in to continue');
});

it('creates an account when requested', async () => {
  await session().signIn({ ...credentials, create: true });
  expect(body('/sign-up/email')).toEqual({
    email: 'one@example.com',
    password: 'correct horse',
    name: 'one',
  });
  expect(fetchMock.mock.calls.some(([url]) => url.endsWith('/sign-in/email'))).toBe(false);
});

it('reports rejected credentials without storing a session', async () => {
  fetchMock.mockResolvedValue(
    Response.json(
      { code: 'INVALID_EMAIL_OR_PASSWORD', message: 'Invalid email or password' },
      { status: 401 },
    ),
  );
  await expect(session().signIn(credentials)).rejects.toThrow(
    /Invalid email or password\. Accounts created with Google sign-in/,
  );
  expect(await storedSession()).toBeUndefined();
});

it.each([
  ['EMAIL_PASSWORD_DISABLED', 400],
  ['EMAIL_PASSWORD_SIGN_UP_DISABLED', 400],
  [undefined, 404],
])('asks for a backend deploy when it predates email/password: %s', async (code, status) => {
  fetchMock.mockResolvedValue(Response.json({ code }, { status }));
  await expect(session().signIn(credentials)).rejects.toThrow(
    'The backend at https://backend.convex.site does not support email/password login. Deploy the current Convex functions',
  );
});

it('explains rate limiting', async () => {
  fetchMock.mockResolvedValue(
    Response.json({ message: 'Too many requests. Please try again later.' }, { status: 429 }),
  );
  await expect(session().signIn(credentials)).rejects.toThrow('Too many attempts');
});

it('requires both an email and a password before contacting the backend', async () => {
  await expect(session().signIn({ email: ' ', password: 'x' })).rejects.toThrow('Enter your email');
  await expect(session().signIn({ email: 'a@example.com', password: '' })).rejects.toThrow(
    'Enter your email',
  );
  expect(fetchMock).not.toHaveBeenCalled();
});

it('explains a missing trusted origin', async () => {
  fetchMock.mockResolvedValue(
    Response.json({ code: 'INVALID_ORIGIN', message: 'Invalid origin' }, { status: 403 }),
  );
  await expect(session().signIn(credentials)).rejects.toThrow(
    `Add ${extensionOrigin()} to AUTH_TRUSTED_ORIGINS`,
  );
});

it('reports an unreachable backend', async () => {
  fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
  await expect(session().signIn(credentials)).rejects.toThrow('Could not reach');
});

it('requires login after an expired session and still allows sign-out', async () => {
  await fakeBrowser.storage.local.set({
    authSession: { token: 'expired' },
    googleSession: { token: 'legacy' },
  });
  fetchMock.mockImplementation(async () =>
    Response.json({ message: 'Unauthenticated' }, { status: 401 }),
  );
  const auth = session();
  await expect(auth.token()).rejects.toThrow('Sign in to continue');
  await auth.signOut();
  expect(await storedSession()).toBeUndefined();
  expect((await fakeBrowser.storage.local.get('googleSession')).googleSession).toBeUndefined();
});
