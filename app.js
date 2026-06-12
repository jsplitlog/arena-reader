/*
 * Are.na Link Reader
 */

const API_BASE = 'https://api.are.na/v3';
const TOKEN_KEY = 'arena_link_reader_token';
const VIEW_KEY = 'arena_link_reader_view';
const FILTERS_KEY = 'arena_link_reader_filters';
const PER_PAGE = 50;

// Popular = blocks created in this window, ranked by all-time connection
// count. One opinionated query — the v3 search API can't rank by *recent*
// connection activity, and a user-facing window picker only obscured that
// (see issue #22). The sort-dropdown option is currently removed pending a
// rework; setting state.sort = 'popular' still works end to end.
const POPULAR_WINDOW_DAYS = 30;

// Default landing filter: My Network · Created · Links
const DEFAULT_SCOPE = 'network';
const DEFAULT_SORT = 'created_at_desc';
const DEFAULT_TYPE = 'Link';

const state = {
  // Both auth paths store via saveToken(): sessionStorage by default,
  // localStorage when "Remember on this device" is checked.
  token: sessionStorage.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY) || '',
  page: 1,
  sort: DEFAULT_SORT,
  type: DEFAULT_TYPE,
  scope: DEFAULT_SCOPE,
  view: localStorage.getItem(VIEW_KEY) || 'list',
  filters: Object.assign(
    { enabled: true, domains: {}, users: {}, channels: {} },
    JSON.parse(localStorage.getItem(FILTERS_KEY) || '{}'),
  ),
  loading: false,
  hasMore: false,
  user: null,
};

// Ensure filter dimensions exist for legacy localStorage
if (!state.filters.users) state.filters.users = {};
if (!state.filters.channels) state.filters.channels = {};

// Drop the retired Popular time-window prefs from older versions
localStorage.removeItem('arena_link_reader_hotlinks');

/* ---------- element refs ---------- */
const el = {
  title: document.getElementById('app-title'),
  controls: document.getElementById('controls'),
  scope: document.getElementById('scope'),
  sort: document.getElementById('sort'),
  type: document.getElementById('type'),
  refresh: document.getElementById('refresh'),
  settingsToggle: document.getElementById('settings-toggle'),
  auth: document.getElementById('auth'),
  oauthConnect: document.getElementById('oauth-connect'),
  oauthSignin: document.getElementById('oauth-signin'),
  rememberToken: document.getElementById('remember-token'),
  rememberLabel: document.getElementById('remember-label'),
  status: document.getElementById('status'),
  feed: document.getElementById('feed'),
  loadmore: document.getElementById('loadmore'),
  authMsg: document.getElementById('auth-msg'),
  authTagline: document.getElementById('auth-tagline'),
  authOverlay: document.getElementById('auth-overlay'),
  authClose: document.getElementById('auth-close'),
  authUser: document.getElementById('auth-user'),
  authAvatar: document.getElementById('auth-avatar'),
  authUsername: document.getElementById('auth-username'),
  authActions: document.getElementById('auth-actions'),
  authMemberSince: document.getElementById('auth-member-since'),
  viewToggle: document.getElementById('view-toggle'),
  filterBtn: document.getElementById('filter-btn'),
  filterCount: document.getElementById('filter-count'),
  filterDropdown: document.getElementById('filter-dropdown'),
  filterList: document.getElementById('filter-list'),
  filterToggle: document.getElementById('filter-toggle'),
  container: document.querySelector('.container'),
  topbar: document.querySelector('.topbar'),
  topbarInner: document.querySelector('.topbar-inner'),
  selectRow: document.querySelector('.select-row'),
};

// On mobile the three selects are equal-width thirds whose label size
// scales to fit (see .select-row in styles.css). The CSS divisor encodes
// the widest label that must fit; recompute it from the currently
// *selected* options so e.g. showing "Links" doesn't reserve room for
// "Attachments". The 1.02 factor absorbs font rendering differences
// between the canvas measurement and the real select.
const labelMeasureCtx = document.createElement('canvas').getContext('2d');
function fitSelectLabels() {
  const { fontWeight, fontFamily } = getComputedStyle(el.scope);
  labelMeasureCtx.font = `${fontWeight} 100px ${fontFamily}`;
  const widest = Math.max(...[el.scope, el.sort, el.type].map(
    (s) => labelMeasureCtx.measureText(s.options[s.selectedIndex]?.text || '').width / 100
  ));
  el.selectRow.style.setProperty('--select-fit-divisor', (3 * (widest * 1.02 + 2.125)).toFixed(2));
}

