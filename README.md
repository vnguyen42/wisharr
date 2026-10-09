# Wisharr

[![CI](https://github.com/vnguyen42/wisharr/actions/workflows/ci.yml/badge.svg)](https://github.com/vnguyen42/wisharr/actions/workflows/ci.yml)

Sync Plex watchlists to **Seerr, Radarr and Sonarr** for **everyone in your Plex Home** and **your friends**, with a **single admin token**. Each Seerr request is credited to the person who wanted it, and nobody has to sign in anywhere.

![Dashboard](docs/screenshots/dashboard.png)

<details>
<summary>More screenshots: Users and Settings</summary>

![Users](docs/screenshots/users.png)
![Settings](docs/screenshots/settings.png)

</details>

## Why another watchlist tool?

Other bridges read watchlists through Plex's friends list, so members of your Plex Home who aren't also your Plex friends are missed. Seerr's own sync only covers people who have signed in to Seerr.

| As of October 2026 | Plex Home members | Friends | Credited per user | Sends to |
|---|---|---|---|---|
| Seerr built-in sync | If signed in to Seerr | If signed in to Seerr | Yes | Seerr |
| [Pulsarr](https://github.com/jamcalli/Pulsarr) | If also friends | Yes, admin token | In Pulsarr | Radarr, Sonarr |
| [Ombi](https://github.com/Ombi-app/Ombi) | If also friends | Yes, admin token | In Ombi | Ombi |
| [Watchlistarr](https://github.com/nylonee/watchlistarr) (no release since 2024) | If also friends | Yes, admin token | No | Radarr, Sonarr |
| Radarr/Sonarr import lists | No | Friends RSS feed, every 6 h | No | Radarr, Sonarr |
| **Wisharr** | **All** | **Yes, admin token** | **In Seerr** | **Seerr, Radarr, Sonarr** |

If you don't use Seerr and all your users are Plex friends, Pulsarr has many more features (routing rules, approvals, notifications).

Managed profiles (kids' profiles without their own Plex account) are read too, but Plex [hides Discover from them](https://support.plex.tv/articles/discover/), so they can't search for titles outside your library and rarely add anything new.

## How it works

Plex apps switch Home profiles with `POST plex.tv/api/home/users/{id}/switch`. Wisharr makes the same call with your admin token to get a token for each Home member, and gets a new one when plex.tv rejects it. Friends outside the Home are read through Plex's GraphQL API with the admin token only. Their watchlist visibility must allow friends.

New watchlist items become Seerr requests credited to the matching Seerr user, or direct Radarr/Sonarr adds. A local SQLite database remembers what was already sent.

- **Near real-time with Plex Pass:** your watchlist and your friends' watchlist RSS feeds are checked every 60 seconds. Everything else is picked up by the regular sync, every 20 minutes by default.
- **No request flood on first run:** existing watchlists are recorded but not requested. Only items added afterwards are sent (`sync.seedOnFirstRun`).
- **Removal sync (opt-in):** when an item leaves every watchlist, Wisharr deletes its Seerr request or unmonitors it in Radarr/Sonarr. It only touches items it added and never deletes files (`sync.removal`).
- **Web UI on port 9797:** dashboard, users, live logs and settings.

## Quick start (Docker)

```bash
mkdir wisharr && cd wisharr
curl -LO https://raw.githubusercontent.com/vnguyen42/wisharr/main/docker-compose.example.yml
curl -Lo config/config.yml --create-dirs https://raw.githubusercontent.com/vnguyen42/wisharr/main/config/config.example.yml
# Put PLEX_TOKEN and OVERSEERR_API_KEY (your Seerr API key) in a .env file
docker compose -f docker-compose.example.yml up -d
```

Then open http://localhost:9797. Images are multi-arch (amd64, arm64) on `ghcr.io/vnguyen42/wisharr`.

All options are documented in [`config/config.example.yml`](config/config.example.yml). `${VAR}` references are read from environment variables. If Wisharr runs on the same machine as Plex Media Server, `plex.token` can stay empty: it is read from the local Plex install.

<details>
<summary>Run from source</summary>

```bash
cp config/config.example.yml config/config.yml
npm install && npm install --prefix web && npm run --prefix web build
npm run sync   # one sync
npm run dev    # scheduled sync and web UI
```

</details>

## Security

The web UI has no login by default, and its API can read your Plex admin token and your Seerr/Radarr/Sonarr API keys. Keep port 9797 on your local network, or turn on basic auth:

```yaml
ui:
  auth:
    username: admin
    password: ${WISHARR_PASSWORD}
```

The `data/` folder stores Plex tokens for your Home profiles. Protect it and its backups like a password.

## Limitations

- Seerr auto-approves requests made with its API key, so watchlist requests skip Seerr's approval workflow (tested on Overseerr 1.33).
- Users without a Seerr account get their requests credited to the API key owner.
- Run one Wisharr per database file.

Overseerr and Jellyseerr use the same API as Seerr and work too.

## License

MIT
