# ✶✶ Reader

An RSS-style reader for [Are.na](https://www.are.na) — the links, images, and
text the people you follow are saving, newest first.

**[arena-reader.jsplit.me](https://arena-reader.jsplit.me)**

A static site: no build step, no framework, no backend, no dependencies.

## What it does

Sign in with Are.na and you get a chronological feed of blocks, in a list or a
grid. Narrow it three ways from the top bar:

| | |
| --- | --- |
| **Source** | My Network (people you follow) · My Are.na · All Are.na |
| **Sort** | Created · Updated · Random |
| **Type** | Links · Images · Embeds · Attachments · Text · All |

Each item shows its channel, who saved it, the source domain, and how many
times it's been connected. Anything you don't want to see again — a domain, a
person, a channel — can be muted from the item's own menu, and unmuted from the
filter panel.

## What's tied to your Are.na account

**Read-only.** The app calls three `GET` endpoints on the Are.na v3 API
(`/search`, `/blocks/:id/connections`, `/me`) and never writes anything back.
Your feed, your identity, and who you follow come from Are.na. Nothing else
does.

**Local to this browser, never sent to Are.na:** your mutes, the list/grid
preference, and the access token itself. Filters are yours alone — they don't
sync between devices and no one else sees them. Clearing site data resets
them.

Sign-in is OAuth 2.0 with PKCE, run entirely in the browser — no client secret,
no server. Tick **Remember device** to keep the token in `localStorage`;
otherwise it lives in `sessionStorage` and clears when you close the browser.
Are.na tokens don't expire, so signing out clears this browser only — revoke
access properly at
[are.na/developers/oauth/authorized](https://www.are.na/developers/oauth/authorized).

> **Note:** `scope=following` may require an Are.na Premium account. If you see
> a `402` or `403`, that's why.

## Keyboard shortcuts

| Key | |
| --- | --- |
| `j` / `k` | Next / previous item |
| `g` | Toggle grid / list |
| `f` | Toggle filters |
| `r` | Refresh feed |
| `?` | Show the shortcut sheet |

## Running it locally

```sh
python3 server.py    # http://127.0.0.1:8000
```

Any static server works; `server.py` just adds writable `filters.json`
persistence for local development. Sign-in needs a secure context — `https://`
or `http://127.0.0.1`.

**Hosting a fork?** Register your own app at
[are.na/developers/oauth/applications](https://www.are.na/developers/oauth/applications)
with your URL as the redirect URI, and set the client ID in `oauth.js`.

## Built with AI

Most of this was written with [Claude Code](https://claude.com/claude-code) —
over half the commits carry a Claude co-author trailer, and the rest were
hand-edited on top. Every line was reviewed and tested by a human before it
landed. `docs/` holds the API primer, OAuth notes, and security audit that came
out of that work.

## Contributing

Contributions welcome — it's a small codebase and an easy one to read. Open an
issue, or send a pull request. Bug reports and design nitpicks are just as
useful as code.

MIT licensed. Unofficial; not affiliated with Are.na.
