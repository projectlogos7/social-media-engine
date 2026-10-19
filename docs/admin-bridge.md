# Admin Bridge contract (v1)

The admin console never touches a project's database. Each project exposes a small,
signed HTTP API — the **admin bridge** — and the console calls it. A project keeps
its own login, roles and audit log; the bridge only lets the console read and change
them on behalf of a named console admin.

## Enabling

A project enables the bridge by setting one environment variable:

| Variable | Meaning |
| --- | --- |
| `ADMIN_BRIDGE_SECRET` | Shared HMAC secret, at least 32 characters. Generate with `openssl rand -base64 48`. |

When the variable is unset (or shorter than 32 characters) every bridge route answers
`404`, so the bridge is off by default.

The same secret is entered in the console when the project is registered. The console
stores it encrypted (AES-256-GCM).

## Base path

All routes live under `/admin-bridge/v1` on the project's API host. For example:

- ISMII: `https://api.ismii.org/admin-bridge/v1`
- Nous: `https://nousnetwork.org/admin-bridge/v1`
- Outreach: `https://<outreach-api-host>/admin-bridge/v1`

## Request signing

Every request carries three headers:

```
X-Bridge-Timestamp: 1760870400            # unix seconds
X-Bridge-Actor: alice@example.org         # console admin acting; for the project's audit log
X-Bridge-Signature: v1=<hex>
```

The signature is computed as follows:

```
payload   = timestamp + "\n" + METHOD + "\n" + pathWithQuery + "\n" + sha256hex(rawBody)
signature = hex(HMAC_SHA256(ADMIN_BRIDGE_SECRET, payload))
```

- `pathWithQuery` is the request path as sent, starting at `/admin-bridge/...`, with
  the query string if any (e.g. `/admin-bridge/v1/users?search=ali`). If a reverse
  proxy strips a prefix, the project must reconstruct the original path.
- `rawBody` is the exact body bytes. An empty body hashes the empty string.
- `X-Bridge-Actor` is not signed. The project only records it for audit; it does not
  trust it for authorization.

The project must:

1. Reject requests where `|now − timestamp| > 300` seconds (`401`).
2. Compare signatures in constant time (`401` on mismatch).
3. Rate-limit the bridge (about 120 requests per minute is plenty).
4. Write an audit entry for every state change, naming the actor as
   `admin-bridge:<X-Bridge-Actor>`.

Reference verifier (Node):

```ts
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export function verifyBridge(secret: string, method: string, pathWithQuery: string, rawBody: string | Buffer,
                             ts: string | undefined, sig: string | undefined): boolean {
  if (!ts || !sig?.startsWith('v1=')) return false;
  const t = Number(ts);
  if (!Number.isFinite(t) || Math.abs(Date.now() / 1000 - t) > 300) return false;
  const bodyHash = createHash('sha256').update(rawBody ?? '').digest('hex');
  const expected = createHmac('sha256', secret).update(`${ts}\n${method.toUpperCase()}\n${pathWithQuery}\n${bodyHash}`).digest();
  const given = Buffer.from(sig.slice(3), 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}
```

## Errors

Every non-2xx response has this body:

```json
{ "error": { "code": "not_found", "message": "User not found." } }
```

Codes: `bad_request` (400), `unauthorized` (401), `forbidden` (403), `not_found` (404),
`conflict` (409), `unprocessable` (422), `unsupported` (501).

## Types

```ts
type BridgeUser = {
  id: string;
  email: string;
  name: string;
  status: 'active' | 'invited' | 'disabled';
  roles: string[];              // role keys; exactly one entry when meta.multiRole is false
  mfaEnabled: boolean | null;   // null when the project has no MFA
  lastLoginAt: string | null;   // ISO 8601
  createdAt: string;            // ISO 8601
};

type BridgeApiKey = {
  id: string;
  name: string;
  prefix: string;               // first characters of the key, safe to show
  scopes: string[];             // empty = inherits the owner's permissions
  ownerUserId: string | null;
  ownerEmail: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
};
```

## Routes

### `GET /meta`

Returns the project's identity and what the console can do with it:

```json
{
  "contractVersion": 1,
  "project": { "key": "ismii", "name": "ISMII" },
  "roles": [{ "key": "super_admin", "name": "Super admin", "description": "…" }],
  "multiRole": true,
  "capabilities": {
    "invite": true,
    "revokeSessions": true,
    "apiKeys": true,
    "apiKeyOwnerRequired": false
  },
  "apiKeyScopes": [{ "key": "pages.edit", "description": "Edit pages" }]
}
```

- `apiKeys: false` means the console hides API keys for the project.
- `apiKeyOwnerRequired: true` means `POST /api-keys` must name an `ownerUserId`.
- An empty `apiKeyScopes` means keys can't be scoped and always inherit the owner's
  permissions.

### `GET /users?search=&limit=50&cursor=`

Returns `{ "items": BridgeUser[], "nextCursor": string | null }`.

- `search` matches email or name, case-insensitively.
- `limit` is at most 200.

### `GET /users/:id`

Returns a `BridgeUser`, or `404`.

### `POST /users`

Request:

```json
{ "email": "a@b.org", "name": "Alice", "roles": ["editor"], "sendInvite": true }
```

Creates the user, returning `201 { "user": BridgeUser, "inviteUrl": string | null }`.

- When `capabilities.invite` is true, the user starts as `invited`. The project emails
  the invite when `sendInvite` is true, and returns the one-time `inviteUrl` either way
  so the console admin can pass it on.
- Projects without invites create an `active` user who must reset their password.
- Returns `409` if the email already exists, and `422` for an unknown role.

### `PATCH /users/:id`

Request:

```json
{ "name": "…", "roles": ["…"], "status": "active" | "disabled" }
```

Every field is optional. Returns the updated `BridgeUser`.

- Setting `disabled` must also end the user's sessions and stop their API keys from working.
- Projects must refuse (`403`) changes that would leave them with no active top-level
  admin. They should also enforce their own protected-role rules.

### `POST /users/:id/revoke-sessions`

Returns `{ "revoked": number }`. When sessions are stateless (JWT), the project should
invalidate them by other means (for example, rotating a per-user salt), or answer `501`.

### `GET /api-keys`

Returns `{ "items": BridgeApiKey[] }`, newest first, including revoked keys.

### `POST /api-keys`

Request:

```json
{ "name": "Zapier", "scopes": [], "ownerUserId": "…", "expiresAt": "2027-01-01T00:00:00Z" }
```

Returns `201 { "apiKey": BridgeApiKey, "secret": "<full key, shown once>" }`.

### `DELETE /api-keys/:id`

Revokes the key and returns the revoked `BridgeApiKey`. Revoking is idempotent.
