# Phase 2 troubleshooting

## Cold-start latency is annoying

The Cloud Run service is configured with `min_instance_count = 0` to keep cost at zero when idle. First request after an idle period takes 2–4 seconds (Node startup + first JWKS fetch + first CouchDB connection). Subsequent requests on the same instance are sub-100ms.

If this annoys you in practice, set the minimum to 1:

```
gcloud run services update obsidian-mcp \
  --project=<project> --region=<region> \
  --min-instances=1
```

Cost: roughly $5–10/month for an always-warm instance with `cpu_idle = true`. Reverse with `--min-instances=0`.

## OAuth flow fails before reaching Google

| Symptom | Likely cause |
| --- | --- |
| `HTTP/2 404` on `/.well-known/oauth-authorization-server` | Cloud Run domain mapping cert isn't ready yet, OR the Cloudflare DNS record is proxied (orange cloud) instead of DNS-only. `dig mcp.<domain> CNAME` should resolve to `ghs.googlehosted.com`, not a Cloudflare IP. |
| `/authorize` returns `HTTP/2 400 invalid_request` | One of the required PKCE/OAuth params is missing or wrong. Server logs show the specific reason. Check Claude's request — `code_challenge` and `code_challenge_method=S256` are mandatory. |
| `/authorize` redirects to Google but Google rejects with `Error 400: redirect_uri_mismatch` | The `GOOGLE_OAUTH_REDIRECT_URI` env var doesn't match what's registered in the Google OAuth client. They have to be character-identical, including the scheme and trailing slash. |

## Google sign-in fails

| Symptom | Likely cause |
| --- | --- |
| Google shows `Access blocked: This app's request is invalid` | The OAuth consent screen is in Testing mode and your email isn't on the test users list. Add it under APIs & Services → OAuth consent screen → Test users. |
| Google sign-in succeeds but the callback returns `403 access_denied: email "x@y.com" is not in the allow-list` | Your authenticated email isn't in `mcp_allowed_emails`. Add it to tfvars and `terraform apply` to update the env var on Cloud Run. The allow-list is case-insensitive. |
| Callback returns `500 server_error: google code exchange failed: google /token returned 401` | The `obsidian-mcp-google-oauth-client-secret` Secret Manager value doesn't match the secret Google issued. Re-fetch the client secret from GCP Console → APIs & Services → Credentials → your OAuth client → Reset secret if needed, then push it to Secret Manager and roll the Cloud Run revision. |
| Callback succeeds but redirects with `error=access_denied` to Claude's redirect URI | Same as above (allow-list mismatch). The standard OAuth error is forwarded to the client. |

## /token endpoint failures

| Symptom | Likely cause |
| --- | --- |
| `HTTP/2 400 invalid_grant: PKCE verification failed` | Claude's `code_verifier` doesn't hash to the `code_challenge` we recorded at `/authorize`. Almost always a client bug. Verify by inspecting Claude's request body. |
| `HTTP/2 400 invalid_grant: wrong token type: expected "authorization_code", got "access_token"` | Claude is presenting a token of the wrong type. Indicates a serious client bug or an attacker. Check logs. |
| `HTTP/2 400 invalid_grant: redirect_uri does not match` | The `redirect_uri` Claude sent at /token differs from the one it sent at /authorize. They have to match exactly. |
| `HTTP/2 400 invalid_grant: JWT verification failed: ...exp...` | The authorization code expired (default TTL is 60 seconds). The user took too long to complete the Google sign-in. Retry the dance. Or bump `OAUTH_AUTHORIZATION_CODE_TTL_S`. |

## /mcp returns 401 every time, even with a fresh token

| Symptom | Likely cause |
| --- | --- |
| 401 with `WWW-Authenticate: Bearer resource_metadata=...` and no body claim | Token is missing or doesn't parse as `Bearer <token>`. Likely client error. |
| 401 with body `OAuth token rejected: JWT verification failed: signature` | The signing key was rotated since the token was issued. Re-authenticate (Claude should do this automatically on the next request). |
| 401 with body `OAuth token rejected: unexpected issuer` or `unexpected audience` | The `OAUTH_ISSUER` env var was changed since the token was issued, or the token wasn't issued by us. Tokens carry the issuer at the time of issuance. |
| 401 with body `OAuth token rejected: wrong token type: expected "access_token"` | Claude is sending the refresh token in `Authorization: Bearer …` instead of the access token. Client bug — refresh tokens go to /token, not /mcp. |

