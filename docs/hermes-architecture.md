# Hermes Web Architecture

This application keeps the existing Pi-derived React interface and uses Hermes
as its agent runtime. UI preferences, panel authentication, backend credentials
and model-provider credentials have separate owners.

## Request Boundaries

```text
Browser
  -> Next proxy: validate Host/origin and authenticate panel access
  -> Route: repeat the shared authentication policy at the service boundary
  -> Hermes connection adapter: attach server-owned credentials
  -> Private Hermes Dashboard or API Server
```

`lib/web-request-auth.mjs` owns Cookie/Basic authentication and the shared
password throttle. `proxy.ts` uses it for navigation and API access;
`projectRequestDenied` is a compatibility alias of the same route guard.
Additional route checks are intentional: they enforce the same policy when a
handler is used directly, without relying on a browser or trusted header.
Browser Cookie and Authorization headers never become Hermes credentials.

## Login and Session Ownership

- `lib/web-auth.ts` owns password verification and the public panel-session API.
- `lib/web-auth-store.mjs` owns private, atomic auth records. Cookie values are
  random identifiers; record filenames hash those identifiers. No password,
  Portal access token or backend credential is stored in a session record.
- `lib/web-oauth.ts` owns the Nous authorization-code/PKCE exchange and JWT
  verification. `lib/web-oauth-store.mjs` owns one-use flows and official-account
  eligibility, using the shared record store.
- Both login methods issue `web.*` sessions under `HERMES_WEB_DATA_DIR/auth`.
  Logout deletes the session record, invalidating copied cookies and requests
  from other processes sharing the directory. Reads do not cache revocations.
- Password sessions last 30 days and bind to the current configured password
  and optional username. Changing either invalidates existing password sessions.
  Official sessions retain their token-expiry/eight-hour limit and allow-list.
- Old stateless `v1.*` password cookies require one new login after upgrading.
  Existing `nous.*` official sessions remain supported until their original
  expiry, subject to the current client ID and allowed-user checks.
- Basic auth remains an API compatibility mechanism, with the same rules at
  the Next proxy and all Hermes route guards. It does not log a browser into
  pages. Logout revokes a panel session, not the administrator's password.

Persist the private data directory when deploying. Sharing authentication
storage does not make chat event buffers or live WebSockets multi-process:
use one application process or route each active chat to its owning process.

## Configuration Ownership

| Owner | Configuration | Storage/access |
| --- | --- | --- |
| Web operator | Panel password, optional username, Nous registration and allowed hosts | Service environment; existing variable names retained |
| Web operator | Dashboard/API Server origins and service credentials | `lib/hermes-server-config.mjs`; server only |
| Hermes | Models, provider authorization, skills, tools, memory, profiles, schedules | Existing Hermes management APIs |
| Browser | Theme, language, display preferences, draft/recovery identifiers | Existing browser preference stores |

`lib/hermes-server-config.mjs` is the source of backend origins and configured
credentials. It validates HTTP(S) origins without URL userinfo, nested paths,
query parameters or fragments. A broken API Server setting must not prevent
an independently configured Dashboard from being diagnosed.

Existing environment variables remain compatible:

| Variable | Purpose | Default |
| --- | --- | --- |
| `HERMES_DASHBOARD_URL` | Management HTTP and native session WebSocket origin | `http://127.0.0.1:8648` |
| `HERMES_DASHBOARD_SESSION_TOKEN` | Explicit Dashboard service credential | Automatic loopback discovery when absent |
| `HERMES_DASHBOARD_SESSION_TOKEN_<profile>` | Existing profile-specific credential override | Global token fallback |
| `HERMES_API_SERVER_URL` | Ordinary-chat API Server origin | `http://127.0.0.1:8642` |
| `API_SERVER_KEY` | API Server bearer credential | Required for ordinary chat |
| `HERMES_WEB_DATA_DIR` | Private Web-owned state | `~/.hermes-web` |

The local Dashboard handshake remains bounded, deduplicated and validated on a
read-only endpoint. Explicit credentials are authoritative. Never replace a
rejected explicit token with a discovered one or replay a timed-out write.
See [Private Dashboard Deployment](hermes-private-dashboard.md) and
[Nous Login](hermes-official-login.md).

## Connection Diagnostics

Authenticated GET `/api/hermes-connection` reports three independent capabilities.
POST clears the cached Dashboard connection and repeats those checks.

| Field | Read-only probe | What success establishes |
| --- | --- | --- |
| `dashboard` | Dashboard `/api/config/schema` | Authenticated management HTTP access and a JSON object response |
| `api` | API Server `/v1/models` | Access to a JSON model catalogue using the configured bearer credential |
| `project` | Dashboard WebSocket `gateway.ping` | Native transport opens and answers a real RPC |

Checks run concurrently and use bounded requests; JSON bodies are capped at
2 MB. Diagnostics never create/resume a chat, change cwd, run inference or write
Hermes configuration. Responses contain classified errors, never raw upstream
URLs, redirect locations or credentials. `connected` means all three checks
succeeded. Individual results explain partial availability. A probe does not
prove model inference, a selected folder's access or terminal availability.

## Chat and Workspace Ownership

`lib/hermes-chat-client.ts` provides start, observe, stop, approval, clarification
and project-binding operations. The chat component owns user-visible state;
the client adapter owns transport-specific routes and payloads.

- Ordinary chat uses the API Server runs API. Accepted run identifiers are
  saved before opening events, so a stream failure cannot resend the prompt.
- Project chat uses the native Dashboard session bridge. It binds the real cwd
  and keeps durable session identities separate from runtime RPC identities.
- `lib/hermes-run-store.mjs` and `lib/hermes-run-stream.ts` retain their event
  buffering, replay, deduplication and cancellation responsibilities.
- Two transports remain because their upstream capabilities differ. They share
  a client contract; migrating both onto one runtime requires separate upstream
  capability verification, not adding an unsupported cwd field to `/v1/runs`.
- File browsing and terminals execute on the Web host. The straightforward
  deployment runs Web and Hermes on the same machine. Remote Hermes deployments
  require a genuinely shared filesystem and explicit path mapping. Mapping
  paths does not mount, synchronize or remotely execute a terminal.

Pi-derived UI components and file/terminal services remain reusable. Legacy Pi
agent APIs are not the Hermes runtime. Remove a legacy endpoint only after
auditing actual consumers and its independent compatibility tests.

## Reference and Verification

The reference checkout was `nesquena/hermes-webui` at
`e68f38327948ba5c480ae2a258881aa00497c1cf`:
its `api/auth.py`, `api/config.py` and `api/runtime_adapter.py` informed session
ownership, configuration discovery and the common runtime-operation contract.
This application retains its existing React styling and independent-service
deployment, rather than adopting the reference's default in-process Python agent.

Run the Hermes, web-auth, request-security and throttle tests, TypeScript and
ESLint. Browser fixtures cover account/connection states, ordinary/project chat,
recovery and responsive layouts. Fixture success is separate from a live Hermes
connection or real model run. Do not run `next build` alongside `next dev`.