/* ---------- API ---------- */
function searchUrl(page) {
  const isPopular = state.sort === 'popular';
  const params = new URLSearchParams({
    query: '*',
    type: state.type,
    sort: isPopular ? 'connections_count_desc' : state.sort,
    per: String(PER_PAGE),
    page: String(page),
  });
  if (isPopular) {
    const since = new Date(Date.now() - POPULAR_WINDOW_DAYS * 86400000).toISOString();
    params.set('after', since);
  }
  // scope mapping — API accepts: all, my, following
  if (state.scope === 'network') params.set('scope', 'following');
  else if (state.scope === 'me') params.set('scope', 'my');
  // 'all' → omit scope (defaults to all)
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
    } catch (_) {}
    // Unix timestamp of the current rate-limit window's end (v3 docs).
    const resetAt = Number(res.headers.get('X-RateLimit-Reset')) || 0;
    throw new ApiError(res.status, detail, resetAt);
  }
  return res.json();
}

class ApiError extends Error {
  constructor(status, detail, resetAt) {
    super(detail || `Request failed (${status})`);
    this.status = status;
    this.detail = detail;
    this.resetAt = resetAt || 0;
  }
}

/* ---------- field helpers ---------- */
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
  // DOMParser yields an inert document — resources don't load and event
  // handlers never fire, unlike innerHTML on a live element. Block HTML is
  // authored by other users, so it must never be activated.
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return doc.body.textContent || '';
}

function blockImage(b) {
  const img = b.image;
  if (!img) return null;
  const variant = img.medium || img.large || img.square || img.small || img;
  return (variant && (variant.src || variant.url)) || img.src || null;
}

function sourceUrl(b) {
  return (b.source && b.source.url) || null;
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
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch (_) { return ''; }
}

function domainHost(b) {
  const url = sourceUrl(b);
  if (!url) return '';
  try { return new URL(url).hostname.replace(/^(www|m|mobile|amp|l|lm)\./, ''); } catch (_) { return ''; }
}

function faviconUrl(domain) {
  if (!domain) return null;
  // Fetched from the source site itself rather than a third-party favicon
  // service, so the list of domains you read isn't shipped to Google.
  return `https://${domain}/favicon.ico`;
}

function faviconImg(domain) {
  const fav = document.createElement('img');
  fav.className = 'favicon';
  fav.src = faviconUrl(domain);
  fav.alt = '';
  fav.loading = 'lazy';
  // Many sites have no /favicon.ico — drop the broken image quietly.
  fav.addEventListener('error', () => fav.remove());
  return fav;
}

function userName(u) { return (u && u.name) || 'Someone'; }
function userSlug(u) { return (u && u.slug) || ''; }
function userUrl(u) { return u && u.slug ? `https://www.are.na/${u.slug}` : null; }
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
  const units = [['y',31536000],['mo',2592000],['w',604800],['d',86400],['h',3600],['m',60]];
  for (const [name, size] of units) {
    const n = Math.floor(secs / size);
    if (n >= 1) return `${n}${name}`;
  }
  return 'now';
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

/* ---------- filtering ---------- */
function saveFilters() {
  localStorage.setItem(FILTERS_KEY, JSON.stringify(state.filters));
  // Persist to file (server.py handles POST /filters.json)
  fetch('filters.json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(state.filters, null, 2),
  }).catch(() => {});
}

async function loadFiltersFromFile() {
  try {
    const res = await fetch('filters.json');
    if (!res.ok) return;
    const data = await res.json();
    if (data && typeof data === 'object') {
      state.filters = Object.assign({ enabled: true, domains: {}, users: {}, channels: {} }, data);
      localStorage.setItem(FILTERS_KEY, JSON.stringify(state.filters));
    }
  } catch (_) {}
}

function isItemFiltered(domain, slug, channel) {
  if (!state.filters.enabled) return false;
  if (domain) {
    if (state.filters.domains[domain]) return true;
    // Suffix match: m.youtube.com matches a filter for youtube.com
    for (const fd of Object.keys(state.filters.domains)) {
      if (domain.endsWith('.' + fd)) return true;
    }
  }
  if (slug && state.filters.users[slug]) return true;
  if (channel && state.filters.channels[channel]) return true;
  return false;
}

