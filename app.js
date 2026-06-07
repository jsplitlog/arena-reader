/*
 * Are.na Link Reader
 */

const API_BASE = 'https://api.are.na/v3';
const TOKEN_KEY = 'arena_link_reader_token';
const VIEW_KEY = 'arena_link_reader_view';
const HOTLINKS_KEY = 'arena_link_reader_hotlinks';
const FILTERS_KEY = 'arena_link_reader_filters';
const SCOPE_KEY = 'arena_link_reader_scope';
const PER_PAGE = 50;

const state = {
  token: localStorage.getItem(TOKEN_KEY) || '',
  page: 1,
  sort: 'created_at_desc',
  type: 'Link',
  scope: (['network', 'me', 'all'].includes(localStorage.getItem(SCOPE_KEY)) ? localStorage.getItem(SCOPE_KEY) : 'network'),
  view: localStorage.getItem(VIEW_KEY) || 'list',
  hotlinks: Object.assign(
    { timeWindow: 30, minConnections: 2 },
    JSON.parse(localStorage.getItem(HOTLINKS_KEY) || '{}'),
  ),
  filters: Object.assign(
    { enabled: true, domains: {}, users: {} },
    JSON.parse(localStorage.getItem(FILTERS_KEY) || '{}'),
  ),
  loading: false,
  hasMore: false,
};

// Ensure users obj exists for legacy localStorage
if (!state.filters.users) state.filters.users = {};

/* ---------- element refs ---------- */
const el = {
  controls: document.getElementById('controls'),
  scope: document.getElementById('scope'),
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
  hotlinksWindow: document.getElementById('hotlinks-window'),
  signOut: document.getElementById('sign-out'),
  authMsg: document.getElementById('auth-msg'),
  viewToggle: document.getElementById('view-toggle'),
  filterBtn: document.getElementById('filter-btn'),
  filterCount: document.getElementById('filter-count'),
  filterDropdown: document.getElementById('filter-dropdown'),
  filterList: document.getElementById('filter-list'),
  filterToggle: document.getElementById('filter-toggle'),
  container: document.querySelector('.container'),
  topbarInner: document.querySelector('.topbar-inner'),
};

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
  if (isPopular && state.hotlinks.timeWindow > 0) {
    const since = new Date(Date.now() - state.hotlinks.timeWindow * 86400000).toISOString();
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
      state.filters = Object.assign({ enabled: true, domains: {}, users: {} }, data);
      localStorage.setItem(FILTERS_KEY, JSON.stringify(state.filters));
    }
  } catch (_) {}
}

function isItemFiltered(domain, slug) {
  if (!state.filters.enabled) return false;
  if (domain && state.filters.domains[domain]) return true;
  if (slug && state.filters.users[slug]) return true;
  return false;
}

