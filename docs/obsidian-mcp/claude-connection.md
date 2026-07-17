# Connecting Claude to the Obsidian MCP server

How to wire Claude up to your MCP server on web, desktop, iPad, and iPhone. The MCP server implements the OAuth 2.1 + dynamic client registration flow that current Claude clients expect, so the setup is mostly Claude doing its part — your job is to paste a URL, sign in with Google when prompted, and let Claude discover everything else.

## What you need

Just one thing:

- **MCP URL**: `https://mcp.<your-domain>/mcp`

That's it. No client ID, no client secret, no service tokens, no bearer tokens to copy. The OAuth dance handles credentials per-device, and dynamic client registration means you don't pre-create a client in any dashboard — Claude registers itself as a client the first time it connects.

### Naming and the logo

The server presents itself as **Sutra**: its `serverInfo` advertises that name, a `title`, and the logo (`services/obsidian-mcp/assets/logo.png`, inlined via `src/branding` and also served at `/favicon.ico` + `/icon.png`). But the label and icon you see in Claude's connector **list** are client-side:

- **Name** — Claude shows whatever you type when adding the custom connector, so name it `Sutra` there. (It does not read `serverInfo.name`/`title` for the list label.)
- **Icon** — Claude.ai does not yet render a custom connector's advertised `serverInfo.icons`; it shows a generic globe for all custom connectors. The logo we ship surfaces today in icon-aware MCP clients (e.g. MCP Inspector) and should appear in Claude automatically once that ships — no further change needed. The Google sign-in screen during setup *does* carry the brand if you set the OAuth consent screen's app name + logo (see [setup.md](setup.md) § 4).

## Web (claude.ai)

1. **Settings → Connectors → Add custom connector** (or whatever the current label is — Claude's UI evolves).
2. Paste `https://mcp.<your-domain>/mcp` as the server URL. Leave the optional client ID and client secret fields **blank** — Claude does dynamic client registration against `/register` and doesn't need pre-issued credentials.
3. Save. Claude will fetch `/.well-known/oauth-protected-resource` and `/.well-known/oauth-authorization-server`, register a client, and immediately start the OAuth flow.
4. A new browser tab opens to `https://mcp.<your-domain>/authorize`, which redirects to Google's sign-in screen. Sign in with one of the emails listed in `mcp_allowed_emails`.
5. Google redirects back to the MCP server, which validates your identity, mints an authorization code, and redirects to Claude's callback URL.
6. Claude exchanges the code for an access + refresh token at `/token` and remembers them.
7. The connector page should now show nine tools (`list_notes`, `read_note`, `search_notes`, `create_note`, `update_note`, `append_to_note`, `edit_note`, `delete_note`, `list_recent_changes`). You're connected.

## Desktop (Claude Desktop app)

Two paths depending on which version of the desktop app you're on:

### If your desktop app supports remote MCP connectors in the UI

Use the same flow as the web app: Settings → Connectors → Add custom connector → paste `https://mcp.<your-domain>/mcp`. The OAuth dance runs in your default browser.

### If your desktop app only supports stdio MCP servers

Use a local stdio↔HTTP bridge. The standard tool is [`mcp-remote`](https://www.npmjs.com/package/mcp-remote). In your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "obsidian": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://mcp.<your-domain>/mcp"]
    }
  }
}
```

`mcp-remote` handles the OAuth dance itself — it'll open a browser the first time and cache tokens locally. Restart Claude Desktop after editing the config.

## iPad and iPhone

Same as web: in the Claude iOS app, Settings → Connectors → add the URL `https://mcp.<your-domain>/mcp`. The OAuth dance opens Safari (or your in-app browser) for the Google sign-in step. After approval, control returns to the Claude app and the connector lists the tools.

The header-entry experience the older Claude UI required is gone — you should see no fields asking for tokens, only the URL.

## Verifying

In any conversation, ask Claude something like *"what notes did I edit yesterday?"*. If the connector is wired correctly, Claude will call `list_recent_changes` and return the recent notes. If the connector errors, Claude will surface a tool error in the conversation — the message includes the underlying tag (`AuthError`, `DecryptionError`, etc.), which maps to [troubleshooting.md](troubleshooting.md).

## Re-authenticating

Access tokens expire after an hour by default; refresh tokens after 30 days. Claude should refresh transparently — you only re-do the Google sign-in flow when the refresh token also expires (so, monthly under default settings).

You'll also be prompted to re-sign-in if:

- The OAuth signing key was rotated (running `generate-oauth-key.sh` invalidates every issued token).
- Your email was removed from `mcp_allowed_emails` and Claude tries to refresh.
- Google revoked the OAuth grant (you can do this manually at [myaccount.google.com](https://myaccount.google.com) → Security → Third-party apps with account access).

## Multiple devices

Each device runs its own OAuth registration and ends up with its own access + refresh tokens. There's no central session — adding a new device means going through the dance once on that device. The MCP server treats every authenticated request the same; it doesn't track "Claude on iPad" vs "Claude on web" separately.

## Removing a device

To kick a single device, revoke its Google grant at [myaccount.google.com](https://myaccount.google.com) → Security. The next time that device tries to refresh, Google rejects the refresh request and the MCP server flow breaks naturally. (Our access tokens don't have a revocation list; rotating the signing key is the only way to invalidate everything at once.)
