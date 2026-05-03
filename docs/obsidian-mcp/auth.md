# Auth: design, trust model, and how to migrate to a different OIDC provider

This document is written for **a future agent or human migrating the human-auth step away from Google OIDC** — likely to a self-hosted OIDC provider (Authentik, Keycloak), a hosted one (WorkOS, Clerk, Auth0, Microsoft Entra ID), or back to Cloudflare Access if that ever becomes attractive again. It is meant to be read as a self-contained document. You do not need to have read [setup.md](setup.md) first; cross-references are provided where useful.

If you are setting up the *current* (Google OIDC) auth from scratch, this is the wrong document — read [setup.md](setup.md) §4 for that. Implementation details of the OAuth server itself live in [oauth.md](oauth.md).

## 1. Why auth is structured this way

The MCP server is its own OAuth 2.1 + DCR + PKCE authorization server. It issues access tokens (JWTs) that gate `/mcp`. The authorization server itself delegates the *human authentication* step — "is this person actually them" — to an external OIDC provider, currently Google. Two pieces, separable:

```
Claude  ←──OAuth tokens──→  obsidian-mcp's OAuth server  ←──OIDC──→  Google
                                 (we own this)                       (swappable)
```

Everything downstream of the OAuth server — the MCP transport, the tool handlers, the CouchDB client, the search index — knows nothing about Google. They see only an authenticated `Identity { email, source }`. Replacing the OIDC provider is a matter of swapping the implementation of the `googleOidc/` sub-module (or adding a sibling sub-module and selecting between them in `handleAuthorize` / `handleGoogleCallback`).

Why this shape: the OAuth server has to be ours because Claude expects an OAuth 2.1 endpoint at the MCP host, with discovery and dynamic client registration per the MCP authorization spec. We can't outsource that — the resource server and the auth server share an origin in our deployment, and the discovery document advertises endpoints on `mcp.<domain>`. The IdP can be outsourced because the only thing we need from it is "this email belongs to a human who just proved their identity". Google's OIDC implementation does that fine; so does any other OIDC provider.

## 2. The trust model

The MCP server holds the LiveSync end-to-end encryption passphrase in Secret Manager and decrypts notes inside its own process before returning them to Claude. **Authentication to the server is the gate that protects the contents of your vault.** If the auth layer is misconfigured or bypassed, anyone reaching the endpoint can read every note.

Trust boundaries today, from outside to inside:

1. **Cloud Run's anycast frontend** terminates TLS for `mcp.<domain>` with a Google-managed cert. Cloud Run's invoker IAM is `allUsers` — auth is enforced inside the server.
2. **The OAuth server inside the container** validates that every `/mcp` request carries an access token JWT signed by our own RSA-2048 key, with the correct `iss`, `aud`, `exp`, and `type: "access_token"` claims. A bare request to `/mcp` returns 401 with a `WWW-Authenticate` header pointing at `/.well-known/oauth-protected-resource` — the protocol's "you need to start the OAuth dance" handshake.
3. **The OAuth server's `/authorize` flow** delegates human authentication to Google OIDC. After Google signs the user in and returns an `id_token`, we verify it against Google's JWKS, extract the `email` claim, and check it against the `mcp_allowed_emails` allow-list before issuing our own tokens. The list is the only thing standing between Google's billion accounts and your vault.
4. **The OAuth signing key** lives in Secret Manager and is mounted into the Cloud Run container at request time. Rotating it (re-running `generate-oauth-key.sh`) implicitly invalidates every token that's been issued, because the kid changes and validation fails.
5. **The Google OAuth client secret** also lives in Secret Manager. We use it to authenticate to Google's `/token` endpoint when exchanging the authorization code for an `id_token`. It's not a long-lived shared secret with users — it's a server-side credential between us and Google.

Any auth migration **MUST preserve at least these properties**:

- **Identity must be verified server-side, not trusted from a header.** Whichever OIDC provider you use, you have to verify the `id_token` against the provider's JWKS — never trust a forwarded "X-User-Email" header at face value.
- **The email allow-list stays.** Or some equivalent gating. An OIDC provider sign-in alone is not enough; we need a list of *which* identities are allowed.
- **The OAuth signing key's role doesn't change.** It signs every token we issue, including across an IdP migration. The IdP swap doesn't touch it.
- **PKCE on `/authorize` stays mandatory.** It's the security boundary for public clients (Claude). Removing it would be a regression even if the IdP is more trustworthy.

## 3. What an authenticated request looks like today

This is the wire format you need to reproduce, or to verify against, when writing a new IdP integration.

A fully-authenticated `/mcp` request:

```
POST /mcp HTTP/2
Host: mcp.<your-domain>
Authorization: Bearer <access_token>
Content-Type: application/json
Accept: application/json, text/event-stream

{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{...}}
```

The `<access_token>` is a compact JWS (three base64url segments separated by dots) with this payload:

