# Login setup

Crossmark uses Better Auth email/password login on the Convex backend. There is no social provider, email code or manual device enrollment flow. Email verification and self-service password reset are not enabled in this version; the operator can [set a password](#setting-or-resetting-a-password).

## 1. Choose the backend

For local development, run `npm run backend`. The normal local addresses are:

- Convex functions: `http://127.0.0.1:3210`
- Convex HTTP/auth routes: `http://127.0.0.1:3211`

For login from remote computers, create a Convex cloud deployment and run `npx convex dev` against it. Use its `https://<deployment>.convex.cloud` functions URL and `https://<deployment>.convex.site` HTTP URL. A remote extension cannot reach another computer's loopback addresses.

Set `VITE_CONVEX_URL` and `VITE_CONVEX_SITE_URL` in `.env.local` to those two **origins**, without trailing slashes. The backend uses Convex's built-in `CONVEX_SITE_URL`; it must correspond to `VITE_CONVEX_SITE_URL`. A production deployment uses `npx convex deploy` and the production environment variables separately.

## 2. Configure Convex secrets

Set these in the selected deployment's **Convex dashboard → Settings → Environment Variables**, or use `npx convex env set NAME VALUE` locally. Use `--prod` only when intentionally configuring production.

| Variable               | Value                                                                              |
| ---------------------- | ---------------------------------------------------------------------------------- |
| `BETTER_AUTH_SECRET`   | A random secret of at least 32 characters; generate with `openssl rand -base64 48` |
| `AUTH_TRUSTED_ORIGINS` | Comma-separated extension origins from the next section                            |

Do not rotate `BETTER_AUTH_SECRET` during ordinary rebuilds: rotation invalidates sessions. New/cloud deployments need their own secret. Keep secrets out of source files and all `VITE_` or `WXT_` variables; only backend URLs are bundled in the extension.

Pull-request preview deployments copy Convex **preview default** env vars. Set `BETTER_AUTH_SECRET` and `AUTH_TRUSTED_ORIGINS` with `npx convex env default set --type preview …` as described in [CI and deployments](ci.md).

## 3. Configure trusted origins

Better Auth rejects sign-in requests whose `Origin` is not trusted. With the checked-in Chromium public manifest key, the unpacked extension ID is `eblopgfhjccjncfjmgcjfahaggkcolok`, so start with:

```text
chrome-extension://eblopgfhjccjncfjmgcjfahaggkcolok
```

Firefox's `moz-extension://` origin is unique to each browser profile. After loading the extension, open **about:debugging → Crossmark → Inspect** and run:

```js
browser.runtime.getURL('').replace(/\/$/, '');
```

Append the returned `moz-extension://<uuid>` origin to `AUTH_TRUSTED_ORIGINS`. Keep every Firefox profile you intend to use in the list; reinstalling can change that origin. A missing origin produces an error in the popup naming the exact value to add.

Keep `apps/extension/chromium-key.json` stable across local builds. It contains only the public key, not a signing private key. Store distribution or a different key may change the ID and require updated trusted origins. See [Better Auth trusted origins](https://www.better-auth.com/docs/reference/security).

## 4. Rebuild and verify

```sh
npm run build
```

Reload the extension, open it, choose **Create an account**, enter an email, a password of at least 8 characters and a browser name, and submit. In the second browser, sign in with the same email and password and approve its merge if it has bookmarks. Follow [the manual test checklist](test-plan.md).

## Setting or resetting a password

Accounts created with the earlier Google login have no password, and there is no self-service reset. The deployment operator can set one. Read the password without echoing it so it stays out of the shell history and out of `ps` output:

```bash
read -rs -p 'New password: ' PASSWORD && echo
npx convex run auth:setPassword "{\"email\":\"user@example.com\",\"password\":\"$PASSWORD\"}"
unset PASSWORD
```

Add `--prod` (or `--preview-name …`) to target another deployment. This works for both password-less and existing accounts, keeps the account's collection, and ends every existing session, so each browser asks for the new password on its next sync. The function is internal; it cannot be called from the extension or the public HTTP routes.

## Rate limiting

Better Auth's limiter is enabled explicitly (it otherwise depends on `NODE_ENV`, which Convex does not set) and stores counters in the component's `rateLimit` table. Per client IP, `/sign-in/email` allows 10 attempts per 5 minutes and `/sign-up/email` 5 per hour; other auth routes use Better Auth's defaults. If Better Auth cannot resolve a client IP it logs a warning and falls back to one bucket per route for everyone; check the deployment logs for that warning after deploying.

## Backend and extension versions

Deploy the Convex functions from the same commit as the extension build. A current extension against a backend without email/password login reports that the backend must be redeployed. An extension built before email/password login cannot sign in to a current backend; rebuild and reload it.

## Troubleshooting

- **Add … to AUTH_TRUSTED_ORIGINS:** add the exact extension origin shown; Firefox's profile UUID can change.
- **Could not reach the Crossmark backend:** verify both `.env.local` backend URLs, rebuild and reload. Both origins must appear in the generated manifest's host permissions and connection policy.
- **Invalid email or password:** check the credentials, or create an account first. A Google-created account needs a password [set by the operator](#setting-or-resetting-a-password).
- **An account with this email already exists:** sign in instead of creating an account.
- **Does not support email/password login:** deploy this version's Convex functions to the backend the extension was built for.
- **Too many attempts:** wait for the rate-limit window to pass — 5 minutes for sign-in, an hour for creating an account. The limiter counts an attempt before the origin check rejects the request, so a stale Firefox profile origin can exhaust the sign-up limit without the origin error ever appearing; fix the origin first.
- **Sign-in required:** sign in with the same account again. Pending changes remain local. Export is available without a valid session; pausing also works without network access.

For diagnostics, enable [debug mode](debugging.md) before reproducing. `auth.signIn` and `command.connect` record operation outcomes without credentials or tokens.

Implementation references: [Better Auth email/password](https://www.better-auth.com/docs/authentication/email-password), [Convex Better Auth integration](https://labs.convex.dev/better-auth/framework-guides/react), [Better Auth bearer sessions](https://www.better-auth.com/docs/plugins/bearer).

## Firefox installation note

For local development, use **about:debugging → This Firefox → Load Temporary Add-on** and choose `dist/firefox/manifest.json`. Firefox reads that manifest directly from the build directory. If you use an archive, run `npm run package:firefox`; the resulting `dist/crossmark-firefox.xpi` has the manifest at its root. Zipping the `dist/firefox` directory itself creates `firefox/manifest.json` one level down and Firefox reports that archive as corrupt.

The regular Add-ons Manager only accepts signed packages in a standard Firefox release. An unsigned local XPI commonly produces the same “appears to be corrupt” message even when its manifest is valid. Use the temporary-install flow while developing, or submit the package to AMO for signing before trying a permanent installation.

To sign a self-distributed package from this project, create AMO API credentials at [AMO API keys](https://addons.mozilla.org/developers/addon/api/key/), keep them only in your shell, and run:

```sh
export AMO_JWT_ISSUER='your-amo-jwt-issuer'
export AMO_JWT_SECRET='your-amo-jwt-secret'
npm run sign:firefox
```

The signed XPI is placed in `dist/signed/` and copied to `dist/crossmark-firefox-signed.xpi`. `web-ext sign` uses Mozilla's Add-ons signing API; “locally” means the command and credentials stay on your machine, while Mozilla performs the actual signature. This project uses the `unlisted` channel for private testing. Do not commit the credentials or put them in `.env`, `VITE_` or `WXT_` variables or extension files.