function filterDomain(domain, displayName) {
  if (!domain) return;
  state.filters.domains[domain] = displayName || domain;
  saveFilters();
  applyFilters();
  renderFilterUI();
}

function unfilterDomain(domain) {
  delete state.filters.domains[domain];
  saveFilters();
  applyFilters();
  renderFilterUI();
}

function filterUser(slug, name) {
  if (!slug) return;
  state.filters.users[slug] = name || slug;
  saveFilters();
  applyFilters();
  renderFilterUI();
}

function unfilterUser(slug) {
  delete state.filters.users[slug];
  saveFilters();
  applyFilters();
  renderFilterUI();
}

function filterChannel(slug, title) {
  if (!slug) return;
  state.filters.channels[slug] = title || slug;
  saveFilters();
  applyFilters();
  renderFilterUI();
}

function unfilterChannel(slug) {
  delete state.filters.channels[slug];
  saveFilters();
  applyFilters();
  renderFilterUI();
}

function applyFilters() {
  el.feed.querySelectorAll('.item').forEach((item) => {
    const d = item.getAttribute('data-domain') || '';
    const u = item.getAttribute('data-user') || '';
    const c = item.getAttribute('data-channel') || '';
    item.classList.toggle('filtered', isItemFiltered(d, u, c));
  });
}

function renderFilterUI() {
  const domainKeys = Object.keys(state.filters.domains);
  const userKeys = Object.keys(state.filters.users);
  const channelKeys = Object.keys(state.filters.channels);
  const count = domainKeys.length + userKeys.length + channelKeys.length;

  el.filterCount.hidden = count === 0;
  el.filterCount.textContent = count;
  el.filterCount.classList.toggle('disabled', !state.filters.enabled);
  el.filterToggle.textContent = state.filters.enabled ? 'On' : 'Off';
  el.filterDropdown.querySelector('.filter-dropdown-head').hidden = count === 0;

  el.filterList.innerHTML = '';

  // Empty state
  if (count === 0) {
    const empty = document.createElement('div');
    empty.className = 'filter-empty';
    empty.textContent = 'Filter users, sources, or channels from the menu on any block.';
    el.filterList.appendChild(empty);
  }

  // Domains section
  if (domainKeys.length) {
    const heading = document.createElement('div');
    heading.className = 'filter-section-label';
    heading.textContent = 'Domains';
    el.filterList.appendChild(heading);
    for (const d of domainKeys.sort()) {
      const label = typeof state.filters.domains[d] === 'string' ? state.filters.domains[d] : d;
      el.filterList.appendChild(filterRow(label, () => unfilterDomain(d), true, d));
    }
  }

  // Users section
  if (userKeys.length) {
    const heading = document.createElement('div');
    heading.className = 'filter-section-label';
    heading.textContent = 'Users';
    el.filterList.appendChild(heading);
    for (const slug of userKeys.sort()) {
      const name = state.filters.users[slug] || slug;
      el.filterList.appendChild(filterRow(name, () => unfilterUser(slug)));
    }
  }

  // Channels section
  if (channelKeys.length) {
    const heading = document.createElement('div');
    heading.className = 'filter-section-label';
    heading.textContent = 'Channels';
    el.filterList.appendChild(heading);
    for (const slug of channelKeys.sort()) {
      const title = state.filters.channels[slug] || slug;
      el.filterList.appendChild(filterRow(title, () => unfilterChannel(slug)));
    }
  }
}

function filterRow(label, onRemove, isDomain, host) {
  const row = document.createElement('div');
  row.className = 'filter-row';

  if (isDomain) {
    row.appendChild(faviconImg(host || label));
  }

  const span = document.createElement('span');
  span.className = 'filter-domain';
  span.textContent = label;
  row.appendChild(span);

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'filter-remove';
  btn.textContent = 'Restore';
  btn.addEventListener('click', onRemove);
  row.appendChild(btn);

  return row;
}

