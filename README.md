# ✶✶ Reader

An RSS-style reader for links from people you follow on [Are.na](https://www.are.na), sorted by creation date.

<!-- Add screenshots here: ![List view](screenshots/list-light.png) -->

## How it works

Built on the Are.na **v3 REST API** using a single search endpoint:

```
GET https://api.are.na/v3/search
    ?query=*                 # wildcard — match everything
    &scope=following         # only content from people you follow
    &type=Link               # only link blocks
    &sort=created_at_desc    # newest created first
    &per=50
    &page=N
Authorization: Bearer <personal access token>
```

The feed comes from one paginated endpoint (plus one lightweight per-block connections lookup for channel/count enrichment) and only fetches when you open it, refresh, or click **Load more** — keeping it inside Are.na's documented per-tier rate limits for typical use.

## Running it

It's a static site — no build step, no framework.

**Locally:**

```sh
python3 server.py        # serves at http://localhost:8000
```

The included `server.py` also handles saving filter preferences to a local `filters.json` file. You can also use any static server — filters will fall back to `localStorage`.

**Hosted:** push to a static host (e.g. GitHub Pages) and visit the URL.

## Signing in

Click **Sign in with Are.na** and authorize the app — the OAuth flow (authorization code + PKCE) runs entirely in your browser; no secrets, no backend.

- Tick **Remember on this device** before signing in to stay signed in across browser restarts; otherwise the token clears when the browser session ends.
- Sign-in needs a secure context: `https://` in production, or `http://127.0.0.1` for local dev.
- **Hosting a fork?** Register your own OAuth application at [are.na/developers/oauth/applications](https://www.are.na/developers/oauth/applications) with your URL as the redirect URI, and set its client ID in `oauth.js`.

## Caveats

- **Premium:** the `scope=following` search may require an Are.na Premium account. If you get a `402`/`403`, the app shows a message explaining this.
- **Token in the browser:** because this is a pure client-side tool, your token lives in the browser. By default it's kept in `sessionStorage` (cleared when the browser session ends); tick **Remember on this device** to persist it in `localStorage`. Are.na tokens never expire, so signing out clears this browser only — revoke the app's access in your [Are.na settings](https://www.are.na/settings) to fully invalidate it.
- **CORS:** the v3 API supports browser clients, so direct calls work. If a future change blocks cross-origin requests, you'd need a proxy to add the `Authorization` header server-side.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Markup and controls |
| `styles.css` | Styling (light + dark via `prefers-color-scheme`) |
| `app.js` | Token handling, API calls, rendering, filtering |
| `oauth.js` | Sign in with Are.na (OAuth 2.0 + PKCE) |
| `server.py` | Optional dev server with filter persistence |
| `manifest.json` | PWA manifest for home screen install |

Unofficial. Not affiliated with Are.na.
