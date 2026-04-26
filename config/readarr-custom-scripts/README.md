# Readarr custom scripts

Scripts that Readarr executes on lifecycle events (book imported, file deleted, etc.) via its **Custom Script** notification connector.

## Why this exists

Readarr can natively notify Plex when a book finishes importing — but not Audiobookshelf. To get a hands-off pipeline (torrent → Transmission → Readarr import → ABS scan), we hook the **Custom Script** notification to call ABS's scan API ourselves.

## Files

| File | Purpose |
|---|---|
| `abs-scan.sh` | Triggered by Readarr after import/upgrade/rename/delete events. Calls `POST /api/libraries/<id>/scan` on Audiobookshelf. |

The deploy script (`scripts/deploy-tokyo.sh`) syncs these into `/opt/docker/readarr/custom-scripts/` on the Tokyo host (which Readarr's container sees as `/config/custom-scripts/`).

## One-time setup on Tokyo

The script reads the ABS auth token from `/config/custom-scripts/.abs-token`. This file is **not** in the repo and must be created once on Tokyo:

```bash
# Extract a long-lived JWT for the hammer user from ABS's database
ssh tokyo
docker cp maisie-audiobookshelf-1:/config/absdatabase.sqlite /tmp/abs.sqlite
TOKEN=$(sqlite3 /tmp/abs.sqlite "SELECT token FROM users WHERE username='hammer';")
sudo mkdir -p /opt/docker/readarr/custom-scripts
echo -n "$TOKEN" | sudo tee /opt/docker/readarr/custom-scripts/.abs-token > /dev/null
sudo chown 1000:1000 /opt/docker/readarr/custom-scripts/.abs-token
sudo chmod 600 /opt/docker/readarr/custom-scripts/.abs-token
rm /tmp/abs.sqlite
```

If the token expires or the `hammer` user is reset, repeat the above to refresh it.

## Registering the script in Readarr

A one-time Readarr API call wires the script as a notification (path: `/config/custom-scripts/abs-scan.sh`, fires on: ReleaseImport, Upgrade, Rename, BookDelete, BookFileDelete, BookFileDeleteForUpgrade, BookRetag).

The current registration was created via the Readarr API and persists in Readarr's SQLite config. If a fresh Readarr install needs it again, POST the equivalent body to `/readarr/api/v1/notification` — see git history for the exact payload, or use the Readarr UI: Settings → Connect → + → Custom Script.

## Logs

Each invocation appends a line to `/config/custom-scripts/abs-scan.log`:

```
[2026-04-25 14:53:33] event=BookFileImport book=The Martian
[2026-04-25 14:53:33] ABS scan response: HTTP 200
```

Useful for confirming the link is alive after deploys.
