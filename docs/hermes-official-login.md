# Nous Official Login

Hermes Web can require a Nous Portal account before granting access to the panel
and all of its APIs. This is independent of model-provider login and the
server-to-server Dashboard token/API key.

## Server Setup

1. Register a **separate self-hosted dashboard** for this panel at
   https://portal.nousresearch.com/local-dashboards. Register its exact callback:
   `https://your-domain/api/web-auth/official/callback`.
   The returned client ID has the form `agent:...`.
2. Set the following server environment variables (or `.env.local`):

   ```dotenv
   HERMES_WEB_OAUTH_CLIENT_ID=agent:your-instance-id
   HERMES_WEB_PUBLIC_URL=https://your-domain
   PI_WEB_ALLOWED_HOSTS=your-domain
   ```

3. Configure the existing `HERMES_DASHBOARD_URL`,
   `HERMES_DASHBOARD_SESSION_TOKEN`, and, when used, API Server URL/key.
   These credentials remain on the server. Keep the Dashboard and API Server
   private; exposing them separately would bypass this panel's login.
4. Run the panel behind HTTPS, preserving the original `Host` header. Restart
   the panel after changing environment variables. The registered callback,
   public URL and actual browser hostname must agree. Root-origin deployments
   are supported; subpath deployments are not currently supported.
5. Open the panel and choose **Sign in with Nous**. Check Account and access in
   General settings after login. Portal applies the registered instance's access
   permissions; arbitrary Nous accounts do not gain access merely by signing in.

For a personal instance, optionally restrict further to exact Portal user IDs:

```dotenv
HERMES_WEB_OAUTH_ALLOWED_USERS=user-id-1,user-id-2
```

The current user's ID is displayed in Account and access after a successful
official login. IDs are compared exactly; emails are not used because the
official dashboard access token does not include an email. Changes to this
allow-list invalidate sessions of excluded users after the new configuration
is loaded.

Set `PI_WEB_PASSWORD` as well to retain password login as an independent backup.
Leaving it blank makes official login the sole method. A nonempty OAuth client
ID engages authentication on loopback too; invalid/incomplete configuration
fails closed and the password backup remains available if configured.

For local verification only, HTTP is accepted for `localhost`, `127.0.0.1` and
`[::1]`. Register that exact local callback separately. A browser on another
computer cannot use your server's loopback address.

## Session Behavior

- Authorization code + PKCE S256 and one-use state, bound to an HttpOnly cookie,
  with a 10-minute deadline. Only the official Portal issuer is accepted.
- JWT verification uses `jose` and official JWKS, RS256 only, checks issuer,
  audience, expiry, issued-at, subject, and instance/contract claims when present.
- Browser cookies contain a random opaque session identifier, never OAuth
  access/refresh tokens, backend tokens or API keys. Logout immediately removes
  the panel session; it does not log the user out of the Nous website.
- Panel sessions end at the official access token's expiry, or after eight
  hours, whichever comes first. Refresh tokens are not retained; expiration
  requires signing in again (existing Portal SSO may avoid another password
  prompt). Remote revocation before expiry is not checked.
- Flows and sessions are private files under `HERMES_WEB_DATA_DIR/auth` (default
  `~/.hermes-web/auth`). Session filenames hash the opaque cookie; Portal tokens
  are never stored. Flows are claimed by atomic rename to prevent replay across
  processes. Sessions survive restart, and logout is observed by every process
  sharing that directory. Persist the directory and restrict it to the service
  account. Running chat event buffers remain process-local: use one process or
  sticky routing for chats even when authentication storage is shared.
- Official login authenticates this server's panel. It does not synchronize
  machines, host your Hermes service, or establish network connectivity.

Protocol reference: Hermes `plugins/dashboard_auth/nous/__init__.py` and
`hermes_cli/dashboard_register.py`. Keep this panel's client registration
separate from the built-in Dashboard so their callbacks do not overwrite one
another.
