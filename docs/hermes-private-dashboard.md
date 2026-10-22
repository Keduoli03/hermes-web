# Private Dashboard Deployment

Hermes Web is the public application and authenticates its own users. Its server
connects to a private Hermes Dashboard for management and project chat, and to
the API Server for ordinary chat. Browser login does not supply a Dashboard
credential. Keep backend credentials on the server.

```text
Browser -> HTTPS -> Hermes Web (panel login)
                      -> private Dashboard (management + project WebSocket)
                      -> private API Server (ordinary chat)
```

## An Existing Public Dashboard

A Dashboard that redirects to Nous login is not an automatic local connection,
even when Hermes Web accesses it through 127.0.0.1. The backend's listen address
and `dashboard.public_url` both affect the authentication gate. Setting only
`HERMES_DASHBOARD_URL` in Hermes Web does not change the backend's auth mode.
A static native session token does not replace public Nous authentication.

Keep the existing public Dashboard and its authentication intact. Run a separate
private instance under the SAME Hermes OS user and profile/home so it sees the
same saved sessions, skills and configuration. This does not copy or synchronize
data between different machines or profiles. Use an unused port, such as 8649:

```bash
# Linux: run as the existing Hermes service user, with its existing HERMES_HOME.
HERMES_DASHBOARD_PUBLIC_URL=http://127.0.0.1:8649 \
  hermes dashboard --host 127.0.0.1 --port 8649 --isolated --no-open
```

Verify the effective public URL after startup: some Hermes CLI versions reload
`HERMES_HOME/.env` and replace the process-local override with the stored value.
An external `HERMES_DASHBOARD_PUBLIC_URL` there can therefore keep the private
instance behind OAuth. When retiring the public Dashboard, update its stored
public URL to the private loopback origin too, using Hermes' environment writer.
If the public Dashboard must remain active, use per-instance configuration
supported by the installed Hermes version; do not change its shared auth settings.

`--isolated` keeps this instance independent of the existing Dashboard. Do not use
`--insecure`, change the public service's auth,
or expose the private port through a firewall, reverse proxy or tunnel. Do not
start an additional messaging gateway just to connect this panel.

Check that the installed Hermes supports these flags with `hermes dashboard --help`.
Use the exact Hermes executable and profile/home of the existing service; starting
as another user with a fresh home results in a different installation's data.

## Hermes Web Configuration

Set these values in the Hermes Web service environment or ignored `.env.local`:

```dotenv
HERMES_DASHBOARD_URL=http://127.0.0.1:8649
HERMES_DASHBOARD_SESSION_TOKEN=
```

Remove any old explicit Dashboard token from the process manager too, then restart
Hermes Web. An explicit token is authoritative and is never silently replaced by
a discovered token. Leave the working `HERMES_API_SERVER_URL` and `API_SERVER_KEY`
as they are; they authenticate a separate connection.

Keep a panel login configured. For a password-based installation:

```dotenv
PI_WEB_USERNAME=admin
PI_WEB_PASSWORD=replace-with-a-long-random-password
PI_WEB_ALLOWED_HOSTS=your-domain.example
```

Alternatively configure this panel's separate Nous registration as described in
[Nous Official Login](hermes-official-login.md). The panel's public OAuth callback
does not belong to the private backend.

The two services must share a network namespace for 127.0.0.1 to connect them.
If Docker is involved, a container's loopback is not the host's loopback. Plan
their private networking before enabling automatic connection; the current
automatic handshake intentionally supports exact loopback origins only.

## Keep the Private Instance Running

Use [the systemd template](../deploy/systemd/hermes-web-dashboard.service.example).
Replace `@HERMES_USER@`, `@HERMES_HOME@` and `@HERMES_BIN@` with the existing service
user, absolute profile/home and absolute Hermes executable. Change the private
port in BOTH the template and Hermes Web configuration if 8649 is occupied.

For paths containing spaces, quote the path value in `WorkingDirectory` and the
executable path in `ExecStart`, leaving command arguments outside those quotes. Review
the resolved unit before installing it as `/etc/systemd/system/hermes-web-dashboard.service`.
Then run on the deployment host:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now hermes-web-dashboard.service
sudo systemctl status hermes-web-dashboard.service
```

Use the existing process manager to restart Hermes Web after changing its
environment. This repository does not automatically install or start host services.
All tabs share one Hermes backend; panel accounts do not isolate OS access or data.

## Verification

1. Check `ss -ltnp` on the host: the private port must listen on 127.0.0.1 only.
2. Check the private homepage without printing its credential-bearing HTML:

   ```bash
   curl --noproxy '*' -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8649/
   ```

   A 200 is necessary but not sufficient. A redirect means the backend auth or
   address configuration is still unsuitable for the local handshake.
3. Sign in to Hermes Web and reconnect in Account and access. Management HTTP,
   the ordinary-chat API and native project WebSocket each show an independent
   status. The server checks the read-only config schema, API model catalogue
   and `gateway.ping` RPC. These checks never run inference or create a session.
4. Read Skills and Cron, then select a project directory to verify the native
   WebSocket connection. A working ordinary chat alone proves only API Server
   connectivity. A genuine model run is a separate, potentially billable check.
5. Restart the private Dashboard and reconnect to confirm automatic recovery.

Connection diagnostics distinguish redirects, missing or invalid handshakes,
backend unavailability and rejected credentials. They never return the upstream
login URL, its query parameters, HTML or backend credentials to the browser.

Protocol references: official Hermes `hermes_cli/web_server.py`,
`hermes_cli/web_server_chat.py`, and `website/docs/user-guide/features/web-dashboard.md`.
Confirm the installed Hermes version before deploying; this repository's tests
use deterministic backend fixtures and do not verify the deployment host.

## Production WebSocket Dependencies

Keep `ws` in `serverExternalPackages` so Node loads its optional native helpers
normally. Bundling those helpers can produce a stub and fail while masking an
outgoing frame (`mask is not a function`), leaving project RPCs waiting until
their timeout even though the connection opened.

For an existing affected build, install the systemd drop-in from
`deploy/systemd/hermes-web-websocket.conf.example` on the Hermes Web service,
reload systemd and restart that service. It disables the optional accelerators
and uses the supported JavaScript implementation without rebuilding the live
application. Verify a project-folder RPC and an actual streamed reply afterward.