| Field | Value |
| --- | --- |
| `alg` (header) | `RS256` |
| `kid` (header) | RFC 7638 thumbprint of our public key |
| `iss` | `OAUTH_ISSUER` — `https://mcp.<domain>` |
| `aud` | Same as `iss` |
| `sub` | The authenticated user's email |
| `exp` | Unix epoch seconds, 1 hour after issuance by default |
| `iat` | Unix epoch seconds, issuance time |
| `type` | `"access_token"` (our discriminator; rejecting refresh tokens here) |

The signing key is published as a JWKS at `https://mcp.<domain>/.well-known/jwks.json`. Validation rules the server applies (see [services/obsidian-mcp/src/oauth/decodeAccessToken/](../../services/obsidian-mcp/src/oauth/decodeAccessToken/)):

- Algorithm must be `RS256`. Other algs are rejected.
- Signature verifies against the public JWK (same key, kid matches).
- `iss` matches the configured `OAUTH_ISSUER`.
- `aud` matches the issuer.
- `exp` and `nbf` are honoured by the `jose` library.
- `type` claim must be `"access_token"`. A refresh token presented here is rejected.

The OAuth flow that produced this token:

1. Claude → `GET /authorize?response_type=code&client_id=…&redirect_uri=…&code_challenge=…&code_challenge_method=S256&state=…`
2. Server validates the params, signs a `google_state` JWT carrying the resumption payload, redirects to `https://accounts.google.com/o/oauth2/v2/auth?…&state=<google_state_jwt>`.
3. User signs in with Google. Google redirects to `https://mcp.<domain>/oauth/google/callback?code=…&state=…`.
4. Server decodes the `google_state`, exchanges Google's `code` for an `id_token` at `https://oauth2.googleapis.com/token`, verifies the `id_token` against Google's JWKS (`https://www.googleapis.com/oauth2/v3/certs`), extracts `email`, checks it against `ALLOWED_EMAILS`.
5. Server signs an `authorization_code` JWT carrying `{ email, code_challenge, redirect_uri, client_id }` and redirects to Claude's `redirect_uri` with `code=<jwt>&state=<original-state>`.
6. Claude → `POST /token` with `grant_type=authorization_code&code=…&code_verifier=…&redirect_uri=…&client_id=…`.
7. Server decodes the code, verifies PKCE (`SHA256(code_verifier) == code_challenge`), checks redirect_uri match, signs the access + refresh tokens.

## 4. Migration recipe

The general shape of an OIDC-provider migration:

1. **Build a new sub-module** at `services/obsidian-mcp/src/oauth/<yourProvider>Oidc/` with the same three exports as the existing `googleOidc/`:
   - `buildAuthUrl(...)` — assemble the URL we redirect the user to.
   - `exchangeAuthCode(...)` — POST the IdP's token endpoint with the code.
   - `verifyIdToken(...)` — verify the IdP's id_token against its JWKS, return the email.
2. **Update the handlers**. `handleAuthorize` and `handleGoogleCallback` (rename it to `handleOidcCallback` if you want; the handler is generic enough) wire the dependencies through. The handlers don't import from `googleOidc/` directly today — they take a deps argument — so the swap is in `main.ts` where the deps are constructed.
3. **Update the Terraform** to replace `google_oauth_client_id` and `obsidian-mcp-google-oauth-client-secret` with whatever your IdP needs (often: client_id, client_secret, JWKS URL, issuer URL, sometimes a tenant ID).
4. **Update env vars** in [terraform/obsidian-mcp.tf](../../terraform/obsidian-mcp.tf): drop `GOOGLE_OAUTH_*`, add the equivalents.
5. **Update the redirect URI** registered with the new IdP. Same shape: `https://mcp.<domain>/oauth/<idp>/callback` (or rename to `/oauth/callback` if you want a generic path).
6. **Update [setup.md](setup.md) §4** with the new IdP-setup steps.

The migration should be doable in a single PR. The OAuth server itself, the token shapes, the discovery documents, and the AuthProvider abstraction don't change — only the IdP-facing sub-module and a slice of config.

## 5. Concrete migration sketches

These are starting points, not full implementations. Each one names the moving parts; consult the upstream provider's documentation for current API specifics before cutting code.

### 5.1 Self-hosted OIDC (Authentik or Keycloak)

