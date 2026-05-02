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

## Cloudflare Access policy misconfiguration symptoms

| Symptom | Likely cause |
| --- | --- |
| `HTTP/2 401` from Cloudflare with `cf-ray` header on every request, even with the right service token | The Service Auth policy doesn't list this token. Open the policy and add it. |
| `HTTP/2 200` from a curl with NO Cloudflare credentials (you forgot to add the headers) | The Access application isn't applied to `mcp.<domain>`. Re-check the application's domain field in the Zero Trust dashboard. |
| `HTTP/2 403` from the SERVER (not Cloudflare) with `AuthError: Cf-Access-Jwt-Assertion verification failed` | Likely AUD mismatch. Confirm `cloudflare_access_aud` in `terraform.tfvars` matches the application's AUD tag. |
| `HTTP/2 403` from the server with `AuthError: bearer token did not match` | The bearer in the request doesn't match Secret Manager. Re-fetch from Secret Manager; confirm there's no whitespace. |

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

Cause: the `_changes` feed connection from the MCP server to CouchDB has dropped and the search index isn't being marked dirty. The reconnect is supposed to be automatic with backoff, but a long network partition can stall it.

Fix:

```
# Restart the Cloud Run revision to re-establish the changes-feed connection.
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

## Bearer token rotation

Two-step procedure:

1. **Add a new Secret Manager version**:
   ```
   openssl rand -hex 24 | gcloud secrets versions add obsidian-mcp-bearer-token \
     --project=<project> --data-file=-
   ```
2. **Roll the Cloud Run revision** to pick up the new value:
   ```
   gcloud run services update obsidian-mcp \
     --project=<project> --region=<region> \
     --update-env-vars=BUMP=$(date +%s)
   ```
3. **Update the Claude connector** on every device (desktop, iPad, iPhone) with the new value. There's no central refresh.
4. **Disable the old version** once everything's swung:
   ```
   gcloud secrets versions disable <old-version> --secret=obsidian-mcp-bearer-token \
     --project=<project>
   ```

If you skip step 3, your Claude clients will start getting `AuthError: bearer token did not match` until you update them.

## Cloudflare Access JWT validation failures

Symptom: the Cloud Run logs show `AuthError: Cf-Access-Jwt-Assertion verification failed: <reason>`. Common reasons:

- `signature verification failed` — the `kid` in the JWT doesn't match a key in Cloudflare's JWKS. Usually transient (key rotation in progress). The `jose` library refetches the JWKS on `kid` mismatch; if it persists for more than a minute, check that `CF_ACCESS_TEAM_DOMAIN` is right.
- `unexpected "iss" claim value` — the team domain is wrong. The JWT's `iss` is `https://<team>.cloudflareaccess.com`; the env var `CF_ACCESS_TEAM_DOMAIN` is just `<team>.cloudflareaccess.com` (no scheme).
- `unexpected "aud" claim value` — the AUD tag in `terraform.tfvars` doesn't match the Access application's AUD. Re-check in the Zero Trust dashboard.
- `"exp" claim timestamp check failed` — the JWT is expired. Cloudflare's session duration is 24h by default; the client should re-auth automatically. If it doesn't, check the Access application's session settings.

## "I can read but not write"

If reads work and writes fail with `NoteConflictError` repeatedly even after the retry-once policy:

- A LiveSync client is syncing very chatty changes (e.g. cursor position) on the same notes. Check the LiveSync plugin's "send" counter on each device.
- Two MCP write requests are racing each other. Unusual for a personal connector but possible if Claude is making tool calls in parallel. Serialise the writes from the client side.

## "I want to start over"

If something has gone deeply wrong with the MCP server (corrupt state, broken config, stuck revisions):

1. `terraform destroy -target=google_cloud_run_v2_service.obsidian_mcp`. This removes only the Cloud Run service and its IAM binding; secrets, the Artifact Registry repo, the service account, and the DNS record stay.
2. `terraform apply` to re-create the service with the placeholder image.
3. Re-run `scripts/obsidian-mcp/deploy.sh` to push the real image.
4. The CouchDB data, the LiveSync passphrase secret, the MCP user, and the Cloudflare Access policy all survive — you don't have to redo any of that.

If you want to rotate the bearer token while you're at it, do steps 1–4 above and then the rotation procedure earlier in this doc.