/* ---------- rendering ---------- */
function renderItem(b) {
  const item = document.createElement('article');
  item.className = 'item';
  const domain = domainHost(b);
  const domainDisplay = domainLabel(b);
  const user = b.user || {};
  const slug = userSlug(user);
  if (domain) item.setAttribute('data-domain', domain);
  if (slug) item.setAttribute('data-user', slug);
  if (isItemFiltered(domain, slug)) item.classList.add('filtered');

  const href = sourceUrl(b) || blockUrl(b);
  const title = b.title || (sourceUrl(b) ? domainDisplay : '') || 'Untitled';
  const desc = mdText(b.description) || mdText(b.content);
  const avatar = avatarUrl(user);
  const uUrl = userUrl(user);
  const created = b.created_at;
  const name = userName(user);

  const body = document.createElement('div');
  body.className = 'item-body';

  // Title
  const h = document.createElement('div');
  h.className = 'item-title';
  const a = document.createElement('a');
  a.href = href; a.target = '_blank'; a.rel = 'noopener';
  a.textContent = title;
  h.appendChild(a);
  body.appendChild(h);

  // Source domain with favicon (always show hostname, not provider name)
  if (domain) {
    const src = document.createElement('div');
    src.className = 'item-source';
    src.appendChild(faviconImg(domain));
    const srcLink = document.createElement('a');
    srcLink.href = href; srcLink.target = '_blank'; srcLink.rel = 'noopener';
    srcLink.textContent = domain;
    src.appendChild(srcLink);
    body.appendChild(src);
  }

  // Description
  if (desc) {
    const p = document.createElement('p');
    p.className = 'item-desc';
    p.textContent = desc;
    body.appendChild(p);
  }

  item.appendChild(body);

  // Thumbnail/preview wrapper (clean — no overlay controls)
  const thumbWrap = document.createElement('div');
  thumbWrap.className = 'item-thumb-wrap';

  const thumb = blockImage(b);
  if (thumb) {
    const link = document.createElement('a');
    link.href = href; link.target = '_blank'; link.rel = 'noopener';
    const img = document.createElement('img');
    img.className = 'item-thumb'; img.src = thumb; img.alt = ''; img.loading = 'lazy';
    link.appendChild(img);
    thumbWrap.appendChild(link);
  } else {
    const preview = document.createElement('div');
    preview.className = 'item-preview';
    const previewText = desc || title || '';
    if (previewText) {
      const p = document.createElement('p');
      p.textContent = previewText;
      preview.appendChild(p);
    }
    thumbWrap.appendChild(preview);
  }

  item.appendChild(thumbWrap);

  // Author line: avatar, name …spacer… ✶✶ · timestamp
  const authorLine = document.createElement('div');
  authorLine.className = 'item-author';
  if (avatar) {
    const avImg = document.createElement('img');
    avImg.className = 'avatar'; avImg.src = avatar; avImg.alt = ''; avImg.loading = 'lazy';
    authorLine.appendChild(avImg);
  } else {
    const avFallback = document.createElement('span');
    avFallback.className = 'avatar avatar-fallback';
    avFallback.textContent = (name || '?').charAt(0).toUpperCase();
    authorLine.appendChild(avFallback);
  }
  authorLine.appendChild(metaLink(name, uUrl));
  const authorSpacer = document.createElement('span');
  authorSpacer.className = 'meta-spacer';
  authorLine.appendChild(authorSpacer);
  item.appendChild(authorLine);

  // Meta bottom: channel …spacer… actions menu
  const meta = document.createElement('div');
  meta.className = 'item-meta';
  const metaLine = document.createElement('div');
  metaLine.className = 'meta-line';
  const channelSpan = document.createElement('span');
  channelSpan.className = 'meta-channel';
  channelSpan.setAttribute('data-block-id', String(b.id));
  metaLine.appendChild(channelSpan);
  const mSpacer = document.createElement('span');
  mSpacer.className = 'meta-spacer';
  metaLine.appendChild(mSpacer);
  const time = document.createElement('time');
  time.dateTime = created || '';
  time.textContent = relativeTime(created);
  time.title = absoluteTime(created);
  metaLine.appendChild(time);
  const arenaLink = metaLink('✶✶', blockUrl(b));
  arenaLink.title = 'View on Are.na';
  metaLine.appendChild(arenaLink);

  if (domain || slug) {
    const actions = document.createElement('div');
    actions.className = 'item-actions';
    const actBtn = document.createElement('button');
    actBtn.type = 'button';
    actBtn.className = 'item-actions-btn';
    actBtn.setAttribute('aria-label', 'Actions');
    actBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/></svg>';
    actions.appendChild(actBtn);

    const actMenu = document.createElement('div');
    actMenu.className = 'item-actions-menu';
    if (domain) {
      const dLabel = document.createElement('span');
      dLabel.className = 'actions-menu-label';
      dLabel.textContent = 'Domain';
      actMenu.appendChild(dLabel);
      const dBtn = document.createElement('button');
      dBtn.type = 'button';
      dBtn.textContent = domainDisplay;
      dBtn.addEventListener('click', () => { filterDomain(domain, domainDisplay); actMenu.classList.remove('open'); });
      actMenu.appendChild(dBtn);
    }
    if (slug) {
      const uLabel = document.createElement('span');
      uLabel.className = 'actions-menu-label';
      uLabel.textContent = 'User';
      actMenu.appendChild(uLabel);
      const uBtn = document.createElement('button');
      uBtn.type = 'button';
      uBtn.textContent = name;
      uBtn.addEventListener('click', () => { filterUser(slug, name); actMenu.classList.remove('open'); });
      actMenu.appendChild(uBtn);
    }
    actions.appendChild(actMenu);

    actBtn.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      document.querySelectorAll('.item-actions-menu').forEach(m => { if (m !== actMenu) m.classList.remove('open'); });
      actMenu.classList.toggle('open');
    });
    authorLine.appendChild(actions);
  }

  meta.appendChild(metaLine);
  item.appendChild(meta);

  return item;
}

