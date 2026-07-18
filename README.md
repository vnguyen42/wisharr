# Wisharr

[![CI](https://github.com/vnguyen42/wisharr/actions/workflows/ci.yml/badge.svg)](https://github.com/vnguyen42/wisharr/actions/workflows/ci.yml)

Sync Plex watchlists to **Overseerr/Jellyseerr, Radarr and Sonarr** — including **Plex Home managed users**, with a **single admin token** and zero token copy-pasting, ever.

## Why another watchlist tool?

Every existing bridge breaks on the same wall: Plex doesn't give third-party apps refresh tokens, and per-user tokens expire silently.

- **Overseerr/Jellyseerr** built-in sync needs each user to re-login periodically — and Plex Home **managed users can't log in at all** (they have no plex.tv credentials), so their watchlists are simply invisible.
- **Watchlistarr** covers friends with the owner token, but is dormant and doesn't handle Home managed users.
- **Radarr/Sonarr** native import lists only see your own account.

Wisharr uses the same API Plex's own clients use to switch profiles: `POST plex.tv/api/home/users/{id}/switch` with your admin token returns a fresh token scoped to the managed user. Minted tokens are cached and **automatically re-minted the moment plex.tv rejects one** — nothing ever expires from the user's point of view, and nothing ever needs manual refreshing. Your admin token is the only real secret, and it stays alive as long as you use Plex normally.

## Quick start (Docker)

```bash
mkdir wisharr && cd wisharr
curl -LO https://raw.githubusercontent.com/vnguyen42/wisharr/main/docker-compose.example.yml
curl -Lo config/config.yml --create-dirs https://raw.githubusercontent.com/vnguyen42/wisharr/main/config/config.example.yml
# put PLEX_TOKEN / OVERSEERR_API_KEY in a .env file, or edit config/config.yml
docker compose -f docker-compose.example.yml up -d
```

Multi-arch images (amd64 + arm64) are published to `ghcr.io/vnguyen42/wisharr` on every push to main and every release tag. Open **http://localhost:9797** — sinks, sync interval and per-user toggles are all configurable from the web UI.

From source instead:

```bash
cp config/config.example.yml config/config.yml
npm install && npm install --prefix web && npm run --prefix web build
npm run sync        # one-shot
npm run dev         # scheduled loop + web UI (default: every 20 min)
```

**Plex token auto-detection** — if Wisharr runs on the same machine as your Plex Media Server, you can leave `plex.token` empty: it is auto-detected from the local install (macOS preferences, `Preferences.xml` on Linux/Docker, Windows registry) and validated against plex.tv before use. If detection fails, Wisharr tells you and falls back to the configured token.

**First-run behavior** — by default (`sync.seedOnFirstRun: true`), the first time a sink is ever synced — fresh install, or a sink you add to the config months later — Wisharr absorbs the existing watchlist backlog silently: items already on the lists are marked as synced without being requested. Only items added *from then on* generate requests — no 200-request blast into Overseerr on day one. Prefer the opposite? Set `seedOnFirstRun: false` and the whole backlog is pushed on the first sync. `npm run seed` is also available to force-absorb the current state at any time.

## How it works

1. `GET plex.tv/api/home/users` — enumerate every profile in your Plex Home (admin token).
2. For each managed profile, `POST .../switch` mints a fresh user-scoped token (with the profile's PIN if protected).
3. `GET discover.provider.plex.tv/library/sections/watchlist/all` — fetch that user's watchlist; external IDs (TMDB/TVDB/IMDB) resolved per item.
4. Push to your configured sinks — Overseerr/Jellyseerr requests, or direct Radarr/Sonarr adds. A local SQLite store dedups so items are only pushed once per user per sink.

**Request attribution** — Overseerr requests are credited to the right person: Wisharr matches each Plex Home profile against Overseerr's user list (by Plex account id first, display name as fallback), so quotas, permissions and request history apply per user. Plex users with no Overseerr account — managed users typically, or friends never imported — fall back to the API key owner, with a one-time log line naming them.

## Web UI

Wisharr ships a built-in web UI on port **9797** (set `ui.port`, or `ui.enabled: false` to turn it off):

- **Dashboard** — sink health, tracked items, request counts, recent activity, next-sync countdown and a Sync-now button.
- **Users** — every Plex Home profile with its type, watchlist size, Overseerr account mapping, token state, and a per-profile sync toggle.
- **Logs** — live log tail over SSE with level filters.
- **Settings** — sync interval and behavior toggles (saved back to `config.yml`, comments preserved), plus connection tests for Plex and Overseerr.

Authentication is off by default — either keep the port LAN-only, or enable HTTP Basic auth:

```yaml
ui:
  auth:
    username: admin
    password: ${WISHARR_PASSWORD}
```

One caveat for self-hosters: keep a single Wisharr process per database file. In particular, don't run a host-side `npm run sync` against the same `data/` a Docker container is using — SQLite locking is not reliable across the Docker Desktop file-sharing boundary.

## Configuration

See [`config/config.example.yml`](config/config.example.yml). `${VAR}` references in the YAML are expanded from environment variables so secrets can stay out of the file.

## Roadmap

- [ ] Friends' watchlists via the Plex community GraphQL API (owner token only, "Friends Only" visibility)
- [ ] Plex Pass RSS feeds as a near-real-time trigger between polls
- [ ] Removal sync (item left the watchlist → optional unmonitor)
- [ ] Minimal web UI for config & status
- [ ] Multi-arch Docker images (amd64/arm64) published on release

## License

MIT
