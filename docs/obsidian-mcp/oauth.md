# OAuth implementation reference

This document is the implementation-side companion to [auth.md](auth.md). Auth.md is for the operator considering swapping the IdP; this is for the engineer reading the OAuth code and wanting to understand how it fits together. Read both if you're doing significant work on the auth layer.

## What we built

A minimal but spec-compliant OAuth 2.1 + DCR + PKCE authorization server, embedded in the same Cloud Run process as the MCP service it protects. Stateless — every token is a self-contained signed JWT, no database. Google is the OIDC identity provider for the human-auth step at `/authorize`.

Endpoints:

| Path | Method | Auth | Purpose |
| --- | --- | --- | --- |
| `/.well-known/oauth-protected-resource` | GET | none | RFC 9728 metadata |
| `/.well-known/oauth-authorization-server` | GET | none | RFC 8414 metadata |
| `/.well-known/jwks.json` | GET | none | Public key for token verification |
| `/register` | POST | none | RFC 7591 dynamic client registration |
| `/authorize` | GET | none | OAuth authorization endpoint; redirects to Google |
| `/oauth/google/callback` | GET | implicit (the state JWT) | Google's redirect target |
| `/token` | POST | PKCE | Exchanges code or refresh token for tokens |
| `/mcp` | POST | OAuth bearer | The MCP transport |
| `/health` | GET | none | Cloud Run liveness probe |

## Why no state store

OAuth normally needs persistent storage for client registrations, authorization codes, and refresh tokens. We have none of that. Instead:

- **Client registrations** → deterministic `client_id` from a hash of the metadata. Re-registering returns the same id; no record to remember. PKCE is the security boundary, not client authentication.
- **Authorization codes** → short-lived (60s) signed JWTs containing the user identity, PKCE challenge, redirect URI, and client_id. Validating the code is a JWT verification, not a DB lookup.
- **Access tokens** → 1-hour signed JWTs.
- **Refresh tokens** → 30-day signed JWTs.
- **Google round-trip state** → 10-minute signed JWT carrying the resumption payload across the Google OIDC redirect.

The trade-off: no per-token revocation. To kill all tokens at once, rotate the signing key (`scripts/obsidian-mcp/generate-oauth-key.sh`), which changes the kid and invalidates everything. There is no `/revoke` endpoint.

For personal infra, this is the right trade-off. Adding state would mean a Firestore database or Redis or similar, with all the operational overhead of "another moving part" — and we'd gain only fine-grained revocation, which we don't have a strong need for.

## Token shape

Every token we issue carries a `type` discriminator in its payload. This is belt-and-braces against an attacker swapping a refresh token into a place that expects an access token (or similar). The discriminator is checked by every decoder and is independent of the JWT signature.

```ts
interface AuthorizationCodePayload {
  type: "authorization_code";
  email: string;
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: string;
}

interface AccessTokenPayload {
  type: "access_token";
  sub: string;     // email
  iss: string;     // OAUTH_ISSUER
  aud: string;     // same as iss
}

interface RefreshTokenPayload {
  type: "refresh_token";
  sub: string;
  iss: string;
  aud: string;
}

interface GoogleStatePayload {
  type: "google_state";
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: string;
  mcp_state: string;  // the state Claude sent us, echoed back later
}
```

All four are RS256-signed with the OAuth signing key. The `kid` in the JWT header is the RFC 7638 thumbprint of the public key — derived deterministically from the key, so rotating the key implicitly rotates the kid.

## File layout

The styleguide is strict about one public function per folder. The OAuth code follows it literally — many folders, each small. The shape:

