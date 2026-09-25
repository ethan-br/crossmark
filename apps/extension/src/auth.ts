import { debug } from './debug';
import browser from 'webextension-polyfill';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '../../../convex/_generated/api';
export interface Account {
  id: string;
  email: string;
  name: string;
}
export interface Credentials {
  email: string;
  password: string;
  create?: boolean;
}
export interface SessionAuth {
  signIn(credentials: Credentials): Promise<Account>;
  token(): Promise<string>;
  signOut(): Promise<void>;
}
interface StoredSession {
  token: string;
  account?: Account;
}
const signInRequired = 'Sign in to continue.';
const passwordHelp =
  'Accounts created with Google sign-in need a password set by the backend operator; see docs/auth-setup.md.';
const outdatedBackend = (site: string) =>
  `The backend at ${site} does not support email/password login. Deploy the current Convex functions to it.`;
const messages: Record<string, string | ((site: string) => string)> = {
  INVALID_EMAIL_OR_PASSWORD: `Invalid email or password. ${passwordHelp}`,
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: `An account with this email already exists. Sign in instead. ${passwordHelp}`,
  EMAIL_PASSWORD_DISABLED: outdatedBackend,
  EMAIL_PASSWORD_SIGN_UP_DISABLED: outdatedBackend,
  404: outdatedBackend,
  429: 'Too many attempts. Sign-in allows 10 every 5 minutes; creating an account allows 5 an hour.',
};
export class PasswordSession implements SessionAuth {
  private jwt?: { value: string; expiresAt: number };
  constructor(
    private convexURL: string,
    private siteURL: string,
  ) {}
  private async stored(): Promise<StoredSession | undefined> {
    return (await browser.storage.local.get('authSession')).authSession as
      StoredSession | undefined;
  }
  private async request(path: string, body?: unknown, token?: string) {
    let response: Response;
    try {
      response = await fetch(`${this.siteURL}/api/auth${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        credentials: 'omit',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(30000),
      });
    } catch {
      throw new Error(`Could not reach the Crossmark backend at ${this.siteURL}.`);
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok && data.code === 'INVALID_ORIGIN') {
      throw new Error(
        `Login configuration is incomplete on ${this.siteURL}. Add ${browser.runtime.getURL('').replace(/\/$/, '')} to AUTH_TRUSTED_ORIGINS.`,
      );
    }
    if (response.ok) return { data, response };
    if (response.status === 401 && token) throw new Error(signInRequired);
    const message = messages[data.code] ?? messages[response.status];
    throw new Error(
      typeof message === 'function'
        ? message(this.siteURL)
        : (message ?? data.message ?? 'Sign-in failed.'),
    );
  }
  signIn(credentials: Credentials): Promise<Account> {
    return debug.trace('auth.signIn', () => this.signInImpl(credentials));
  }
  private async signInImpl({ email, password, create }: Credentials): Promise<Account> {
    email = email.trim();
    if (!email || !password) throw new Error('Enter your email and password.');
    const { data, response } = create
      ? await this.request('/sign-up/email', { email, password, name: email.split('@')[0] })
      : await this.request('/sign-in/email', { email, password });
    const token = response.headers.get('set-auth-token') ?? data.token;
    if (!token) throw new Error('Sign-in did not create a session.');
    await browser.storage.local.set({ authSession: { token } });
    this.jwt = undefined;
    const client = new ConvexHttpClient(this.convexURL);
    client.setAuth(await this.token());
    const account = await client.query(api.auth.currentUser, {});
    await browser.storage.local.set({ authSession: { token, account } });
    return account;
  }
  token() {
    return debug.trace('auth.token', () => this.tokenImpl());
  }
  private async tokenImpl() {
    if (this.jwt && this.jwt.expiresAt > Date.now() + 60000) return this.jwt.value;
    const session = await this.stored();
    if (!session?.token) throw new Error(signInRequired);
    const { data, response } = await this.request('/convex/token', undefined, session.token);
    if (!data.token) throw new Error(signInRequired);
    const replacement = response.headers.get('set-auth-token');
    if (replacement)
      await browser.storage.local.set({ authSession: { ...session, token: replacement } });
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
        if (!String(error).includes(signInRequired)) throw error;
      }
    }
    this.jwt = undefined;
    await browser.storage.local.remove(['authSession', 'googleSession']);
  }
}