function metaLink(text, href) {
  if (!href) { const s = document.createElement('span'); s.textContent = text; return s; }
  const a = document.createElement('a');
  a.href = href; a.target = '_blank'; a.rel = 'noopener'; a.textContent = text;
  return a;
}

function dot() {
  const s = document.createElement('span');
  s.className = 'dot'; s.textContent = '·';
  return s;
}

/* ---------- channel + connection enrichment ---------- */
// One request per block (channel + count come from the same connections
// response) — the previous two-fetch version doubled the request volume and
// brushed the free tier's documented 120 req/min limit.
//
// Attribution shows the first channel the block was connected to (issue #31).
// A block only comes into existence by being connected to a channel, so the
// oldest connection is the adding user's first channel by construction.
// The v3 endpoint returns plain Channel objects ordered by *connection*
// creation time (`sort` accepts exactly created_at_desc — the default — and
// created_at_asc; anything else is a 400). The items carry no connector and
// no connection timestamp — their created_at is the channel's own creation
// date — so the API's ascending order is the only usable signal and must not
// be re-sorted client-side. When the original connection was deleted or is
// in a private channel, this degrades to the oldest connection still visible
// to the viewer.
async function fetchConnectionInfo(blockId) {
  try {
    const res = await fetch(`${API_BASE}/blocks/${blockId}/connections?per=1&sort=created_at_asc`, {
      headers: { Authorization: `Bearer ${state.token}`, Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const meta = data.meta || {};
    const first = Array.isArray(data.data) && data.data[0];
    return {
      channel: first ? { title: first.title, slug: first.slug, userSlug: (first.owner && first.owner.slug) || '' } : null,
      count: meta.total_count ?? meta.total ?? (Array.isArray(data.data) ? data.data.length : 0),
    };
  } catch (_) { return null; }
}

async function enrichChannels() {
  const showCounts = state.sort === 'popular';
  const spans = el.feed.querySelectorAll('.meta-channel[data-block-id]');
  const work = [...spans].filter((s) => !s.dataset.done);
  await Promise.all(work.map(async (span) => {
    const id = span.getAttribute('data-block-id');
    span.dataset.done = '1';
    const item = span.closest('.item');
    const info = await fetchConnectionInfo(id);
    if (!info) return;

    if (showCounts && info.count >= 2) {
      const line = span.closest('.meta-line');
      if (line) {
        line.appendChild(dot());
        const badge = document.createElement('span');
        badge.className = 'connection-badge';
        badge.textContent = String(info.count);
        badge.title = `${info.count} connections`;
        line.appendChild(badge);
      }
    }

    const ch = info.channel;
    if (!ch) return;
    const link = document.createElement('a');
    link.href = ch.userSlug
      ? `https://www.are.na/${ch.userSlug}/${ch.slug}`
      : `https://www.are.na/channel/${ch.slug || ''}`;
    link.target = '_blank'; link.rel = 'noopener';
    link.textContent = ch.title;
    span.appendChild(link);

    // The channel resolves after the item renders, so tag the item now,
    // expose a "Filter [channel]" option, and re-evaluate filtering.
    if (item && ch.slug) {
      item.setAttribute('data-channel', ch.slug);
      addChannelFilterOption(item, ch.slug, ch.title || ch.slug);
      item.classList.toggle('filtered', isItemFiltered(
        item.getAttribute('data-domain') || '',
        item.getAttribute('data-user') || '',
        ch.slug,
      ));
    }
  }));
}

function addChannelFilterOption(item, slug, title) {
  const menu = item.querySelector('.item-actions-menu');
  if (!menu || menu.querySelector('[data-channel-btn]')) return;
  const label = document.createElement('span');
  label.className = 'actions-menu-label';
  label.textContent = 'Channel';
  menu.appendChild(label);
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.dataset.channelBtn = '1';
  btn.textContent = title;
  btn.addEventListener('click', () => { filterChannel(slug, title); menu.classList.remove('open'); });
  menu.appendChild(btn);
}

/* ---------- status helpers ---------- */
function setStatus(message, kind) {
  if (!message) { el.status.hidden = true; el.status.textContent = ''; el.status.className = 'status'; return; }
  el.status.hidden = false;
  el.status.className = `status ${kind || ''}`.trim();
  el.status.textContent = message;
}

function friendlyError(err) {
  if (err instanceof ApiError) {
    switch (err.status) {
      case 401: return 'Token rejected (401). Please re-enter your token.';
      case 402: case 403: return `Access denied (${err.status}). May require Are.na Premium.`;
      case 429: {
        const wait = err.resetAt ? Math.max(0, Math.ceil(err.resetAt - Date.now() / 1000)) : 0;
        return wait ? `Rate limited (429). Try again in ${wait}s.` : 'Rate limited (429). Wait and retry.';
      }
      default: return `Error (${err.status}).${err.detail ? ' ' + err.detail : ''}`;
    }
  }
  return 'Could not reach api.are.na.';
}

/* ---------- user info ---------- */
async function fetchMe() {
  try {
    const res = await fetch(`${API_BASE}/me`, {
      headers: { Authorization: `Bearer ${state.token}`, Accept: 'application/json' },
    });
    if (!res.ok) return;
    const u = await res.json();
    state.user = {
      name: userName(u),
      slug: userSlug(u),
      avatar: avatarUrl(u),
      createdAt: u.created_at || '',
    };
    // Update modal if it's already showing
    if (el.auth.classList.contains('open')) showAuth(true);
    // Also update if closed — so next open reflects user
    el.authUser.hidden = false;
    el.authUsername.textContent = state.user.name;
    if (state.user.avatar) {
      el.authAvatar.src = state.user.avatar;
      el.authAvatar.style.display = '';
    } else {
      el.authAvatar.style.display = 'none';
    }
    if (state.user.createdAt) {
      const year = new Date(state.user.createdAt).getFullYear();
      el.authMemberSince.textContent = 'Member since ' + year;
    }
  } catch (_) {}
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
  setStatus(reset ? 'Loading…' : 'Loading more…', 'loading');

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
      empty.textContent = 'Nothing here.';
      el.feed.appendChild(empty);
      el.loadmore.hidden = true;
    } else {
      el.loadmore.hidden = !state.hasMore;
    }

    // Enrich in background (don't block UI); counts ride along when the
    // sort is 'popular'.
    enrichChannels();
  } catch (err) {
    setStatus(friendlyError(err), 'error');
    if (err instanceof ApiError && err.status === 401) {
      state.token = '';
      clearToken();
      showAuth(true);
    }
  } finally {
    state.loading = false;
    el.loadmore.disabled = false;
  }
}

/* ---------- view mode ---------- */
// The toggle is a single button showing the icon for the current layout;
// its label describes the action (what tapping switches to).
function updateViewToggle(mode) {
  const next = mode === 'grid' ? 'list' : 'grid';
  el.viewToggle.dataset.current = mode;
  el.viewToggle.title = `Switch to ${next} view`;
  el.viewToggle.setAttribute('aria-label', `Switch to ${next} view`);
}

function setView(mode) {
  const prev = state.view;
  state.view = mode;
  localStorage.setItem(VIEW_KEY, mode);

  // Update the toggle icon/label instantly, then swap layout
  updateViewToggle(mode);

  const applyLayout = () => {
    const isGrid = mode === 'grid';
    el.feed.classList.toggle('grid', isGrid);
    el.container.classList.toggle('wide', isGrid);
  };

  if (prev !== mode && el.feed.children.length > 0) {
    el.feed.classList.add('view-switching');
    // Wait for 60ms fade-out, then swap layout and fade back in
    setTimeout(() => {
      applyLayout();
      requestAnimationFrame(() => el.feed.classList.remove('view-switching'));
    }, 60);
  } else {
    applyLayout();
  }
}

/* ---------- auth ---------- */
// Tokens never expire, so session-scoped storage is the safe default;
// localStorage is an explicit opt-in (the "Remember on this device" box,
// honored by both the OAuth and pasted-PAT paths). Clear the other store
// so a stale copy can't linger.
function saveToken(token, remember) {
  if (remember) {
    localStorage.setItem(TOKEN_KEY, token);
    sessionStorage.removeItem(TOKEN_KEY);
  } else {
    sessionStorage.setItem(TOKEN_KEY, token);
    localStorage.removeItem(TOKEN_KEY);
  }
}

function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(TOKEN_KEY);
}

