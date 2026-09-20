# Google OAuth setup

Google is the only login provider. Live sign-in requires a Google web client configured on the selected backend. No email/password, email code or manual device enrollment flow is enabled.

## 1. Choose the backend

For local development, run `npm run backend`. The normal local addresses are:

- Convex functions: `http://127.0.0.1:3210`
- Convex HTTP/auth routes: `http://127.0.0.1:3211`

For login from remote computers, create a Convex cloud deployment and run `npx convex dev` against it. Use its `https://<deployment>.convex.cloud` functions URL and `https://<deployment>.convex.site` HTTP URL. A remote extension cannot reach another computer's loopback addresses. A stable cloud URL also avoids changing OAuth settings whenever a temporary tunnel changes.

Set `VITE_CONVEX_URL` and `VITE_CONVEX_SITE_URL` in `.env.local` to those two **origins**, without trailing slashes. The backend uses Convex's built-in `CONVEX_SITE_URL`; it must correspond to `VITE_CONVEX_SITE_URL`. A production deployment uses `npx convex deploy` and the production environment variables separately.

## 2. Create the Google web client

In [Google Cloud Console](https://console.cloud.google.com/), select or create a project. Under **Google Auth Platform**:

1. Configure Branding, support email and developer contact information.
2. Choose the audience. For an external app in Testing, add each Google account used in the test under Test users.
3. Create a client with application type **Web application**.
4. Add this **Authorized redirect URI**, replacing the origin with your backend's HTTP origin:

   ```text
   https://<deployment>.convex.site/api/auth/callback/google
   ```

   For the default local backend, use `http://127.0.0.1:3211/api/auth/callback/google`. If using `localhost` instead, use it consistently in both backend configuration and the registered callback. Google requires an exact match.

5. Save the client ID and client secret. This flow only needs the standard identity scopes `openid`, `email` and `profile`. It does not request Chrome Sync, bookmarks, Drive or other Google API scopes. No authorized JavaScript origin is needed for this server-side redirect flow.

The extension's `chromiumapp.org` / `extensions.allizom.org` URLs belong in Better Auth's trusted origins below, **not** in Google's redirect URI field. Google returns to Convex; Convex then returns to the extension.

Firefox and Firefox-based browsers start the identity flow at the backend's `/extension/google-launch` route. That route redirects to the Google authorization URL without changing its `redirect_uri`. This is necessary because Firefox rejects an initial authorization URL whose `redirect_uri` points to Convex instead of the extension. Chromium continues to launch Google's URL directly. Deploy the updated Convex functions along with the extension; an older backend produces an explicit update-required error.

Reference: [Better Auth Google provider setup](https://www.better-auth.com/docs/authentication/google).

## 3. Configure Convex secrets

Set these in the selected deployment's **Convex dashboard → Settings → Environment Variables**, or use `npx convex env set NAME VALUE` locally. Use `--prod` only when intentionally configuring production.

| Variable               | Value                                                                              |
| ---------------------- | ---------------------------------------------------------------------------------- |
| `GOOGLE_CLIENT_ID`     | Google's web client ID                                                             |
| `GOOGLE_CLIENT_SECRET` | Google's web client secret                                                         |
| `BETTER_AUTH_SECRET`   | A random secret of at least 32 characters; generate with `openssl rand -base64 48` |
| `AUTH_TRUSTED_ORIGINS` | Comma-separated origins from the next section                                      |

A random `BETTER_AUTH_SECRET` is already set on this workspace's local deployment. Do not rotate it during ordinary rebuilds: rotation invalidates sessions. New/cloud deployments need their own secret. Keep secrets out of source files and all `VITE_` or `WXT_` variables; only backend URLs are bundled in the extension.

Pull-request preview deployments copy Convex **preview default** env vars. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `BETTER_AUTH_SECRET` and `AUTH_TRUSTED_ORIGINS` with `npx convex env default set --type preview …` as described in [CI and deployments](ci.md). Each preview still needs its own Google redirect URI, `https://<preview>.convex.site/api/auth/callback/google`.

## 4. Configure trusted origins

With the checked-in Chromium public manifest key, the unpacked extension ID is `eblopgfhjccjncfjmgcjfahaggkcolok`. Firefox's stable add-on ID is `braunstein.ethan@gmail.com`. Start `AUTH_TRUSTED_ORIGINS` with this comma-separated value:

```text
chrome-extension://eblopgfhjccjncfjmgcjfahaggkcolok,https://eblopgfhjccjncfjmgcjfahaggkcolok.chromiumapp.org,https://535884d15b4bf578f81c89ff04b5e3b95b647c0a.extensions.allizom.org
```

Firefox's `moz-extension://` origin is unique to each browser profile. After loading the extension, open **about:debugging → Crossmark → Inspect**. In its console, run:

```js
browser.runtime.getURL('').replace(/\/$/, '');
browser.identity.getRedirectURL('auth');
```

Append the returned `moz-extension://<uuid>` origin to `AUTH_TRUSTED_ORIGINS`. Keep every Firefox profile you intend to use in the comma-separated list. Reinstalling can change that origin. The redirect should be the stable `https://535884d15b4bf578f81c89ff04b5e3b95b647c0a.extensions.allizom.org/auth`; if the add-on ID changes, use the actual returned origin instead.

The temporary development build and AMO-signed build use the same explicit `browser_specific_settings.gecko.id`, so their identity callback is the same. Signing does not replace the ID. If a distribution uses a different add-on ID, or a Firefox-based browser uses a different identity redirect domain, read `getRedirectURL('auth')` in that installed build and register its exact origin. Do not construct it from the profile UUID. Keep `/auth` in the generated callback; the per-attempt `state` query parameter is added at runtime and does not belong in configuration. The Google web client's registered callback remains the exact backend URL from section 2 in every case.

For Chromium, inspect the service worker from the extensions manager and verify `chrome.runtime.id` and `chrome.identity.getRedirectURL('auth')`. Keep `apps/extension/chromium-key.json` stable across local builds. It contains only the public key, not a signing private key. WXT uses the same key for development and production builds. Store distribution or a different key may change the ID and require updated trusted origins.

Do not copy the temporary Firefox origin from headless test output into a permanent configuration; it belongs to a disposable profile. Exact origin registration is used in this v0. See [Better Auth trusted origins](https://www.better-auth.com/docs/reference/security) for how request origins and redirect destinations are checked.

## 5. Rebuild and verify

```sh
npm run build
npx convex run auth:configuration
```

The query should return `googleConfigured: true`. This confirms both environment values exist, not that Google accepts them. Reload the extension in each browser, open it, enter a browser name, and click **Sign in with Google**. Complete Google's consent screen. Browser identity APIs return the result to the background even if the popup closes; reopen it to see sync status.

Sign in with the same account in the second browser and approve its merge if it has bookmarks. Follow [the manual test checklist](test-plan.md). Live OAuth consent, callback completion, session refresh and cross-browser sync with real Google sessions remain unverified until these credentials are configured.

## Troubleshooting

- **Google login is not configured:** set both Google variables on the deployment the built extension actually uses.
- **redirect_uri_mismatch:** compare Google's registered URI against the backend HTTP origin plus `/api/auth/callback/google`, including scheme, host and port.
- **Invalid origin / callback URL:** add the exact request origin and extension redirect origin to `AUTH_TRUSTED_ORIGINS`; Firefox's profile UUID can change.
- **Firefox Google login requires an updated backend:** deploy this version's Convex functions to the deployment selected by `VITE_CONVEX_URL` and `VITE_CONVEX_SITE_URL`, then reload the extension.
- **redirect_uri not allowed:** reload the current Firefox extension build and deploy its backend launch route. Do not change Google's callback to `extensions.allizom.org`; Google must still return to Convex. This Firefox error occurs before Google login and is different from Google's `redirect_uri_mismatch`.
- **Access blocked while Testing:** add the chosen account as a Google test user and check the configured audience.
- **Network/CSP failure:** verify both `.env.local` backend URLs, rebuild and reload. Both origins must appear in the generated manifest's host permissions and connection policy.
- **Sign-in required:** sign in with the same Google account again. Pending changes remain local. Export is available without a valid session; pausing also works without network access.

For diagnostics, enable [debug mode](debugging.md) before reproducing. `auth.signIn` and `command.connect` record operation outcomes without OAuth URLs or tokens. Inspect the two public redirect/origin values above separately when checking configuration.

Implementation references: [Convex Better Auth integration](https://labs.convex.dev/better-auth/framework-guides/react), [Better Auth bearer sessions](https://www.better-auth.com/docs/plugins/bearer).

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