## CouchDB user permission errors

| Symptom | Likely cause |
| --- | --- |
| `CouchDbError { status: 401, op: "getDoc" }` | The MCP user's password in Secret Manager doesn't match what's in `_users` on CouchDB. Re-run `scripts/obsidian-mcp/create-couchdb-user.sh`. |
| `CouchDbError { status: 403 }` on writes only | The MCP user is in `members` but the database has no `_security` doc, or the doc doesn't list this user. Re-run the script. |
| `CouchDbError { status: 401 }` on `getDocs` (bulk) but not `getDoc` (single) | Rare; usually a stale cookie or session in `nano`. Restart the Cloud Run revision. |

## LiveSync decryption failures

| Symptom | Likely cause |
| --- | --- |
| All reads return `DecryptionError` | The `LIVESYNC_PASSPHRASE` in Secret Manager doesn't match the passphrase in the LiveSync plugin. Re-populate the secret per [setup.md](setup.md) §2 and roll the Cloud Run revision. |
| Some reads return `DecryptionError`, others succeed | Mixed encryption formats. Newer notes use HKDF (`%$`), some older notes might use V2 (`%`) or V3 (`%~`). The server tries all three; if one specific note fails, the chunk's encryption format may have changed mid-write. Open the note in Obsidian and re-save to force re-encryption. |
| `DecryptionError: HKDF fixed-salt format ('%=') is not supported` | The vault uses the fixed-salt HKDF variant. The server only handles ephemeral-salt HKDF (LiveSync's current default). Either re-encrypt the vault from the LiveSync plugin or extend the server to handle the fixed-salt format (it requires retrieving the salt from the LiveSync sync-parameters doc). |
| Reads succeed but bodies look like garbled markdown | The chunking is wrong. Almost certainly a LiveSync chunk-format change — see "LiveSync chunking format may have evolved" below. |

## LiveSync chunking format may have evolved

The server's chunking + path-obfuscation logic (split across [services/obsidian-mcp/src/couchdb/path2id/](../../services/obsidian-mcp/src/couchdb/path2id/), [splitIntoChunks/](../../services/obsidian-mcp/src/couchdb/splitIntoChunks/), [chunkId/](../../services/obsidian-mcp/src/couchdb/chunkId/), [decryptField/](../../services/obsidian-mcp/src/couchdb/decryptField/), and [encryptField/](../../services/obsidian-mcp/src/couchdb/encryptField/), with format constants in [constants.ts](../../services/obsidian-mcp/src/couchdb/constants.ts)) is faithful to LiveSync as of:

- `octagonal-wheels` v0.1.45 (the npm dependency)
- `vrtmrz/obsidian-livesync` ~v0.23.x (the plugin family)

If you upgrade the LiveSync plugin in the clients past a major version, expect to re-test the round trip. Watch for `DecryptionError`, blank bodies on read, or notes that vanish from `list_notes` after a re-save in the plugin.

Recovery recipe:

1. Identify the new plugin version. Check `vrtmrz/obsidian-livesync` releases for chunk-format changes.
2. Bump `octagonal-wheels` in [services/obsidian-mcp/package.json](../../services/obsidian-mcp/package.json) to the version the plugin depends on.
3. If the chunk-splitting algorithm changed (vs. just the encryption format), update [services/obsidian-mcp/src/couchdb/splitIntoChunks/](../../services/obsidian-mcp/src/couchdb/splitIntoChunks/). If the encryption-format prefixes evolved, update [services/obsidian-mcp/src/couchdb/decryptField/](../../services/obsidian-mcp/src/couchdb/decryptField/) and [services/obsidian-mcp/src/couchdb/constants.ts](../../services/obsidian-mcp/src/couchdb/constants.ts).
4. Update or extend the co-located tests in those folders to cover the new format.
5. Round-trip test: create a note via `create_note`, open it in Obsidian, edit, save, then re-read via `read_note`. Body should match.

## Changes feed disconnects

Symptom: search results lag behind reality (notes you just edited don't show up in `search_notes`), but `list_recent_changes` returns the right `mtime`.

Cause: the `_changes` feed connection from the MCP server to CouchDB has dropped and the search index isn't being marked dirty. The reconnect is supposed to be automatic with backoff, but a long network partition can stall it. After the 60-second retry budget is exhausted, the daemon fiber dies — look for `changes feed retries exhausted, daemon exiting` in Cloud Run logs.

Fix:

```
gcloud run services update obsidian-mcp \
  --project=<project> --region=<region> \
  --update-env-vars=BUMP=$(date +%s)
```

(The `BUMP` env-var trick rolls a new revision without changing the image. Cloud Run treats that as a config change and restarts.)

If it happens often, check the cloudflared logs on the e2-micro for tunnel flapping, and the CouchDB logs for `_changes` errors.

## Search index out of date

Same root cause as above (changes-feed disconnect), with a different symptom. The index rebuild is debounced 5 seconds — if you're seeing >5s lag on searches and the changes feed is healthy, it might be a longer rebuild than expected for a large vault. Bump the debounce interval down via the `SEARCH_REBUILD_DEBOUNCE_MS` env var:

```
gcloud run services update obsidian-mcp \
  --project=<project> --region=<region> \
  --update-env-vars=SEARCH_REBUILD_DEBOUNCE_MS=2000
```

## OAuth signing key rotation

Two-step procedure:

1. Generate a new key and push as a new secret version:
   ```
   scripts/obsidian-mcp/generate-oauth-key.sh --project=<project>
   ```
2. Roll the Cloud Run revision to pick up the new value:
   ```
   gcloud run services update obsidian-mcp \
     --project=<project> --region=<region> \
     --update-env-vars=BUMP=$(date +%s)
   ```
3. **All connected Claude clients must re-authenticate** — the kid in their existing access tokens no longer matches what the server is signing with. Claude should detect this on the next 401 and start a fresh OAuth dance.
4. Disable the old key version once everything's swung:
   ```
   gcloud secrets versions disable <old-version> --secret=obsidian-mcp-oauth-signing-key \
     --project=<project>
   ```

This is also the recovery path on suspected token compromise — there's no per-token revocation list, so rotating the key is the only way to invalidate a leaked token.

## Cert provisioning is stuck

The Google-managed certificate for `mcp.<domain>` is provisioned automatically when the domain mapping is created and the DNS record resolves. It usually takes 15–30 minutes; sometimes longer for first-time provisioning.

```
gcloud run domain-mappings describe \
  --domain=mcp.<your-domain> --region=<region> --project=<project>
```

If `status.conditions` shows `CertificateProvisioned: False` for more than an hour, check:

- DNS resolution: `dig mcp.<domain> CNAME` should return `ghs.googlehosted.com`. If it returns a Cloudflare IP (104.x.x.x), the Cloudflare DNS record is proxied — flip it to DNS-only (gray cloud) in the Cloudflare dashboard.
- DNS propagation: from a cold network (mobile data, not your home Wi-Fi which may be cached), `dig` should also return `ghs.googlehosted.com`. Cloudflare propagation is fast but not instant.
- ACME challenge: Google completes the cert validation by serving a challenge response over HTTP. If anything is intercepting `mcp.<domain>` (a stale Cloudflare proxy, a different DNS provider, etc.), the challenge fails silently.

## "I want to start over"

If something has gone deeply wrong with the MCP server (corrupt state, broken config, stuck revisions):

1. `terraform destroy -target=google_cloud_run_v2_service.obsidian_mcp -target=google_cloud_run_domain_mapping.mcp`. Removes the Cloud Run service, IAM binding, and domain mapping; secrets, the Artifact Registry repo, the service account, and the DNS record stay.
2. `terraform apply` to re-create them with the placeholder image.
3. Re-run `scripts/obsidian-mcp/deploy.sh` to push the real image.
4. Wait again for the cert to provision (15–30 min).
5. The CouchDB data, the LiveSync passphrase, the OAuth signing key, the Google client secret, and the email allow-list all survive — you don't have to redo any of that.

If you want to rotate the OAuth signing key while you're at it, do steps 1–4 above and then the rotation procedure earlier in this doc.