function showAuth(show) {
  el.auth.classList.toggle('open', show);
  el.authOverlay.classList.toggle('open', show);
  const hasToken = !!state.token;
  // Only hide controls on first visit (no token yet)
  el.controls.hidden = !hasToken;
  // Toggle between connect and manage modes
  el.oauthConnect.hidden = hasToken || !oauthAvailable();
  el.rememberLabel.hidden = hasToken;
  el.authActions.hidden = !hasToken;
  el.settingsToggle.classList.toggle('connected', hasToken);
  el.authClose.hidden = !hasToken;

  // User info
  if (hasToken && state.user) {
    el.authUser.hidden = false;
    el.authUsername.textContent = state.user.name;
    if (state.user.avatar) {
      el.authAvatar.src = state.user.avatar;
      el.authAvatar.style.display = '';
    } else {
      el.authAvatar.style.display = 'none';
    }
    if (state.user.createdAt) {
      const year = new Date(state.user.createdAt).getFullYear();
      el.authMemberSince.textContent = 'Member since ' + year;
    }
  } else {
    el.authUser.hidden = true;
  }

  const checkIcon = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>';
  if (hasToken) {
    el.authTagline.innerHTML = checkIcon + ' Your Are.na account is connected';
    el.authMsg.hidden = true;
    el.authMsg.innerHTML = '';
  } else if (oauthAvailable()) {
    el.authTagline.textContent = 'An RSS style reader for Are.na';
    el.authMsg.hidden = true;
    el.authMsg.innerHTML = '';
  } else {
    el.authTagline.textContent = 'An RSS style reader for Are.na';
    // No client id configured, or an insecure context (plain http on a
    // non-loopback host) — WebCrypto and OAuth both need https/127.0.0.1.
    el.authMsg.hidden = false;
    el.authMsg.innerHTML = 'Not connected <span class="auth-x">✗</span><br>Sign-in needs a secure context — open this app over <code>https://</code> (or <code>http://127.0.0.1</code> for local dev).';
  }
  if (show && !hasToken && !el.oauthConnect.hidden) el.oauthSignin.focus();
}

