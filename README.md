# Wisharr

Sync Plex watchlists to **Overseerr/Jellyseerr, Radarr and Sonarr** — including **Plex Home managed users**, with a **single admin token** and zero token copy-pasting, ever.

## Why another watchlist tool?

Every existing bridge breaks on the same wall: Plex doesn't give third-party apps refresh tokens, and per-user tokens expire silently.

- **Overseerr/Jellyseerr** built-in sync needs each user to re-login periodically — and Plex Home **managed users can't log in at all** (they have no plex.tv credentials), so their watchlists are simply invisible.
- **Watchlistarr** covers friends with the owner token, but is dormant and doesn't handle Home managed users.
- **Radarr/Sonarr** native import lists only see your own account.

Wisharr uses the same API Plex's own clients use to switch profiles: `POST plex.tv/api/home/users/{id}/switch` with your admin token returns a fresh token scoped to the managed user. Tokens are re-minted **every sync cycle**, so nothing ever expires. Your admin token is the only secret, and it stays alive as long as you use Plex normally.

## Quick start

```bash
cp config/config.example.yml config/config.yml
# edit config.yml, or export PLEX_TOKEN / OVERSEERR_API_KEY
npm install
npm run sync        # one-shot
npm run dev         # scheduled loop (default: every 20 min)
```

Or with Docker:

```bash
docker compose -f docker-compose.example.yml up -d
```

## How it works

1. `GET plex.tv/api/home/users` — enumerate every profile in your Plex Home (admin token).
2. For each managed profile, `POST .../switch` mints a fresh user-scoped token (with the profile's PIN if protected).
3. `GET discover.provider.plex.tv/library/sections/watchlist/all` — fetch that user's watchlist; external IDs (TMDB/TVDB/IMDB) resolved per item.
4. Push to your configured sinks — Overseerr/Jellyseerr requests, or direct Radarr/Sonarr adds. A local SQLite store dedups so items are only pushed once per user per sink.

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
