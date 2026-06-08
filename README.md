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

Because everything comes from one paginated endpoint, it stays well within Are.na's rate limits — no per-user fan-out, and it only fetches when you open it, refresh, or click **Load more**.

## Running it

It's a static site — no build step, no framework.

**Locally:**

```sh
python3 server.py        # serves at http://localhost:8000
```

The included `server.py` also handles saving filter preferences to a local `filters.json` file. You can also use any static server — filters will fall back to `localStorage`.

**Hosted:** push to a static host (e.g. GitHub Pages) and visit the URL.

## Getting a token

1. Go to your Are.na [personal access token settings](https://www.are.na/settings/personal-access-tokens).
2. Create an application (or open an existing one) and copy its **Personal Access Token**.
3. Paste it into the app. It's stored only in your browser's `localStorage` and sent only to `api.are.na`.

## Caveats

- **Premium:** the `scope=following` search may require an Are.na Premium account. If you get a `402`/`403`, the app shows a message explaining this.
- **Token in the browser:** because this is a pure client-side tool, your token lives in `localStorage`. Fine for a personal reader on your own machine; if you host it publicly, each user supplies their own token.
- **CORS:** the v3 API supports browser clients, so direct calls work. If a future change blocks cross-origin requests, you'd need a proxy to add the `Authorization` header server-side.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Markup and controls |
| `styles.css` | Styling (light + dark via `prefers-color-scheme`) |
| `app.js` | Token handling, API calls, rendering, filtering |
| `server.py` | Optional dev server with filter persistence |
| `manifest.json` | PWA manifest for home screen install |

Unofficial. Not affiliated with Are.na.
