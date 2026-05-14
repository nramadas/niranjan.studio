# Obsidian MCP server setup (Phase 2)

End-to-end walkthrough for standing up the Cloud Run MCP server in front of the Phase 1 vault. Each step has a verification line and the most common failure mode. The expected sequence is:

0. Verify domain ownership in Google Search Console (one-time, lets Cloud Run domain mapping work).
1. Apply Terraform — Cloud Run service, secrets, IAM, Artifact Registry, Cloudflare DNS pointing at Google, Cloud Run domain mapping.
2. Populate the LiveSync passphrase secret out of band.
3. Generate the OAuth signing key and push it to Secret Manager.
4. Create a Google OAuth 2.0 Web application client and push the client secret.
5. Provision the scoped CouchDB user the MCP server will authenticate as.
6. Build and deploy the server image.
7. Wait for the Cloud Run domain-managed certificate to provision.
8. Verify end to end with `curl`.
9. Connect Claude on web, iPad, and iPhone.

Phase 1 must be working before you start. If `curl -u <user>:<pw> https://vault.<domain>/_up` doesn't return `{"status":"ok"}`, fix that first. Cloudflare is still the DNS provider for the apex domain and still tunnels CouchDB at `vault.<domain>`. The MCP service no longer uses Cloudflare in its request path — `mcp.<domain>` is a DNS-only record (gray cloud) pointing directly at Google's Cloud Run frontend.

## 0. Verify domain ownership in Google Search Console

Cloud Run won't let you map a custom domain to a service unless your Google account has verified ownership of the domain (or a parent of it) in Google Search Console. You only do this once per Google account + apex domain — re-deploys, new services, and tearing down/rebuilding all reuse the verification.

If you skip this and run step 1 anyway, the apply fails on `google_cloud_run_domain_mapping.mcp` with a message like `Caller is not authorized to administer the domain mcp.<your-domain>`.

