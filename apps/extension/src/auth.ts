import { debug } from './debug';
import browser from 'webextension-polyfill';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '../../../convex/_generated/api';
export interface Account {
  id: string;
  email: string;
  name: string;
}
export interface SessionAuth {
  signIn(): Promise<Account>;
  token(): Promise<string>;
  signOut(): Promise<void>;
}
interface StoredSession {
  token: string;
  account?: Account;
}
export class GoogleSession implements SessionAuth {
  private jwt?: { value: string; expiresAt: number };
  constructor(
    private convexURL: string,
    private siteURL: string,
  ) {}
  private async stored(): Promise<StoredSession | undefined> {
    return (await browser.storage.local.get('googleSession')).googleSession as
      StoredSession | undefined;
  }
  private async request(path: string, body?: unknown, token?: string) {
    const response = await fetch(`${this.siteURL}/api/auth${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'omit',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(30000),
    });
    const data = await response.json();
    if (
      !response.ok &&
      ['INVALID_ORIGIN', 'INVALID_CALLBACK_URL', 'INVALID_ERROR_CALLBACK_URL'].includes(data.code)
    ) {
      throw new Error(
        `Google login configuration is incomplete on ${this.siteURL}. Add ${browser.runtime.getURL('').replace(/\/$/, '')} and ${new URL(browser.identity.getRedirectURL('auth')).origin} to AUTH_TRUSTED_ORIGINS. See docs/google-oauth-setup.md.`,
      );
    }
    if (!response.ok)
      throw new Error(
        response.status === 401
          ? 'Sign in with Google to continue.'
          : (data.message ?? 'Google sign-in failed.'),
      );
    return { data, response };
  }
  signIn(): Promise<Account> {
    return debug.trace('auth.signIn', () => this.signInImpl());
  }
  private async signInImpl(): Promise<Account> {
    const client = new ConvexHttpClient(this.convexURL);
    const config = await client.query(api.auth.configuration, {});
    if (!config.googleConfigured)
      throw new Error(
        'Google login is not configured on the backend. See the Google OAuth setup in README.md.',
      );
    const redirect = browser.identity.getRedirectURL('auth');
    const firefox = browser.runtime.getURL('').startsWith('moz-extension:');
    if (firefox && !config.firefoxLaunchSupported)
      throw new Error(
        'Firefox Google login requires an updated backend. Deploy the current Convex functions to the configured backend. See docs/google-oauth-setup.md.',
      );
    const state = crypto.randomUUID();
    const callback = new URL(redirect);
    callback.searchParams.set('state', state);
    const { data: start } = await this.request('/sign-in/social', {
      provider: 'google',
      callbackURL: callback.href,
      errorCallbackURL: callback.href,
      disableRedirect: true,
    });
    if (!start.url || new URL(start.url).origin !== 'https://accounts.google.com')
      throw new Error('Invalid Google authorization URL.');
    // Firefox validates the initial URL's redirect_uri against getRedirectURL().
    // Google must return to Convex first, so use our constrained backend redirect.
    const launch = new URL(`${this.siteURL}/extension/google-launch`);
    launch.searchParams.set('authorization', start.url);
    const completed = await browser.identity.launchWebAuthFlow({
      url: firefox ? launch.href : start.url,
      interactive: true,
    });
    if (!completed) throw new Error('Google login was cancelled.');
    const returned = new URL(completed);
    if (
      returned.origin !== callback.origin ||
      returned.pathname !== callback.pathname ||
      returned.searchParams.get('state') !== state
    )
      throw new Error('Google login returned an invalid callback.');
    if (returned.searchParams.has('error'))
      throw new Error('Google login was not completed. Try again.');
    const handoff = returned.searchParams.get('ott');
    if (!handoff) throw new Error('Google login did not return a session.');
    // Internal Better Auth OAuth session transfer; never displayed or shared with another browser.
    const { data, response } = await this.request('/cross-domain/one-time-token/verify', {
      token: handoff,
    });
    const token = response.headers.get('set-auth-token') ?? data.session?.token;
    if (!token) throw new Error('Google login did not create a session.');
    await browser.storage.local.set({ googleSession: { token } });
    this.jwt = undefined;
    client.setAuth(await this.token());
    const account = await client.query(api.auth.currentUser, {});
    await browser.storage.local.set({ googleSession: { token, account } });
    return account;
  }
  token() {
    return debug.trace('auth.token', () => this.tokenImpl());
  }
  private async tokenImpl() {
    if (this.jwt && this.jwt.expiresAt > Date.now() + 60000) return this.jwt.value;
    const session = await this.stored();
    if (!session?.token) throw new Error('Sign in with Google to continue.');
    const { data, response } = await this.request('/convex/token', undefined, session.token);
    if (!data.token) throw new Error('Sign in with Google to continue.');
    const replacement = response.headers.get('set-auth-token');
    if (replacement)
      await browser.storage.local.set({ googleSession: { ...session, token: replacement } });
    this.jwt = { value: data.token, expiresAt: Date.now() + 10 * 60_000 };
    return data.token as string;
  }
  signOut() {
    return debug.trace('auth.signOut', () => this.signOutImpl());
  }
  private async signOutImpl() {
    const session = await this.stored();
    if (session?.token) {
      try {
        await this.request('/sign-out', {}, session.token);
      } catch (error) {
        if (!/Sign in with Google/.test(String(error))) throw error;
      }
    }
    this.jwt = undefined;
    await browser.storage.local.remove('googleSession');
  }
}
