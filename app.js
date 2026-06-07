/*
 * Are.na Link Reader
 * -------------------
 * An RSS-style reader for links recently *created* by people you follow.
 *
 * The Are.na website's explore page lets you filter by FOLLOWING and by LINK
 * blocks, but only sorts by UPDATED_AT or random. The v3 API exposes a
 * creation-date sort that the UI doesn't, via a single endpoint:
 *
 *   GET https://api.are.na/v3/search
 *       ?query=*               wildcard -> match everything (no keyword needed)
 *       &scope=following       only content from people you follow
 *       &type=Link             only link blocks
 *       &sort=created_at_desc  newest *created* first  <-- the missing feature
 *       &per=50&page=N
 *   Authorization: Bearer <personal access token>
 *
 * One paginated endpoint, so it stays well within rate limits.
 */

const API_BASE = 'https://api.are.na/v3';
const TOKEN_KEY = 'arena_link_reader_token';
const PER_PAGE = 50;

const state = {
  token: localStorage.getItem(TOKEN_KEY) || '',
  page: 1,
  sort: 'created_at_desc',
  type: 'Link',
  loading: false,
  hasMore: false,
};

/* ---------- element refs ---------- */
const el = {
  controls: document.getElementById('controls'),
  sort: document.getElementById('sort'),
  type: document.getElementById('type'),
  refresh: document.getElementById('refresh'),
  settingsToggle: document.getElementById('settings-toggle'),
  auth: document.getElementById('auth'),
  tokenForm: document.getElementById('token-form'),
  tokenInput: document.getElementById('token-input'),
  status: document.getElementById('status'),
  feed: document.getElementById('feed'),
  loadmore: document.getElementById('loadmore'),
};

/* ---------- API ---------- */
function searchUrl(page) {
  const params = new URLSearchParams({
    query: '*',
    scope: 'following',
    type: state.type,
    sort: state.sort,
    per: String(PER_PAGE),
    page: String(page),
  });
  return `${API_BASE}/search?${params.toString()}`;
}

async function fetchPage(page) {
  const res = await fetch(searchUrl(page), {
    headers: {
      Authorization: `Bearer ${state.token}`,
      Accept: 'application/json',
    },
  });

  if (!res.ok) {
    let detail = '';
    try {
      const body = await res.json();
      detail = body.message || body.error || '';
    } catch (_) { /* ignore non-JSON bodies */ }
    throw new ApiError(res.status, detail);
  }
  return res.json();
}

class ApiError extends Error {
  constructor(status, detail) {
    super(detail || `Request failed (${status})`);
    this.status = status;
    this.detail = detail;
  }
}

/* ---------- field helpers (defensive: the API shape can vary by block type) ---------- */
function mdText(mc) {
  if (!mc) return '';
  if (typeof mc === 'string') return mc;
  if (mc.plaintext) return mc.plaintext;
  if (mc.plain_text) return mc.plain_text;
  if (mc.markdown) return mc.markdown;
  if (mc.html) return stripHtml(mc.html);
  return '';
}

function stripHtml(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return tmp.textContent || tmp.innerText || '';
}

function blockImage(b) {
  const img = b.image;
  if (!img) return null;
  const variant = img.medium || img.large || img.square || img.small || img;
  return (variant && (variant.src || variant.url)) || img.src || null;
}

function sourceUrl(b) {
  if (b.source && b.source.url) return b.source.url;
  return null;
}

function blockUrl(b) {
  return `https://www.are.na/block/${b.id}`;
}

function domainLabel(b) {
  if (b.source && b.source.provider && b.source.provider.name) {
    return b.source.provider.name;
  }
  const url = sourceUrl(b);
  if (!url) return '';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch (_) {
    return '';
  }
}

function userName(u) {
  return (u && u.name) || 'Someone';
}
function userUrl(u) {
  return u && u.slug ? `https://www.are.na/${u.slug}` : null;
}
function avatarUrl(u) {
  if (!u || !u.avatar) return null;
  if (typeof u.avatar === 'string') return u.avatar;
  return u.avatar.src || u.avatar.url || null;
}

function relativeTime(iso) {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const secs = Math.round((Date.now() - then) / 1000);
  const units = [
    ['year', 31536000],
    ['month', 2592000],
    ['week', 604800],
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
  ];
  for (const [name, size] of units) {
    const n = Math.floor(secs / size);
    if (n >= 1) return `${n} ${name}${n > 1 ? 's' : ''} ago`;
  }
  return 'just now';
}

function absoluteTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