If you want full provider portability with no third-party dependency, you can run Authentik (or Keycloak) on the same e2-micro (it's resource-tight but doable for personal use) or a second free-tier-eligible VM.

What changes in infrastructure:

- Add Authentik to the docker-compose stack on the VM, or stand up a second VM. Expose Authentik through a third Cloudflare Tunnel ingress (`auth.<domain>`).
- Configure an OIDC application in Authentik for the MCP server. Capture the client ID, client secret, JWKS URL, issuer URL.

What changes in the server:

- New sub-module `src/oauth/authentikOidc/` with the three functions, pointed at Authentik's endpoints instead of Google's.
- Drop `GOOGLE_OAUTH_*` env vars; add `AUTHENTIK_OIDC_CLIENT_ID`, `AUTHENTIK_OIDC_CLIENT_SECRET` (Secret Manager), `AUTHENTIK_OIDC_ISSUER`, `AUTHENTIK_OIDC_REDIRECT_URI`.
- Update `oauth/handlers/handleAuthorize/` and `handleGoogleCallback/` to use the new sub-module's `buildAuthUrl` / `exchangeAuthCode` / `verifyIdToken`. Or, if you like, rename them to `handleOidcCallback` and parameterize on the sub-module.

What changes for clients: nothing. The OAuth dance Claude does is identical — only the human-auth screen they see during `/authorize` changes.

Trade-offs: full portability, no vendor lock-in. The operational burden is real — Authentik wants its own Postgres or SQLite, regular updates, certificate management. If you're already running other self-hosted services, this is comfortable. If not, it's the most expensive option in operator time.

### 5.2 Hosted OIDC (WorkOS, Clerk, Auth0, Microsoft Entra ID)

Mechanically identical to the Authentik path — the only differences are the endpoint URLs and that someone else operates the IdP. The differences are operational: someone else runs the IdP, you pay them per active user (varies wildly), you give up on using auth as a portability lever.

This path is mostly interesting if you already use the hosted provider for other services. For a personal infra project, the Google or self-hosted paths are usually simpler.

### 5.3 Back to Cloudflare Access

If for some reason the original Cloudflare Access path becomes attractive again (free tier limits expand, you migrate other services back to CF, etc.), the integration looks like a Cloudflare-Access-as-OIDC-provider setup:

- Configure Cloudflare Access in IdP mode for an Access application (Access → Applications → SaaS application → OIDC).
- Capture client ID, client secret, JWKS URL, issuer URL.
- Build `src/oauth/cloudflareAccessOidc/`, point at CF's endpoints.

The main difference from Authentik: CF Access does the human-auth itself (any combination of email OTP, SSO providers, etc., per its policy). The MCP server doesn't see a redirect to a separate IdP; CF Access handles that internally and returns an OIDC `id_token` to us.

## 6. About the OAuth signing key

The OAuth signing key is the one piece of the auth stack that doesn't change across IdP migrations. Why it exists:

- **Origin-of-trust for our tokens.** Every JWT we issue (auth code, access, refresh, Google round-trip state) is signed with this key. The MCP server's `decodeAccessToken` only trusts JWTs we signed.
- **No external dependency.** The kid is published in our JWKS; there's no third-party JWKS we depend on for *our own* tokens (only for the Google `id_token` during /authorize).
- **Rotation is the revocation story.** We don't keep a token-revocation list. Rotating the signing key invalidates everything immediately — the new kid doesn't match any issued token's header, signature verification fails, clients re-auth.

Rotation procedure:

1. `scripts/obsidian-mcp/generate-oauth-key.sh --project=<project>` — generates a fresh RSA-2048 PKCS#8 PEM and pushes it as a new Secret Manager version.
2. Roll the Cloud Run revision so the new value is mounted at process start (an existing revision keeps using the old value until it rotates):
   ```
   gcloud run services update obsidian-mcp \
     --project=<project> --region=<region> \
     --update-env-vars=BUMP=$(date +%s)
   ```
3. Connected Claude clients re-authenticate transparently the next time they hit `/mcp` and get a 401.
4. Once everything's swung, disable the old version: `gcloud secrets versions disable <previous-version> --secret=obsidian-mcp-oauth-signing-key --project=<project>`.

## 7. The client side

The client side is unchanged across IdP migrations. Claude on web, iPad, and iPhone all do the standard MCP OAuth dance:

- Discover endpoints from `/.well-known/oauth-protected-resource` and `/.well-known/oauth-authorization-server`.
- Register dynamically at `/register` (gets back a deterministic client_id).
- Open `/authorize` in a browser, complete the IdP sign-in (currently Google), get redirected back with a code.
- Exchange the code at `/token` for access + refresh tokens.
- Send the access token in `Authorization: Bearer …` on every `/mcp` request.
- Refresh transparently when access tokens expire.

The IdP swap is invisible to Claude; the user just sees a different sign-in screen during `/authorize`.

## 8. When to consider migrating

Operational signals that say "now's a good time to walk through this document":

- **Google's OAuth consent screen workflow becomes painful.** Currently if your app is in "Testing" mode, you have to add every user as a test user; if you publish, Google may require app verification for sensitive scopes. We use only `openid email`, which is non-sensitive, so this should stay simple — but if Google tightens the rules, an alternative IdP is an escape hatch.
- **You want zero third-party dependencies in the auth path.** Self-hosted OIDC removes Google. The operational cost is real.
- **You're standardizing on a different IdP for other services.** Wiring the MCP server to the same provider keeps SSO consistent across your infra.

If none of those apply, the current Google OIDC setup is doing its job and the abstraction is paying its rent purely as insurance. Leave it.