```
src/oauth/
├── SigningKey/                        Effect Context tag
├── SigningKeyLayer/                   Layer that loads the PEM and provides SigningKey
├── encodeAuthorizationCode/           sign + return JWT
├── decodeAuthorizationCode/           verify + parse + assert type
├── encodeAccessToken/
├── decodeAccessToken/
├── encodeRefreshToken/
├── decodeRefreshToken/
├── encodeGoogleState/
├── decodeGoogleState/
├── verifyPkce/                        SHA256 challenge match
├── deterministicClientId/             hash client metadata → id
├── googleOidc/                        sub-module
│   ├── buildAuthUrl/                  pure: build the Google authorize URL
│   ├── exchangeAuthCode/              POST Google's /token
│   ├── verifyIdToken/                 verify Google id_token via Google JWKS
│   ├── constants.ts                   Google's endpoints + scopes
│   └── index.ts                       barrel
├── handlers/                          sub-module
│   ├── handleJwks/
│   ├── handleAuthorizationServerMetadata/
│   ├── handleProtectedResourceMetadata/
│   ├── handleRegister/
│   ├── handleAuthorize/
│   ├── handleGoogleCallback/
│   ├── handleToken/
│   └── index.ts                       barrel
├── types.ts                           shared types (payloads, HandlerResponse)
└── index.ts                           barrel
```

Auth provider:

```
src/auth/
├── AuthProvider/                      Effect Context tag (shared with everything downstream)
├── OAuthAuthProviderLayer/            validates access tokens via decodeAccessToken
├── types.ts
└── index.ts
```

The `OAuthAuthProviderLayer` is the only AuthProvider in the runtime. The Cloudflare Access path that used to live here (`CloudflareAccessAuthProviderLayer`, `DisabledAuthProviderLayer`, `verifyBearerToken`) was removed when the architecture pivoted; the `AuthProvider` Context tag stayed because it's still the seam between the auth boundary and downstream tools.

## Handler return shape

Every OAuth handler returns the same type:

```ts
type HandlerResponse =
  | { kind: "json"; status: number; body: unknown; headers?: Record<string, string> }
  | { kind: "redirect"; status: 302 | 303; location: string };
```

The handler is an `Effect` over this shape. `main.ts` runs it via `runtime.runPromiseExit` and adapts the Exit to the Node `ServerResponse`:

- `Success` → write the JSON body or set the Location header per `kind`.
- `Failure` with cause containing an `OAuthError` → render `{ error, error_description }` per RFC 6749 §5.2 with the appropriate status.
- Anything else → log `Cause.pretty` and return 500.

CORS headers are set on every response — Claude's web client makes cross-origin calls.

## The /authorize → /oauth/google/callback handoff

This is the one place where the OAuth flow gets non-obvious. Walking through it:

```
Claude
  │ GET /authorize?client_id=…&redirect_uri=https://claude.ai/api/mcp/auth_callback
  │       &code_challenge=…&code_challenge_method=S256&state=…
  ▼
handleAuthorize:
  - validates the request shape
  - signs a google_state JWT carrying { client_id, redirect_uri,
    code_challenge, code_challenge_method, mcp_state }
  - returns 302 to https://accounts.google.com/o/oauth2/v2/auth?
      client_id=<our google client id>&
      redirect_uri=https://mcp.<domain>/oauth/google/callback&
      response_type=code&
      scope=openid email&
      state=<the JWT we just signed>
       Claude follows the redirect; user signs in with Google.
       Google redirects back to /oauth/google/callback with its own ?code= and ?state= (the JWT we sent).
  ▼
handleGoogleCallback:
  - decodes the google_state JWT (this rejects tampering and replay outside the TTL)
  - exchanges Google's code for an id_token at https://oauth2.googleapis.com/token
    using our stored Google client_id + client_secret
  - verifies the id_token against Google's JWKS, extracts the email claim
  - checks the email against ALLOWED_EMAILS
  - signs an authorization_code JWT carrying { email, client_id, redirect_uri,
    code_challenge, code_challenge_method } from the original google_state
  - returns 302 to <claude redirect_uri>?code=<jwt>&state=<original mcp_state>
       Claude receives the code in its callback handler, then POSTs /token.
  ▼
handleToken:
  - decodes the authorization_code JWT
  - verifies PKCE: SHA256(code_verifier) === code_challenge
  - confirms the redirect_uri / client_id parameters match what the code was issued with
  - signs an access_token JWT and a refresh_token JWT
  - returns { access_token, refresh_token, token_type: "Bearer", expires_in }
```