1. Open [Google Search Console](https://search.google.com/search-console) signed in with the same Google account you use for `gcloud auth login` (otherwise the verification doesn't grant Cloud Run the authority it checks for).
2. **Add property → Domain** (not "URL prefix"), enter your apex domain (e.g. `niranjan.studio`). Verifying the apex covers all subdomains, so this is the only verification you'll ever need for any future Cloud Run domain mapping under this domain.
3. Google shows a TXT record value to add — looks like `google-site-verification=ABC123…`.
4. In the Cloudflare dashboard for your zone → DNS → Records → **Add record**:
   - Type: `TXT`
   - Name: `@` (the apex)
   - Content: paste the `google-site-verification=…` value
   - TTL: Auto
   - Proxy status: DNS only (the proxy toggle isn't relevant for TXT records, but the default is fine)
5. Wait ~30 seconds, then click **Verify** in Search Console. The property should turn green.

**Verify**: in Search Console, your apex domain appears in the property list with a green checkmark. From the command line: `dig TXT <your-domain>` should include the `google-site-verification=…` value.

**Common failure**: verifying with the wrong Google account. Cloud Run checks that the Google identity making the API call (your `gcloud auth login` user) is a verified owner of the domain. If you verified with `personal@gmail.com` but `gcloud auth login` is `work@example.com`, the verification doesn't count. Either re-verify with the right account or grant ownership to the gcloud account in Search Console (Settings → Users and permissions → Add user → Owner).

## 1. Apply Terraform

The Phase 2 resources need two new variables in `terraform/terraform.tfvars`:

```
google_oauth_client_id = "REPLACE_ME.apps.googleusercontent.com"
mcp_allowed_emails     = ["you@example.com"]
```

You don't have the Google client ID yet — it gets created in step 4. Put a placeholder for now (`"placeholder.apps.googleusercontent.com"` is fine), apply, then come back here in step 4 with the real value and re-apply.

```
terraform -chdir=terraform apply
```

Creates the Cloud Run service (with a placeholder `gcr.io/cloudrun/hello` image — we replace it in step 6), the Artifact Registry repo, four Phase 2 secrets (CouchDB password, LiveSync passphrase, OAuth signing key, Google OAuth client secret), IAM bindings, the `mcp.<domain>` DNS CNAME pointing at `ghs.googlehosted.com`, and the Cloud Run domain mapping resource.

**Verify**: `terraform output obsidian_mcp_service_url` returns a `*.run.app` URL. `gcloud run services describe obsidian-mcp --region=<region>` shows the service running the placeholder image. `gcloud run domain-mappings describe --domain=mcp.<domain> --region=<region>` shows the mapping (its certificate may still be provisioning — that's expected; we wait for it in step 7).

**Common failure**: the apply fails on the domain mapping with a message about ownership verification. Cloud Run requires the `mcp.<domain>` DNS to resolve to `ghs.googlehosted.com` *before* it will create the mapping. If the Cloudflare DNS record didn't propagate in time, just re-run apply a minute later.

## 2. Populate the LiveSync E2EE passphrase

Same as Phase 1 — Terraform created the `obsidian-livesync-passphrase` secret with a placeholder value; overwrite it with the real passphrase you set in the LiveSync plugin.

```
printf '%s' '<your-livesync-passphrase>' \
  | gcloud secrets versions add obsidian-livesync-passphrase \
      --project=<project> --data-file=-
```

The `printf '%s'` (not `echo`) avoids a trailing newline that would silently corrupt the passphrase. The secret resource has `lifecycle.ignore_changes = [secret_data]` so future Terraform applies won't overwrite it.

**Verify**: `gcloud secrets versions access latest --secret=obsidian-livesync-passphrase --project=<project>` returns the passphrase, with no trailing newline (`| xxd | tail`).

**Common failure**: typing the passphrase wrong. The MCP server boots fine, accepts auth, then returns decryption errors on every read. There's no way to validate the passphrase against the vault during boot — it only fails on the first decrypt. Test with `read_note` once you've connected Claude (step 9); if all reads fail with `DecryptionError`, this is the cause.

## 3. Generate the OAuth signing key

The server signs every JWT it issues (auth codes, access tokens, refresh tokens, the Google round-trip state) with one RSA-2048 PKCS#8 PEM. The script generates a fresh key locally and uploads it as the latest version of the secret without ever writing it to disk.

```
scripts/obsidian-mcp/generate-oauth-key.sh --project <gcp-project>
```

**Verify**: `gcloud secrets versions list obsidian-mcp-oauth-signing-key --project=<project>` shows version 2 (version 1 is the Terraform-installed placeholder). Reading the value back should show a PEM beginning `-----BEGIN PRIVATE KEY-----` (not `-----BEGIN RSA PRIVATE KEY-----` — that's PKCS#1 and the server can't import it).

**Rotation**: rerun the same script. A new key invalidates every previously-issued token because the kid (RFC 7638 thumbprint) changes; connected Claude clients will need to re-authenticate. That's the recovery path on suspected token compromise.

## 4. Create a Google OAuth 2.0 client

This is a manual step in GCP Console. The MCP server uses Google as its OIDC identity provider for the human-auth step at `/authorize` — your email is the gate, not Cloudflare Access.

1. **GCP Console → APIs & Services → OAuth consent screen** (if not already configured for this project):
   - User type: **External** (unless you have a Google Workspace, in which case Internal is simpler).
   - App name: `Obsidian MCP` (or whatever you like; this is what your sign-in screen says).
   - User support email: your email.
   - Add the emails from `mcp_allowed_emails` as **Test users** (External + unpublished apps reject anyone not in the test list).
   - Scopes: `openid` and `email`.
   - Save.
2. **APIs & Services → Credentials → + Create Credentials → OAuth client ID:**
   - Application type: **Web application**.
   - Name: `Obsidian MCP server`.
   - Authorized redirect URIs: `https://mcp.<your-domain>/oauth/google/callback` exactly.
   - Create. Copy the **client ID** and **client secret** that the dialog shows.

Push the client secret into Secret Manager:

```
printf '%s' '<paste google client secret here>' \
  | gcloud secrets versions add obsidian-mcp-google-oauth-client-secret \
      --project=<project> --data-file=-
```

Put the client ID into `terraform/terraform.tfvars`:

```
google_oauth_client_id = "1234567890-abcdef.apps.googleusercontent.com"
```

Re-apply Terraform so the env var on Cloud Run reflects the real client ID:

```
terraform -chdir=terraform apply
```

**Verify**: `gcloud run services describe obsidian-mcp --format='value(spec.template.spec.containers[0].env)' --project=<project> --region=<region>` shows `GOOGLE_OAUTH_CLIENT_ID` with your real value.

**Common failure**: the consent screen is still in "Testing" mode and your email isn't in the test users list. Sign-in fails with Google's `Access blocked: This app's request is invalid` or similar. Add your email under Test users and try again. (For personal use, leaving the app in Testing forever is fine; it works as long as the email is in the test list.)

## 5. Provision the CouchDB user

Same as before — provisions a scoped MCP user with RW on the obsidian database only.

```
scripts/obsidian-mcp/create-couchdb-user.sh \
  --project <gcp-project> \
  --domain  <your-domain>
```

**Verify**: `curl -u obsidian-mcp:<password> https://vault.<domain>/obsidian` returns the database info doc. Get the password with `gcloud secrets versions access latest --secret=obsidian-mcp-couchdb-password --project=<project>`.

**Common failure**: `Admin auth failed`. The Phase 1 admin password in Secret Manager doesn't match the password the running CouchDB container is using. The Phase 1 init wrote the password into `/opt/obsidian/.env` on the VM at first boot — if you've rotated the secret since, the on-disk env is stale. Either roll back the secret or re-apply the env on the VM.

## 6. Build and deploy

```
scripts/obsidian-mcp/deploy.sh --project <gcp-project>
```

Builds `services/obsidian-mcp/` as a `linux/amd64` Docker image, tags it with the current git short-SHA, pushes to Artifact Registry, and rolls a new Cloud Run revision.

**Verify** (against the raw `*.run.app` URL — this works immediately, before the custom-domain cert is ready):

```
CLOUD_RUN_URL=$(gcloud run services describe obsidian-mcp \
  --project=<project> --region=<region> --format='value(status.url)')
curl -i "${CLOUD_RUN_URL}/health"
curl -s "${CLOUD_RUN_URL}/.well-known/oauth-authorization-server"
```

`/health` should return `HTTP/2 200` with `{"ok":true}`. The metadata endpoint should return a JSON document listing `/authorize`, `/token`, `/register`, and `/jwks.json` URLs.

**Common failures**:

- `503 Service Unavailable` immediately after deploy — the container failed to start. Check `gcloud run services logs tail obsidian-mcp` for the boot error. Most commonly a missing env var (the config loader fails fast on these — see the missing-config message it prints).
- The `/.well-known/oauth-authorization-server` document lists URLs starting with `https://mcp.<domain>` even though your custom-domain cert isn't ready yet. That's intentional — `OAUTH_ISSUER` is fixed; clients will discover those URLs and use them once the cert provisions. The raw `*.run.app` URL is for diagnostics only.

## 7. Wait for the Cloud Run domain-managed certificate

Cloud Run provisions a Google-managed certificate for `mcp.<domain>` once the DNS record resolves correctly. This usually takes 15–30 minutes after the first apply, sometimes longer for first-time provisioning.

```
gcloud beta run domain-mappings describe \
  --domain=mcp.<your-domain> --region=<region> --project=<project>
```

(The `gcloud run domain-mappings` GA command's flags vary across gcloud versions — `gcloud beta run domain-mappings` is consistent. If even that errors, just curl the public URL and watch for the cert: `curl -I https://mcp.<your-domain>/health`. A TLS handshake error means it's still provisioning; `HTTP/2 200` means it's ready.)

Look for `status.conditions` with `type=CertificateProvisioned` and `status=True`. While that's still `False` or `Pending`, hitting `https://mcp.<domain>` returns a TLS handshake error.

**Verify**:

```
curl -i https://mcp.<your-domain>/health
```

Expected: `HTTP/2 200` with `{"ok":true}`. While the cert is still provisioning you'll get a connection error or a TLS error — that's not a code problem, just patience.

**Common failure**: the DNS record isn't pointing where Cloud Run expects. Confirm `dig mcp.<domain> CNAME` resolves to `ghs.googlehosted.com` (not to a Cloudflare proxy IP). If it goes to Cloudflare's edge, the Cloudflare DNS record's "proxied" flag is on (orange cloud) — flip it off (gray cloud, DNS-only) so Cloudflare doesn't intercept the cert challenge.

## 8. End-to-end OAuth metadata verification

```
curl -s https://mcp.<your-domain>/.well-known/oauth-protected-resource
curl -s https://mcp.<your-domain>/.well-known/oauth-authorization-server
curl -s https://mcp.<your-domain>/.well-known/jwks.json
```

The first should list this server as both the resource and the authorization server. The second should list the four endpoints. The third should return a JWKS containing one RSA public key with `alg: RS256` and a `kid` field — that's your OAuth signing key's public half.

```
curl -i https://mcp.<your-domain>/mcp \
  -X POST -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

Expected: `HTTP/2 401` with a `WWW-Authenticate` header pointing at `/.well-known/oauth-protected-resource`. That's the protocol's "I don't know you, here's how to start the OAuth dance" handshake. If you instead get a 200, OAuth gating isn't on — re-deploy and check logs.

## 9. Connect Claude

See [claude-connection.md](claude-connection.md) for the connector walkthrough on web, desktop, iPad, and iPhone. Quick version: in Claude's connector dialog, paste `https://mcp.<your-domain>/mcp` as the server URL and let Claude do the OAuth dance. Sign in with Google when prompted. The first request after sign-in lists the nine MCP tools.

After Claude is connected, exercise the round trip:

- Ask Claude to read a known note. Confirm the body matches what's in your vault.
- Ask Claude to append a line to a scratch note. Open the note in Obsidian and confirm the line appears (LiveSync should propagate it within a second or two).
- Ask Claude to search for a phrase you know exists. Confirm the snippet looks right.

If reads work but writes fail with conflicts, your LiveSync clients are very chatty — see [troubleshooting.md](troubleshooting.md). If reads return gibberish, the LiveSync passphrase in Secret Manager is wrong (step 2).

## After you're done

Operational reference for ongoing maintenance:

- **Tail logs**: `gcloud run services logs tail obsidian-mcp --project=<project> --region=<region>`.
- **Roll a new revision**: re-run `scripts/obsidian-mcp/deploy.sh`.
- **Rotate the OAuth signing key** (invalidates all tokens; clients re-auth): re-run `scripts/obsidian-mcp/generate-oauth-key.sh` then bump the Cloud Run revision so the new key is mounted.
- **Add or remove allowed emails**: edit `mcp_allowed_emails` in tfvars, re-apply, the env var updates and Cloud Run rolls a revision.
- **Migrate to a different OIDC provider** (away from Google): see [auth.md](auth.md).
- **Pin the LiveSync plugin version** the server is tested against — see [troubleshooting.md](troubleshooting.md). LiveSync's chunking format has evolved historically; pinning the client version protects against compatibility regressions.
