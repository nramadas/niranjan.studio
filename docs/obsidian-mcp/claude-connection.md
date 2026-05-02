# Connecting Claude to the Obsidian MCP server

How to add the connector in Claude on desktop, iPad, and iPhone. The connector setup UI in Claude has changed shape historically — verify the path on your version before following step-by-step. The substance (URL, headers, auth) is stable.

## What you need

Three values, ready to paste:

1. **MCP URL**: `https://mcp.<your-domain>/mcp`
2. **Cloudflare service token**: the Client ID and Client Secret from [access-setup.md](access-setup.md) §4.
3. **Bearer token**: from Secret Manager.

```
gcloud secrets versions access latest \
  --secret=obsidian-mcp-bearer-token --project=<project>
```

Save all three to your password manager under an entry like "Obsidian MCP". You'll re-use them on each Claude device.

## Desktop

1. Settings → Connectors → Add custom connector.
2. **URL**: `https://mcp.<your-domain>/mcp`.
3. **Headers**:
   - `CF-Access-Client-Id: <Client-Id>`
   - `CF-Access-Client-Secret: <Client-Secret>`
   - `Authorization: Bearer <bearer-token>`
4. Save. Claude does a `tools/list` handshake immediately — if you see eight tools listed, you're connected.

## iPad

Same as desktop. The Connectors UI is reachable from Settings → Connectors. The header-entry experience is awkward on a touchscreen — paste from your password manager rather than retyping.

## iPhone

Same again. iPhone's Claude app sometimes wraps long header values in the input field; double-check there are no soft line breaks before saving.

## Verifying

In any conversation, ask Claude something like "what notes did I edit yesterday?" If the connector is wired correctly, Claude will call `list_recent_changes` and return the recent notes. If the connector errors, Claude will surface a tool error in the conversation — the message includes the underlying tag (`AuthError`, `DecryptionError`, etc.), which maps to [troubleshooting.md](troubleshooting.md).

## Rotating credentials

When you rotate either the Cloudflare service token or the bearer token, you have to update the connector on every Claude device. There's no central refresh — connector configuration is per-device.

A tip: if you frequently switch credentials, use a short, memorable connector name and keep the credentials together in your password manager. Don't store the Client Secret in plain text anywhere.