async function start() {
  // Complete an in-flight OAuth redirect before anything else (oauth.js).
  const oauthResult = await handleOAuthCallback();
  if (oauthResult) {
    if (oauthResult.token) {
      state.token = oauthResult.token;
      saveToken(oauthResult.token, oauthResult.remember);
    } else {
      setStatus(oauthResult.error, 'error');
    }
  }

  el.scope.value = state.scope;
  el.sort.value = state.sort;
  el.type.value = state.type;
  fitSelectLabels();
  setView(state.view);

  // Load filters from file (source of truth), fall back to localStorage
  await loadFiltersFromFile();
  renderFilterUI();

  if (state.token) {
    showAuth(false);
    fetchMe();
    loadFeed({ reset: true });
  } else {
    showAuth(true);
  }
}

/* ---------- events ---------- */
el.oauthSignin.addEventListener('click', () => {
  startOAuth({ remember: el.rememberToken.checked });
});

el.settingsToggle.addEventListener('click', () => showAuth(!el.auth.classList.contains('open')));
el.authClose.addEventListener('click', () => { if (state.token) showAuth(false); });
el.authOverlay.addEventListener('click', () => { if (state.token) showAuth(false); });

document.getElementById('sign-out').addEventListener('click', () => {
  state.token = '';
  state.user = null;
  clearToken();
  el.feed.innerHTML = '';
  el.loadmore.hidden = true;
  showAuth(true);
});