The state JWT is the only thing that connects the two halves of the handoff. We don't store anything per-flow — the state carries everything we need to resume.

## Why deterministic client IDs

RFC 7591 says the server returns a `client_id` after registration. Normally the client_id is opaque (a UUID), and the server stores `(client_id, metadata)` so future flows can validate that the client_id is one we've seen.

We don't validate. The security boundary for public clients is PKCE: even if an attacker knows a valid client_id, they can't redeem a code without the matching code_verifier (which the legit client kept private). So we just hash the metadata and return that as the client_id. Same metadata in → same client_id out → idempotent registration. No state.

If we ever wanted client validation (paid tier, audit trail, etc.), we'd switch to opaque IDs + storage, and check the client_id at /authorize and /token.

## Why the email allow-list

Google's OIDC verifies that "this person owns this Gmail address". That's not enough for our gate — we need "this person owns *one of these specific* Gmail addresses". The `ALLOWED_EMAILS` env var carries the list. The check happens in `handleGoogleCallback` after `verifyIdToken` returns the email and before we issue an authorization code.

Allow-list is in env vars, not Secret Manager — it's not particularly sensitive (your email being on the list isn't a secret) and it benefits from being readable in the Cloud Run service description for ops checks.

If the list ever grows past ~10–20 emails, switch to a JSON config in Secret Manager. The server's `allowedEmailsConfig` parses a comma-separated string today; a JSON array would be a small change.

## Testing

Each function-folder has a co-located `index.test.ts` (per the styleguide). The tests follow these patterns:

- **Pure functions** (PKCE, deterministic client_id, build URL): exhaustive happy + edge cases. No mocking needed.
- **Token encoders/decoders**: round-trip via a real RSA key generated per-test (`generateKeyPair` from jose), assert the type discriminator + standard claims. Cross-type rejection: encode an access token and try to decode it as a refresh token, assert failure.
- **Google OIDC**: `exchangeAuthCode` mocks `globalThis.fetch`; `verifyIdToken` only exercises the failure path because verifying a real Google id_token requires a real Google sign-in. The handler tests at the next level up rely on the same mocking pattern.
- **Handlers**: validate the input-shape rejection paths exhaustively. The success path is trickier because the full flow involves Google round-trips; integration testing happens by deploy-and-curl, not unit tests.

There is no end-to-end test that exercises the full OAuth flow against a real Google account in CI. The reasoning: Google's consent screen requires interactive sign-in for new tokens, which doesn't fit a CI pipeline. Manual end-to-end is done as part of the [setup.md](setup.md) §8 verification.

## Observability

Every error path logs to stdout (Cloud Run captures stdout as structured logs). Specifically:

- Auth failures on `/mcp` → `console.warn` with the AuthError reason.
- OAuth failures on the OAuth endpoints → `console.warn` with the OAuthError code + description.
- Anything else → `console.error` with `Cause.pretty(cause)`.
- Transport errors after headers were already sent → `console.error` (we can't recover the response, but ops needs to know).
- Changes-feed retry exhaustion → `Effect.logError` (the daemon fiber would otherwise die silently).

The principle, from the project memory: **every error path produces a log line**. There are no silent failures. If you find one, it's a bug — fix it before shipping.

## What's intentionally not implemented

Things the OAuth spec covers that we deliberately don't:

- **`/revoke` endpoint.** Rotation of the signing key is the revocation story. We don't track per-token state.
- **Refresh-token rotation.** Each refresh issues a new access token but the same refresh token. Without storage, we can't enforce single-use of the old refresh token. The trade-off is theoretical: a leaked refresh token is valid for 30 days; rotation wouldn't help much without storage.
- **Token introspection (`/introspect`).** Self-validating JWTs don't need it.
- **Scopes.** We accept `scope=…` on /authorize and ignore it. There's only one resource (the MCP service), and it's all-or-nothing.
- **Client authentication.** All clients are public (no client_secret). PKCE is the security boundary.
- **Front-channel logout.** Not standard for MCP; clients manage their own session.

If any of these become genuinely needed, plan to add a state store at the same time — most of them are pointless without one.