/* ---------- rendering ---------- */
function renderItem(b) {
  const item = document.createElement('article');
  item.className = 'item';

  const href = sourceUrl(b) || blockUrl(b);
  const title = b.title || (sourceUrl(b) ? domainLabel(b) : '') || 'Untitled';
  const desc = mdText(b.description) || mdText(b.content);
  const domain = domainLabel(b);
  const user = b.user || {};
  const avatar = avatarUrl(user);
  const uUrl = userUrl(user);
  const created = b.created_at;

  const body = document.createElement('div');
  body.className = 'item-body';

  // Title
  const h = document.createElement('h2');
  h.className = 'item-title';
  const a = document.createElement('a');
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener';
  a.textContent = title;
  h.appendChild(a);
  body.appendChild(h);

  // Source domain
  if (domain) {
    const src = document.createElement('div');
    src.className = 'item-source';
    src.textContent = domain;
    body.appendChild(src);
  }

  // Description
  if (desc) {
    const p = document.createElement('p');
    p.className = 'item-desc';
    p.textContent = desc;
    body.appendChild(p);
  }

  // Meta row: avatar, author, time, are.na link
  const meta = document.createElement('div');
  meta.className = 'item-meta';

  if (avatar) {
    const img = document.createElement('img');
    img.className = 'avatar';
    img.src = avatar;
    img.alt = '';
    img.loading = 'lazy';
    meta.appendChild(img);
  }

  meta.appendChild(metaLink(userName(user), uUrl));
  meta.appendChild(dot());

  const time = document.createElement('time');
  time.dateTime = created || '';
  time.textContent = relativeTime(created);
  time.title = absoluteTime(created);
  meta.appendChild(time);

  meta.appendChild(dot());
  meta.appendChild(metaLink('on Are.na', blockUrl(b)));

  body.appendChild(meta);
  item.appendChild(body);

  // Thumbnail
  const thumb = blockImage(b);
  if (thumb) {
    const link = document.createElement('a');
    link.href = href;
    link.target = '_blank';
    link.rel = 'noopener';
    const img = document.createElement('img');
    img.className = 'item-thumb';
    img.src = thumb;
    img.alt = '';
    img.loading = 'lazy';
    link.appendChild(img);
    item.appendChild(link);
  }

  return item;
}

function metaLink(text, href) {
  if (!href) {
    const span = document.createElement('span');
    span.textContent = text;
    return span;
  }
  const a = document.createElement('a');
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener';
  a.textContent = text;
  return a;
}

function dot() {
  const s = document.createElement('span');
  s.className = 'dot';
  s.textContent = '·';
  return s;
}

/* ---------- status helpers ---------- */
function setStatus(message, kind) {
  if (!message) {
    el.status.hidden = true;
    el.status.textContent = '';
    el.status.className = 'status';
    return;
  }
  el.status.hidden = false;
  el.status.className = `status ${kind || ''}`.trim();
  el.status.textContent = message;
}

function friendlyError(err) {
  if (err instanceof ApiError) {
    switch (err.status) {
      case 401:
        return 'Your token was rejected (401). Double-check the personal access token, then re-enter it via the Token button.';
      case 402:
      case 403:
        return `Access denied (${err.status}). The "following" search may require an Are.na Premium account.${err.detail ? ' — ' + err.detail : ''}`;
      case 429:
        return 'Rate limited (429). Wait a moment and try again.';
      default:
        return `Are.na returned an error (${err.status}).${err.detail ? ' — ' + err.detail : ''}`;
    }
  }
  // Network / CORS / offline
  return 'Could not reach api.are.na. Check your connection (and that the browser allows the request).';
}

/* ---------- feed loading ---------- */
async function loadFeed({ reset }) {
  if (state.loading) return;
  state.loading = true;

  if (reset) {
    state.page = 1;
    el.feed.innerHTML = '';
    el.loadmore.hidden = true;
  }

  el.loadmore.disabled = true;
  setStatus(reset ? 'Loading your feed…' : 'Loading more…', 'loading');

  try {
    const data = await fetchPage(state.page);
    const blocks = Array.isArray(data.data) ? data.data : [];
    const meta = data.meta || {};

    const frag = document.createDocumentFragment();
    for (const b of blocks) frag.appendChild(renderItem(b));
    el.feed.appendChild(frag);

    state.hasMore = meta.has_more_pages ?? (blocks.length === PER_PAGE);
    if (state.hasMore) state.page += 1;

    setStatus('');

    if (el.feed.children.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'No links yet. Try following more people on Are.na, or switch the Type filter.';
      el.feed.appendChild(empty);
      el.loadmore.hidden = true;
    } else {
      el.loadmore.hidden = !state.hasMore;
    }
  } catch (err) {
    setStatus(friendlyError(err), 'error');
    if (err instanceof ApiError && err.status === 401) showAuth(true);
  } finally {
    state.loading = false;
    el.loadmore.disabled = false;
  }
}

/* ---------- view switching ---------- */
function showAuth(show) {
  el.auth.hidden = !show;
  el.controls.hidden = show;
  if (show) {
    el.tokenInput.value = '';
    el.tokenInput.focus();
  }
}

function start() {
  // hydrate controls from state
  el.sort.value = state.sort;
  el.type.value = state.type;

  if (state.token) {
    showAuth(false);
    loadFeed({ reset: true });
  } else {
    showAuth(true);
  }
}

/* ---------- events ---------- */
el.tokenForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const value = el.tokenInput.value.trim();
  if (!value) return;
  state.token = value;
  localStorage.setItem(TOKEN_KEY, value);
  setStatus('');
  showAuth(false);
  loadFeed({ reset: true });
});

el.settingsToggle.addEventListener('click', () => {
  showAuth(el.auth.hidden);
});

el.sort.addEventListener('change', () => {
  state.sort = el.sort.value;
  loadFeed({ reset: true });
});

el.type.addEventListener('change', () => {
  state.type = el.type.value;
  loadFeed({ reset: true });
});

el.refresh.addEventListener('click', () => loadFeed({ reset: true }));
el.loadmore.addEventListener('click', () => loadFeed({ reset: false }));

start();
