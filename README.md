# Are.na Link Reader

An RSS-style reader for links **recently created** by the people you follow on
[Are.na](https://www.are.na) — sorted by the date each link was *added to Are.na*.

The Are.na explore page lets you filter to links from people you follow:

```
https://www.are.na/explore?type=CONNECTABLE&sort=UPDATED_AT&block_filter=LINK&where=FOLLOWING
```

…but the UI only sorts by **UPDATED_AT** or random. This reader sorts by
**creation date** instead, which the website and apps don't expose.

## How it works

There is no public "explore" endpoint — that page is powered by Are.na's
internal GraphQL. But the documented **v3 REST API** offers the same thing
through a single search call:

```
GET https://api.are.na/v3/search
    ?query=*                 # wildcard — match everything, no keyword needed
    &scope=following         # only content from people you follow  (= where=FOLLOWING)
    &type=Link               # only link blocks                     (= block_filter=LINK)
    &sort=created_at_desc    # newest *created* first  ← the missing feature
    &per=50
    &page=N
Authorization: Bearer <personal access token>
```

| Explore URL param          | v3 `/search` equivalent  |
| -------------------------- | ------------------------ |
| `where=FOLLOWING`          | `scope=following`        |
| `block_filter=LINK`        | `type=Link`              |
| `sort=UPDATED_AT`          | `sort=updated_at_desc`   |
| *(not in UI)* created date | `sort=created_at_desc`   |

Because everything comes from one paginated endpoint (max `per=100`), it stays
well within Are.na's rate limits — no per-user fan-out, and it only fetches when
you open it, refresh, or click **Load more**.

Response envelope:

```jsonc
{
  "data": [ /* block objects */ ],
  "meta": { "current_page": 1, "total_pages": 12, "has_more_pages": true, "next_page": 2 }
}
```

## Running it

It's a static site — no build step, no server.

- **Locally:** open `index.html` in a browser, or serve the folder:
  ```sh
  python3 -m http.server 8000   # then visit http://localhost:8000
  ```
- **Hosted:** push to a static host (e.g. GitHub Pages) and visit the URL.

## Getting a token

1. Open your Are.na [personal access token settings](https://www.are.na/settings/personal-access-tokens).
2. Create an application (or open an existing one) and copy its **Personal
   Access Token**.
3. Paste it into the app. It's stored only in your browser's `localStorage`
   and sent only to `api.are.na`.

## Caveats

- **Premium:** the `scope=following` search may require an Are.na **Premium**
  account. If you get a `402`/`403`, that's the likely reason — the app shows a
  message saying so.
- **Token in the browser:** because this is a pure client-side tool, your token
  lives in `localStorage`. Fine for a personal reader on your own machine; if
  you ever host it publicly, anyone using it supplies their own token.
- **CORS:** the v3 API is designed for browser clients (the official SDK ships
  SPA examples), so direct calls should work. If a future change blocks
  cross-origin requests, you'd need a tiny proxy to add the `Authorization`
  header server-side.

## Files

| File         | Purpose                                            |
| ------------ | -------------------------------------------------- |
| `index.html` | Markup and controls (sort / type / refresh / token)|
| `styles.css` | Styling (light + dark via `prefers-color-scheme`)  |
| `app.js`     | Token handling, the `/v3/search` calls, rendering  |

Unofficial. Not affiliated with Are.na.
