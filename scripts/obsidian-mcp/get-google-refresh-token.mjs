#!/usr/bin/env node
// Mint one Google account's entry for the Phase 5 Meet-ingestion accounts
// secret (obsidian-mcp-meet-accounts). Run once per account — personal,
// work, ... — signed in as that account each time.
//
// Runs a one-shot local OAuth flow against the SAME Web-application client
// the MCP already uses for sign-in: prints a consent URL, catches the
// redirect on localhost, exchanges the code, and prints a ready-to-paste
// JSON entry:
//
//   { "name": "...", "refreshToken": "...", "targetResource": "..." }
//
// Collect one entry per account into a JSON array and store the array as
// the secret (see the printed instructions).
//
// One-time prerequisite: add http://localhost:8123/callback to the OAuth
// client's authorized redirect URIs (GCP Console → APIs & Services →
// Credentials). You can remove it again afterwards.
//
// Usage:
//   GOOGLE_OAUTH_CLIENT_ID=... GOOGLE_OAUTH_CLIENT_SECRET=... \
//     node scripts/obsidian-mcp/get-google-refresh-token.mjs --name work [--port 8123]

import { randomUUID } from "node:crypto";
import { createServer } from "node:http";

const args = process.argv.slice(2);
const argValue = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};

const clientId = argValue("--client-id") ?? process.env.GOOGLE_OAUTH_CLIENT_ID;
const clientSecret = argValue("--client-secret") ?? process.env.GOOGLE_OAUTH_CLIENT_SECRET;
const accountName = argValue("--name") ?? "personal";
const port = Number(argValue("--port") ?? 8123);

if (!clientId || !clientSecret) {
  console.error(
    "Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET (or pass --client-id/--client-secret).",
  );
  process.exit(1);
}

const redirectUri = `http://localhost:${port}/callback`;
// meetings.space.readonly covers conference records, transcripts,
// participants, AND the transcript.v2.fileGenerated event subscription.
// openid adds an id_token so we can read the stable user id (`sub`).
const scope = "openid https://www.googleapis.com/auth/meetings.space.readonly";

const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
authUrl.searchParams.set("client_id", clientId);
authUrl.searchParams.set("redirect_uri", redirectUri);
authUrl.searchParams.set("response_type", "code");
authUrl.searchParams.set("scope", scope);
// access_type=offline + prompt=consent are what make Google return a
// refresh token (a plain re-auth returns only an access token).
authUrl.searchParams.set("access_type", "offline");
authUrl.searchParams.set("prompt", "consent");
// One-shot CSRF token: the callback only accepts the code Google sends
// back with OUR state, so nothing else that can reach the port can inject
// a code from a different account.
const expectedState = randomUUID();
authUrl.searchParams.set("state", expectedState);

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${port}`);
  if (url.pathname !== "/callback") {
    res.writeHead(404).end();
    return;
  }
  if (url.searchParams.get("state") !== expectedState) {
    res.writeHead(400).end("State mismatch — start over.");
    console.error("Callback state did not match; refusing the code.");
    return;
  }
  const code = url.searchParams.get("code");
  if (!code) {
    res.writeHead(400).end("Missing ?code — check the console for the Google error.");
    console.error(`Google returned an error: ${url.searchParams.get("error") ?? "unknown"}`);
    process.exit(1);
  }

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }),
  });
  const tokens = await tokenRes.json();
  if (!tokenRes.ok || !tokens.refresh_token) {
    res.writeHead(500).end("Token exchange failed — see console.");
    console.error("Token exchange failed:", JSON.stringify(tokens, null, 2));
    process.exit(1);
  }

  // The id_token payload's `sub` is the account's stable Gaia id — exactly
  // what the Workspace Events users/{id} target resource wants. `email`
  // lets us confirm which account was actually consented.
  const payload = JSON.parse(
    Buffer.from(String(tokens.id_token).split(".")[1], "base64url").toString("utf8"),
  );

  const entry = {
    name: accountName,
    refreshToken: tokens.refresh_token,
    targetResource: `//cloudidentity.googleapis.com/users/${payload.sub}`,
  };

  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Done — go back to the terminal.");
  server.close();

  console.log("\n─── Success ────────────────────────────────────────────────");
  console.log(`\nAccount entry for "${accountName}" (${payload.email ?? "email unknown"}):\n`);
  console.log(JSON.stringify(entry, null, 2));
  console.log(`
Add it to the accounts array and store the WHOLE array as the secret.
Use a scratch file rather than pasting the token on a command line (shell
history). First account:

  cat > /tmp/meet-accounts.json   # paste: [ the entry above ]  then Ctrl-D
  gcloud secrets versions add obsidian-mcp-meet-accounts --data-file=/tmp/meet-accounts.json
  rm /tmp/meet-accounts.json

Adding another account: fetch the current array, append this entry, re-add:

  gcloud secrets versions access latest --secret=obsidian-mcp-meet-accounts > /tmp/meet-accounts.json
  # edit /tmp/meet-accounts.json to append the entry above, then:
  gcloud secrets versions add obsidian-mcp-meet-accounts --data-file=/tmp/meet-accounts.json
  rm /tmp/meet-accounts.json

Then activate: set meet_ingest_enabled = true in terraform.tfvars, run
  terraform -chdir=terraform apply     (flips MEET_INGEST_ENABLED on Cloud Run)
  scripts/obsidian-mcp/deploy.sh       (rolls a revision that reads the new secret)
The service creates this account's Workspace Events subscription at boot.
`);
});

// Loopback only — the one-shot callback must not be reachable from the LAN.
server.listen(port, "127.0.0.1", () => {
  console.log(
    `Open this URL in the browser signed in as the "${accountName}" account to ingest:\n`,
  );
  console.log(`  ${authUrl.toString()}\n`);
  console.log(`Waiting for the redirect on ${redirectUri} ...`);
});