el.scope.addEventListener('change', () => {
  state.scope = el.scope.value;
  loadFeed({ reset: true });
});
el.sort.addEventListener('change', () => { state.sort = el.sort.value; loadFeed({ reset: true }); });
el.type.addEventListener('change', () => { state.type = el.type.value; loadFeed({ reset: true }); });
// change events from all three selects bubble through their row wrapper
el.selectRow.addEventListener('change', fitSelectLabels);

// Clicking the title returns to the default landing filter: My Network · Created · Links
function goToDefaultFeed() {
  state.scope = DEFAULT_SCOPE;
  state.sort = DEFAULT_SORT;
  state.type = DEFAULT_TYPE;
  el.scope.value = state.scope;
  el.sort.value = state.sort;
  el.type.value = state.type;
  fitSelectLabels();
  window.scrollTo({ top: 0 });
  if (state.token) loadFeed({ reset: true });
}
el.title.addEventListener('click', goToDefaultFeed);
el.title.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goToDefaultFeed(); }
});

el.viewToggle.addEventListener('click', () => {
  setView(state.view === 'grid' ? 'list' : 'grid');
});

el.filterBtn.addEventListener('click', () => {
  el.filterDropdown.classList.toggle('open');
});

el.filterToggle.addEventListener('click', () => {
  state.filters.enabled = !state.filters.enabled;
  saveFilters();
  applyFilters();
  renderFilterUI();
});

// close dropdowns when clicking outside
document.addEventListener('click', (e) => {
  if (!el.filterBtn.contains(e.target) && !el.filterDropdown.contains(e.target)) {
    el.filterDropdown.classList.remove('open');
  }
  if (!e.target.closest('.item-actions-btn') && !e.target.closest('.item-actions-menu')) {
    document.querySelectorAll('.item-actions-menu').forEach(m => { m.classList.remove('open'); });
  }
});

el.refresh.addEventListener('click', () => loadFeed({ reset: true }));
el.loadmore.addEventListener('click', () => loadFeed({ reset: false }));

/* Scroll-hide topbar: hide on scroll down, reveal on scroll up */
(function () {
  // Open the page at the top with the nav visible. Without this, the browser
  // restores the previous scroll position on launch, which fires the scroll
  // handler with a downward delta and hides the nav before the user scrolls.
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  el.topbar.classList.remove('nav-hidden');

  let lastY = window.scrollY;
  let ticking = false;
  const THRESHOLD = 10; // ignore micro-scrolls
  const HOVER_ZONE = 24; // px from the top edge that re-reveals the bar

  window.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      const y = window.scrollY;
      const delta = y - lastY;

      if (y <= 0) {
        // Always show at top of page
        el.topbar.classList.remove('nav-hidden');
      } else if (delta > THRESHOLD) {
        // Scrolling down past threshold
        el.topbar.classList.add('nav-hidden');
        // Close any open filter dropdown when hiding nav
        el.filterDropdown.classList.remove('open');
      } else if (delta < -THRESHOLD) {
        // Scrolling up past threshold
        el.topbar.classList.remove('nav-hidden');
      }

      lastY = y;
      ticking = false;
    });
  }, { passive: true });

  // Hovering the top edge reveals the hidden bar without scrolling; it stays
  // until the next scroll down hides it again.
  window.addEventListener('mousemove', (e) => {
    if (e.clientY <= HOVER_ZONE) el.topbar.classList.remove('nav-hidden');
  }, { passive: true });
})();

start();