function filterDomain(domain) {
  if (!domain) return;
  state.filters.domains[domain] = true;
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

function applyFilters() {
  el.feed.querySelectorAll('.item').forEach((item) => {
    const d = item.getAttribute('data-domain') || '';
    const u = item.getAttribute('data-user') || '';
    item.classList.toggle('filtered', isItemFiltered(d, u));
  });
}

function renderFilterUI() {
  const domainKeys = Object.keys(state.filters.domains);
  const userKeys = Object.keys(state.filters.users);
  const count = domainKeys.length + userKeys.length;

  el.filterBtn.hidden = count === 0;
  el.filterCount.textContent = count;
  el.filterToggle.textContent = state.filters.enabled ? 'On' : 'Off';

  el.filterList.innerHTML = '';

  // Domains section
  if (domainKeys.length) {
    const heading = document.createElement('div');
    heading.className = 'filter-section-label';
    heading.textContent = 'Domains';
    el.filterList.appendChild(heading);
    for (const d of domainKeys.sort()) {
      el.filterList.appendChild(filterRow(d, () => unfilterDomain(d)));
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
}

function filterRow(label, onRemove) {
  const row = document.createElement('div');
  row.className = 'filter-row';

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
  const domain = domainLabel(b);
  const user = b.user || {};
  const slug = userSlug(user);
  if (domain) item.setAttribute('data-domain', domain);
  if (slug) item.setAttribute('data-user', slug);
  if (isItemFiltered(domain, slug)) item.classList.add('filtered');

  const href = sourceUrl(b) || blockUrl(b);
  const title = b.title || (sourceUrl(b) ? domain : '') || 'Untitled';
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

  // Source domain + hide button
  if (domain) {
    const src = document.createElement('div');
    src.className = 'item-source';
    const domainText = document.createElement('span');
    domainText.textContent = domain;
    src.appendChild(domainText);

    const hideBtn = document.createElement('button');
    hideBtn.type = 'button';
    hideBtn.className = 'hide-domain';
    hideBtn.textContent = 'hide';
    hideBtn.title = `Filter out ${domain}`;
    hideBtn.addEventListener('click', () => filterDomain(domain));
    src.appendChild(hideBtn);

    body.appendChild(src);
  }

  // Description
  if (desc) {
    const p = document.createElement('p');
    p.className = 'item-desc';
    p.textContent = desc;
    body.appendChild(p);
  }

  // Meta — two lines
  const meta = document.createElement('div');
  meta.className = 'item-meta';

  // Line 1: avatar + username + hide
  const line1 = document.createElement('div');
  line1.className = 'meta-line';
  if (avatar) {
    const img = document.createElement('img');
    img.className = 'avatar'; img.src = avatar; img.alt = ''; img.loading = 'lazy';
    line1.appendChild(img);
  }
  const userWrap = document.createElement('span');
  userWrap.className = 'meta-user-wrap';
  userWrap.appendChild(metaLink(name, uUrl));
  if (slug) {
    const hideUser = document.createElement('button');
    hideUser.type = 'button';
    hideUser.className = 'hide-user';
    hideUser.textContent = 'hide';
    hideUser.title = `Filter out ${name}`;
    hideUser.addEventListener('click', () => filterUser(slug, name));
    userWrap.appendChild(hideUser);
  }
  line1.appendChild(userWrap);
  meta.appendChild(line1);

  // Line 2: channel (placeholder) · time · ✶✶
  const line2 = document.createElement('div');
  line2.className = 'meta-line';
  const channelSpan = document.createElement('span');
  channelSpan.className = 'meta-channel';
  channelSpan.setAttribute('data-block-id', String(b.id));
  line2.appendChild(channelSpan);
  const time = document.createElement('time');
  time.dateTime = created || '';
  time.textContent = relativeTime(created);
  time.title = absoluteTime(created);
  line2.appendChild(time);
  line2.appendChild(dot());
  const arenaLink = metaLink('✶✶', blockUrl(b));
  arenaLink.title = 'View on Are.na';
  line2.appendChild(arenaLink);
  meta.appendChild(line2);

  body.appendChild(meta);
  item.appendChild(body);

  // Thumbnail or text preview
  const thumb = blockImage(b);
  if (thumb) {
    const link = document.createElement('a');
    link.href = href; link.target = '_blank'; link.rel = 'noopener';
    const img = document.createElement('img');
    img.className = 'item-thumb'; img.src = thumb; img.alt = ''; img.loading = 'lazy';
    link.appendChild(img);
    item.appendChild(link);
  } else {
    const preview = document.createElement('div');
    preview.className = 'item-preview';
    const previewText = desc || title || '';
    if (previewText) {
      const p = document.createElement('p');
      p.textContent = previewText;
      preview.appendChild(p);
    }
    item.appendChild(preview);
  }

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

/* ---------- hot links ---------- */
async function fetchConnectionCount(blockId) {
  try {
    const res = await fetch(`${API_BASE}/blocks/${blockId}/connections?per=1`, {
      headers: { Authorization: `Bearer ${state.token}`, Accept: 'application/json' },
    });
    if (!res.ok) return 0;
    const data = await res.json();
    const meta = data.meta || {};
    return meta.total_count ?? meta.total ?? (Array.isArray(data.data) ? data.data.length : 0);
  } catch (_) { return 0; }
}

async function fetchFirstChannel(blockId) {
  try {
    const res = await fetch(`${API_BASE}/blocks/${blockId}/connections?per=1`, {
      headers: { Authorization: `Bearer ${state.token}`, Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const ch = Array.isArray(data.data) && data.data[0];
    if (!ch) return null;
    return { title: ch.title, slug: ch.slug };
  } catch (_) { return null; }
}

async function enrichChannels() {
  const spans = el.feed.querySelectorAll('.meta-channel[data-block-id]');
  const work = [...spans].filter((s) => !s.dataset.done);
  await Promise.all(work.map(async (span) => {
    const id = span.getAttribute('data-block-id');
    span.dataset.done = '1';
    const ch = await fetchFirstChannel(id);
    if (!ch) return;
    const link = document.createElement('a');
    link.href = `https://www.are.na/${ch.slug || ''}`;
    link.target = '_blank'; link.rel = 'noopener';
    link.textContent = ch.title;
    span.appendChild(link);
    span.appendChild(dot());
  }));
}

async function enrichConnectionCounts() {
  const spans = el.feed.querySelectorAll('.meta-channel[data-block-id]');
  const work = [...spans].filter((s) => !s.dataset.countDone);
  await Promise.all(work.map(async (span) => {
    const id = span.getAttribute('data-block-id');
    span.dataset.countDone = '1';
    const count = await fetchConnectionCount(id);
    if (count < 2) return;
    const line = span.closest('.meta-line');
    if (!line) return;
    line.appendChild(dot());
    const badge = document.createElement('span');
    badge.className = 'connection-badge';
    badge.textContent = String(count);
    badge.title = `${count} connections`;
    line.appendChild(badge);
  }));
}

function saveHotlinksPrefs() {
  localStorage.setItem(HOTLINKS_KEY, JSON.stringify(state.hotlinks));
}

function updateControlsUI() {
  el.hotlinksWindow.hidden = state.sort !== 'popular';
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
      case 429: return 'Rate limited (429). Wait and retry.';
      default: return `Error (${err.status}).${err.detail ? ' ' + err.detail : ''}`;
    }
  }
  return 'Could not reach api.are.na.';
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

    // Enrich in background (don't block UI)
    enrichChannels();
    if (state.sort === 'popular') enrichConnectionCounts();
  } catch (err) {
    setStatus(friendlyError(err), 'error');
    if (err instanceof ApiError && err.status === 401) {
      state.token = '';
      localStorage.removeItem(TOKEN_KEY);
      showAuth(true);
    }
  } finally {
    state.loading = false;
    el.loadmore.disabled = false;
  }
}

/* ---------- view mode ---------- */
function setView(mode) {
  state.view = mode;
  localStorage.setItem(VIEW_KEY, mode);
  const isGrid = mode === 'grid';
  el.feed.classList.toggle('grid', isGrid);
  el.container.classList.toggle('wide', isGrid);
  el.topbarInner.classList.toggle('wide', isGrid);
  el.viewToggle.querySelectorAll('button').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.view === mode);
  });
}

/* ---------- auth ---------- */
function showAuth(show) {
  el.auth.hidden = !show;
  const hasToken = !!state.token;
  // Only hide controls on first visit (no token yet)
  el.controls.hidden = !hasToken;
  // Toggle between connect and manage modes
  el.tokenForm.hidden = hasToken;
  el.signOut.hidden = !hasToken;
  el.settingsToggle.classList.toggle('connected', hasToken);
  if (hasToken) {
    el.authMsg.innerHTML = 'Connected to Are.na. Token stored in your browser.';
  } else {
    el.authMsg.innerHTML = 'Connect your Are.na account with a <a href="https://www.are.na/settings/personal-access-tokens" target="_blank" rel="noopener">personal access token</a>. <span class="auth-note">Stored in your browser only, sent only to <code>api.are.na</code>.</span>';
  }
  if (show && !hasToken) { el.tokenInput.value = ''; el.tokenInput.focus(); }
}

async function start() {
  el.scope.value = state.scope;
  el.sort.value = state.sort;
  el.type.value = state.type;
  setView(state.view);
  el.hotlinksWindow.value = String(state.hotlinks.timeWindow);
  updateControlsUI();

  // Load filters from file (source of truth), fall back to localStorage
  await loadFiltersFromFile();
  renderFilterUI();

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

el.settingsToggle.addEventListener('click', () => showAuth(el.auth.hidden));

el.signOut.addEventListener('click', () => {
  state.token = '';
  localStorage.removeItem(TOKEN_KEY);
  el.feed.innerHTML = '';
  el.loadmore.hidden = true;
  showAuth(true);
});

el.scope.addEventListener('change', () => {
  state.scope = el.scope.value;
  localStorage.setItem(SCOPE_KEY, state.scope);
  loadFeed({ reset: true });
});
el.sort.addEventListener('change', () => { state.sort = el.sort.value; updateControlsUI(); loadFeed({ reset: true }); });
el.type.addEventListener('change', () => { state.type = el.type.value; loadFeed({ reset: true }); });

el.hotlinksWindow.addEventListener('change', () => {
  state.hotlinks.timeWindow = Number(el.hotlinksWindow.value);
  saveHotlinksPrefs(); loadFeed({ reset: true });
});

el.viewToggle.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-view]');
  if (btn) setView(btn.dataset.view);
});

el.filterBtn.addEventListener('click', () => {
  el.filterDropdown.hidden = !el.filterDropdown.hidden;
});

el.filterToggle.addEventListener('click', () => {
  state.filters.enabled = !state.filters.enabled;
  saveFilters();
  applyFilters();
  renderFilterUI();
});

// close filter dropdown when clicking outside
document.addEventListener('click', (e) => {
  if (!el.filterBtn.contains(e.target) && !el.filterDropdown.contains(e.target)) {
    el.filterDropdown.hidden = true;
  }
});

el.refresh.addEventListener('click', () => loadFeed({ reset: true }));
el.loadmore.addEventListener('click', () => loadFeed({ reset: false }));

start();
