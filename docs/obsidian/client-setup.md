# Obsidian client setup

Setting up the Self-hosted LiveSync plugin on Mac (first), then iPad and iPhone via the setup-URI flow. Sync settings and credentials live in your password manager from this point on, not on disk in plaintext.

Order matters: configure Mac fully, then use Mac's "copy setup URI" feature to onboard the mobile devices. That way you don't re-type the CouchDB URL or credentials on a touchscreen.

## Prerequisites

- The vault URL works: `curl -u <user>:<password> https://vault.<domain>/_up` returns `{"status":"ok"}` from any of your devices' networks.
- Get the password to hand: `gcloud secrets versions access latest --project=<project> --secret=obsidian-couchdb-password`. Paste it into your password manager now under an entry like "Obsidian CouchDB admin".
- Decide your E2EE passphrase. **Generate it now, save it to your password manager, do not skip this step.** If you lose it, the vault becomes unreadable; there is no recovery. A 6-word diceware phrase or a 32-char password manager generation are both fine.

## Mac setup

1. **Install Obsidian** from https://obsidian.md if you don't have it.
2. **Open or create your vault.** Use a real vault — testing on an empty one and migrating later means re-bootstrapping sync.
3. **Settings → Community plugins → Turn on community plugins.** Acknowledge the warning.
4. **Browse → search "Self-hosted LiveSync" → Install → Enable.** The plugin is by `vrtmrz`.
5. **Settings → Self-hosted LiveSync.** A configuration wizard appears the first time. Either go through the wizard or click "Setup Wizard" later.
6. In **Remote Database configuration**:
   - URI: `https://vault.<your-domain>` (no trailing slash, include `https://`).
   - Username: `obsidian` (or whatever you set in `obsidian_admin_user`).
   - Password: from your password manager.
   - Database name: `obsidian` (or whatever you set in `obsidian_db_name`).
7. Click **Test Database Connection**. Expect green checkmarks. If you see CORS errors here, see [troubleshooting.md](troubleshooting.md).
8. Click **Check database configuration**. Should pass.
9. **Encryption** section:
   - Turn on **End-to-End Encryption**.
   - Paste your E2EE passphrase.
   - Turn on **Path Obfuscation** (recommended — hides note paths from the server).
10. **Sync settings**:
    - Sync mode: **LiveSync** (real-time, sub-second latency).
    - Periodic sync: leave on as a fallback.
    - Sync hidden files: on, if you want plugin configs synced.
11. **Apply**. The first sync uploads your entire vault. Watch the status bar; it'll show progress. For a vault with thousands of notes this can take a few minutes.
12. **Verify**: edit a note, save it. In the LiveSync settings panel under "Statistics", the "sent" counter should tick up immediately.

### Generate the setup URI for mobile

In LiveSync settings → **Setup wizard → Copy current settings as setup URI**. It generates a long URL starting with `obsidian://setuplivesync?...`, encrypted with a one-time passphrase that LiveSync will display. Copy both:

- The URI itself.
- The one-time passphrase (different from your E2EE passphrase).

Send both to your iPad and iPhone via whatever you trust (AirDrop, signal). They expire quickly — use them in the next few minutes.

## iPad setup

1. Install Obsidian from the App Store.
2. Create or open a vault. **iCloud-synced vaults are fine** — LiveSync coexists, but sync conflicts get noisy. A local-only vault on iPad makes for cleaner conflict semantics.
3. **iOS gotcha — community plugins are per-device.** Settings → Community plugins → Turn on. iOS shows a different warning than desktop; accept it.
4. Browse → install Self-hosted LiveSync → enable.
5. **Open the setup URI from your Mac in Safari**, or paste it into a note and tap. iOS prompts to open in Obsidian. Confirm.
6. LiveSync prompts for the one-time setup passphrase from the Mac. Enter it.
7. Settings get applied automatically. The plugin will then prompt for your E2EE passphrase (the persistent one, not the setup one). Enter that.
8. Initial replication starts. On a busy vault this takes a few minutes on cellular.

## iPhone setup

Same as iPad. Repeat steps 1–8.

iOS gotcha bears repeating: each device needs community plugins enabled separately. iCloud doesn't sync the "community plugins enabled" flag.

## End-to-end testing

The four scenarios that catch most issues:

1. **Edit on Mac → see on iPad.** Open a note on both devices side by side. Type on Mac. Within ~1 second, the change appears on iPad.
2. **Edit on iPad → see on Mac.** Reverse direction. Same latency.
3. **Edit on iPhone (offline) → reconnect → resolve.** Turn iPhone's wifi off, edit a note, turn wifi back on. The change syncs.
4. **Conflict test.** Disconnect iPad. Edit the same line of the same note on Mac and iPad. Reconnect. LiveSync surfaces the conflict; resolve via the conflict resolution UI — by default it diffs and lets you pick.

If all four work, sync is healthy.

## Routine maintenance

LiveSync's **Database maintenance** screen has a "rebuild database" option for when sync state goes weird. It's destructive (re-uploads everything) — use as a last resort, not a first.

The CouchDB instance accumulates revision history. Periodically (months, not days), trigger a "Compact" via LiveSync's maintenance UI. This won't free disk on the VM until CouchDB compacts internally, but it speeds up sync.

Snapshot the VM disk before any maintenance you're unsure about: `gcloud compute disks snapshot obsidian-sync --zone=<zone>`.
