# Cloudflare Access setup

This document is the current-state walkthrough for configuring Cloudflare Access in front of the MCP server. If you're considering migrating away from Cloudflare Access (to GCP IAP, self-hosted OIDC, or a hosted OIDC provider), the migration story lives in [auth.md](auth.md), not here. This doc is just "how to set up the current auth."

## Prerequisites

- A Cloudflare account with Zero Trust enabled. Free tier covers up to 50 users.
- The `mcp.<domain>` DNS record already created by Terraform (it lives in [terraform/cloudflare.tf](../../terraform/cloudflare.tf)). It should resolve to `<tunnel-id>.cfargotunnel.com`.
- An identity provider configured under Settings → Authentication. The default "One-time PIN" works for personal use; Google / GitHub / Apple / etc. SSO providers all work.

## 1. Create the Access application

In the Cloudflare Zero Trust dashboard:

1. **Access → Applications → Add an application → Self-hosted.**
2. Name: `Obsidian MCP`.
3. Session Duration: **24 hours** (a balance between security and not having to re-auth from Claude every hour).
4. Application domain: `mcp.<your-domain>`. Leave path empty.
5. Identity providers: leave the defaults you've already configured at the account level.
6. **Save** to create the application.

After it's created, the Overview tab shows the **Application Audience (AUD) Tag** — a 64-character hex string. **Copy this value now** — you'll put it in `terraform.tfvars` (`cloudflare_access_aud`) per [setup.md](setup.md) §6.

## 2. Add an Allow policy for interactive use

Useful when you want to hit the MCP server from `curl` or a browser-based MCP client signed in as you, not via the Claude service token.

1. **Policies tab → Add a policy.**
2. Policy name: `Allow my email`.
3. Action: **Allow**.
4. Configure rules: **Include → Emails → `<your-email@…>`**.
5. **Save**.

If multiple humans need access, add their emails here or use a Group rule pointing at an Access group.

## 3. Add a Service Auth policy for Claude

Claude's MCP connector authenticates non-interactively, so it needs a Service Auth policy and a service token. **Without this policy, the service token gets rejected even though it exists.**

1. **Policies tab → Add a policy.**
2. Policy name: `Claude service token`.
3. Action: **Service Auth**.
4. Configure rules: **Include → Service Token → (you'll create one in step 4 and come back to select it)**. For now, save the policy with a placeholder rule and edit it after the token exists.
5. **Save**.

## 4. Issue the service token

1. **Access → Service Auth → Create Service Token.**
2. Name: `claude-mcp`.
3. Duration: **Non-expiring** (you'll rotate it manually if needed).
4. **Generate token**.

The dashboard shows the **Client ID** and **Client Secret exactly once**. Copy both immediately into your password manager. The Client Secret cannot be re-displayed — if you lose it, you have to re-generate the token.

Now go back to the Service Auth policy you saved in step 3 and edit the rule to select this `claude-mcp` token.

## 5. Verify

```
CF_ID='<Client-Id>'
CF_SECRET='<Client-Secret>'
BEARER=$(gcloud secrets versions access latest \
  --secret=obsidian-mcp-bearer-token --project=<project>)

# Service-token path (this is what Claude will use):
curl -i -X POST https://mcp.<domain>/mcp \
  -H "CF-Access-Client-Id: ${CF_ID}" \
  -H "CF-Access-Client-Secret: ${CF_SECRET}" \
  -H "Authorization: Bearer ${BEARER}" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  --data '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

Expected: `HTTP/2 200` with a JSON-RPC response listing the eight MCP tools.

If you get `HTTP/2 401`:

- From Cloudflare (`cf-ray` header in the response): the Access policy hasn't matched. Confirm you saved the Service Auth policy AND that it lists this specific token.
- From the server (Cloud Run logs show the `AuthError`): either the Cf-Access JWT verification failed (AUD mismatch — re-check step 1, then re-apply Terraform with the correct AUD), or the bearer token didn't match Secret Manager.

## 6. Browser sign-in (optional but useful)

If you want to access the MCP server from a browser-based debug tool — e.g. for ad-hoc `curl` runs with a browser-set cookie — visit `https://mcp.<domain>` in a browser. Cloudflare Access will redirect you through the IDP login flow per the Allow policy from step 2. After signing in, Cloudflare sets a `CF_Authorization` cookie and lets you through.

This is purely for human convenience — Claude only ever uses the service token path.

## What to flag if you change anything

- **AUD changes** when you delete and re-create the Access application. If you do that, re-run [setup.md](setup.md) §6 to update Terraform.
- **Adding more humans** to the Allow policy is free until you exceed the Cloudflare Access free-tier user count (50 currently). At that point you're either upgrading or migrating — see [auth.md](auth.md) §8.
- **Rotating the service token**: regenerate at `Access → Service Auth → claude-mcp → Refresh secret`. You then need to update Claude's connector with the new credentials. The bearer token is independent and doesn't need rotating at the same time, but it's a reasonable habit.
