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

// Option lists for the custom scope/sort/type dropdowns that replace the native
// <select>s. Value + label, in display order — mirrors the old <option> markup.
// `label` names the control for the trigger's aria-label.
const FILTER_DROPDOWNS = {
  scope: {
    label: 'Source',
    options: [
      { v: 'network', t: 'My Network' },
      { v: 'me', t: 'My Are.na' },
      { v: 'all', t: 'All Are.na' },
    ],
  },
  sort: {
    label: 'Sort',
    options: [
      { v: 'created_at_desc', t: 'Created' },
      { v: 'updated_at_desc', t: 'Updated' },
      { v: 'random', t: 'Random' },
    ],
  },
  type: {
    label: 'Type',
    options: [
      { v: 'Link', t: 'Links' },
      { v: 'Image', t: 'Images' },
      { v: 'Embed', t: 'Embeds' },
      { v: 'Attachment', t: 'Attachments' },
      { v: 'Text', t: 'Text' },
      { v: 'Block', t: 'All' },
    ],
  },
};

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
  // scope/sort/type are assigned below to dropdown controllers, not DOM nodes.
  refresh: document.getElementById('refresh'),
  settingsToggle: document.getElementById('settings-toggle'),
  auth: document.getElementById('auth'),
  authClose: document.getElementById('auth-close'),
  oauthConnect: document.getElementById('oauth-connect'),
  oauthSignin: document.getElementById('oauth-signin'),
  rememberToken: document.getElementById('remember-token'),
  rememberLabel: document.getElementById('remember-label'),
  status: document.getElementById('status'),
  skeleton: document.getElementById('skeleton'),
  feed: document.getElementById('feed'),
  loadmore: document.getElementById('loadmore'),
  loadmoreSpinner: document.getElementById('loadmore-spinner'),
  sentinel: document.getElementById('feed-sentinel'),
  authMsg: document.getElementById('auth-msg'),
  authTagline: document.getElementById('auth-tagline'),
  authOverlay: document.getElementById('auth-overlay'),
  authUser: document.getElementById('auth-user'),
  authAvatar: document.getElementById('auth-avatar'),
  authAvatarFallback: document.getElementById('auth-avatar-fallback'),
  authUsername: document.getElementById('auth-username'),
  authActions: document.getElementById('auth-actions'),
  manageApps: document.getElementById('manage-apps'),
  viewToggle: document.getElementById('view-toggle'),
  filterBtn: document.getElementById('filter-btn'),
  filterCount: document.getElementById('filter-count'),
  filterDropdown: document.getElementById('filter-dropdown'),
  filterList: document.getElementById('filter-list'),
  filterToggle: document.getElementById('filter-toggle'),
  filterReset: document.getElementById('filter-reset'),
  shortcuts: document.getElementById('shortcuts'),
  shortcutsOverlay: document.getElementById('shortcuts-overlay'),
  shortcutsList: document.getElementById('shortcuts-list'),
  shortcutsClose: document.getElementById('shortcuts-close'),
  toastRegion: document.getElementById('toast-region'),
  container: document.querySelector('.container'),
  topbar: document.querySelector('.topbar'),
  topbarInner: document.querySelector('.topbar-inner'),
  selectRow: document.querySelector('.select-row'),
};

// scope/sort/type are assigned dropdown controllers once buildFilterDropdown and
// its dependencies (icon consts, anchorFallback/SUPPORTS_ANCHOR) are defined —
// see the build call further below.

// Single source of truth for motion gating; CSS handles the rest globally.
const reduceMotionMQ = window.matchMedia('(prefers-reduced-motion: reduce)');
function prefersReducedMotion() { return reduceMotionMQ.matches; }

/* The three filter selects sit inline in the top bar on desktop, but on mobile
   they relocate to a fixed bottom bar (declutters the header). The bar can't
   stay inside .topbar there: .topbar.nav-hidden applies a transform, which
   would become the containing block for the fixed bar and yank it up to the
   top edge. So we physically reparent .select-row to <body> on mobile and back
   into .controls on desktop. */
const mobileNavMQ = window.matchMedia('(max-width: 640px)');
const selectRowHome = el.selectRow.parentNode;            // .controls
const selectRowAnchor = el.selectRow.nextElementSibling;  // trailing spacer
function syncSelectRowPlacement() {
  if (mobileNavMQ.matches) {
    if (el.selectRow.parentNode !== document.body) document.body.appendChild(el.selectRow);
    // .controls[hidden] no longer cascades once detached, so mirror it here.
    el.selectRow.hidden = el.controls.hidden;
  } else {
    if (el.selectRow.parentNode !== selectRowHome) {
      selectRowHome.insertBefore(el.selectRow, selectRowAnchor);
    }
    // Desktop visibility is governed by .controls[hidden] cascading down.
    el.selectRow.hidden = false;
  }
}
syncSelectRowPlacement();
mobileNavMQ.addEventListener('change', syncSelectRowPlacement);

// Hide/reveal the top bar and the mobile bottom filter bar together: the top
// bar slides up, the bottom bar slides down (both via .nav-hidden).
function setNavHidden(hidden) {
  el.topbar.classList.toggle('nav-hidden', hidden);
  el.selectRow.classList.toggle('nav-hidden', hidden);
}

/* ---------- toast ---------- */
// Brief, non-blocking confirmation (issue #35). Reusable for any future toast.
function showToast(message, type = 'mute', onUndo = null) {
  if (!message) return;
  const toast = document.createElement('div');
  toast.className = 'toast';

  // Left icon (Lucide Eye/Eye-off)
  const iconSpan = document.createElement('span');
  iconSpan.className = 'toast-icon';
  if (type === 'mute') {
    iconSpan.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.52 13.52 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" y1="2" x2="22" y2="22"/></svg>`;
  } else {
    iconSpan.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0z"/><circle cx="12" cy="12" r="3"/></svg>`;
  }
  toast.appendChild(iconSpan);

  // Text label
  const textSpan = document.createElement('span');
  textSpan.className = 'toast-label';
  textSpan.textContent = message;
  toast.appendChild(textSpan);

  // Undo button (on the right if onUndo is provided)
  if (type === 'mute' && onUndo) {
    const undoBtn = document.createElement('button');
    undoBtn.type = 'button';
    undoBtn.className = 'toast-undo';
    undoBtn.setAttribute('aria-label', 'Undo');
    undoBtn.title = 'Undo';
    undoBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5v0a5.5 5.5 0 0 1-5.5 5.5H11"/></svg>`;
    undoBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      onUndo();
      toast.classList.remove('show');
      toast.remove();
    });
    toast.appendChild(undoBtn);
  }

  el.toastRegion.appendChild(toast);
  // Enter on the next frame so the transition runs from the base state. Under
  // reduced motion the global rule makes these transitions instant.
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    let removed = false;
    const drop = () => { if (removed) return; removed = true; toast.remove(); };
    toast.addEventListener('transitionend', drop, { once: true });
    setTimeout(drop, 400); // fallback if no transition fires
  }, 2400);
}

// On mobile the three selects are equal-width thirds whose label size
// scales to fit (see .select-row in styles.css). The CSS divisor encodes
// the widest label that must fit; recompute it from the currently
// *selected* options so e.g. showing "Links" doesn't reserve room for
// "Attachments". The 1.02 factor absorbs font rendering differences
// between the canvas measurement and the real select.
const labelMeasureCtx = document.createElement('canvas').getContext('2d');
function fitSelectLabels() {
  const { fontWeight, fontFamily } = getComputedStyle(el.scope.btn);
  labelMeasureCtx.font = `${fontWeight} 100px ${fontFamily}`;
  const widest = Math.max(...[el.scope, el.sort, el.type].map(
    (c) => labelMeasureCtx.measureText(c.currentLabel()).width / 100
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
  filtersBackup = null;
  state.filters.domains[domain] = displayName || domain;
  saveFilters();
  applyFilters({ animate: true });
  renderFilterUI();
  showToast(displayName || domain, 'mute', () => unfilterDomain(domain));
}

function unfilterDomain(domain) {
  filtersBackup = null;
  const label = state.filters.domains[domain];
  delete state.filters.domains[domain];
  saveFilters();
  applyFilters();
  renderFilterUI();
  showToast((typeof label === 'string' && label) || domain, 'unmute');
}

function filterUser(slug, name) {
  if (!slug) return;
  filtersBackup = null;
  state.filters.users[slug] = name || slug;
  saveFilters();
  applyFilters({ animate: true });
  renderFilterUI();
  showToast(name || slug, 'mute', () => unfilterUser(slug));
}

function unfilterUser(slug) {
  filtersBackup = null;
  const label = state.filters.users[slug];
  delete state.filters.users[slug];
  saveFilters();
  applyFilters();
  renderFilterUI();
  showToast(label || slug, 'unmute');
}

function filterChannel(slug, title) {
  if (!slug) return;
  filtersBackup = null;
  state.filters.channels[slug] = title || slug;
  saveFilters();
  applyFilters({ animate: true });
  renderFilterUI();
  showToast(title || slug, 'mute', () => unfilterChannel(slug));
}

function unfilterChannel(slug) {
  filtersBackup = null;
  const label = state.filters.channels[slug];
  delete state.filters.channels[slug];
  saveFilters();
  applyFilters();
  renderFilterUI();
  showToast(label || slug, 'unmute');
}

function applyFilters(opts) {
  const animate = !!(opts && opts.animate) && !prefersReducedMotion();
  let outIndex = 0;
  el.feed.querySelectorAll('.item').forEach((item) => {
    const d = item.getAttribute('data-domain') || '';
    const u = item.getAttribute('data-user') || '';
    const c = item.getAttribute('data-channel') || '';
    const filtered = isItemFiltered(d, u, c);
    if (filtered) {
      if (item.classList.contains('removing')) return;            // already exiting
      if (!item.classList.contains('filtered') && animate) animateItemOut(item, outIndex++);
      else item.classList.add('filtered');
    } else {
      // Unfiltered (or filters toggled off): cancel any in-flight exit and show.
      item.classList.remove('filtered', 'removing');
      item.style.transitionDelay = '';
    }
  });
}

// Animate a newly-filtered item out (subtle fade + upward drift), then drop it
// from layout via .filtered. Tight, capped stagger so a prolific domain still
// settles quickly. Re-checks filter state on completion in case it was undone.
function animateItemOut(item, index) {
  const delay = Math.min(index, 6) * 25;
  item.style.transitionDelay = `${delay}ms`;
  item.classList.add('removing');
  let done = false;
  const finalize = () => {
    if (done) return;
    done = true;
    item.removeEventListener('transitionend', onEnd);
    item.classList.remove('removing');
    item.style.transitionDelay = '';
    const d = item.getAttribute('data-domain') || '';
    const u = item.getAttribute('data-user') || '';
    const c = item.getAttribute('data-channel') || '';
    item.classList.toggle('filtered', isItemFiltered(d, u, c));
  };
  function onEnd(e) {
    if (e.target === item && e.propertyName === 'opacity') finalize();
  }
  item.addEventListener('transitionend', onEnd);
  setTimeout(finalize, 200 + delay + 120);                       // fallback
}

// Animate the nav filter badge as the active-filter count changes: a one-shot
// pop on increment/decrement, a fade-out when it returns to 0. The first call
// (page load) sets the value without animating (skip-animation-on-load).
let filtersBackup = null;
let badgePrevCount = 0;
let badgeInitialized = false;
function updateFilterBadge(count) {
  const badge = el.filterCount;
  const prev = badgePrevCount;
  badgePrevCount = count;
  const reduce = prefersReducedMotion();
  if (count > 0) badge.textContent = String(count);

  if (count === 0) {
    if (badgeInitialized && prev > 0 && !reduce) {
      badge.classList.add('hiding');
      let hidden = false;
      const hide = () => { if (hidden) return; hidden = true; badge.hidden = true; badge.classList.remove('hiding'); };
      badge.addEventListener('transitionend', function h(e) {
        if (e.propertyName !== 'opacity') return;
        badge.removeEventListener('transitionend', h);
        hide();
      });
      setTimeout(hide, 240); // fallback
    } else {
      badge.hidden = true;
    }
  } else {
    badge.classList.remove('hiding');
    badge.hidden = false;
    if (badgeInitialized && prev !== count && !reduce) {
      badge.classList.remove('pop');
      void badge.offsetWidth; // restart the keyframe
      badge.classList.add('pop');
      badge.addEventListener('animationend', () => badge.classList.remove('pop'), { once: true });
    }
  }
  badgeInitialized = true;
}

function renderFilterUI() {
  const domainKeys = Object.keys(state.filters.domains);
  const userKeys = Object.keys(state.filters.users);
  const channelKeys = Object.keys(state.filters.channels);
  const count = domainKeys.length + userKeys.length + channelKeys.length;

  updateFilterBadge(count);
  el.filterCount.classList.toggle('disabled', !state.filters.enabled);
  el.filterToggle.textContent = state.filters.enabled ? 'On' : 'Off';
  if (count > 0) {
    el.filterReset.textContent = 'Reset';
    el.filterReset.hidden = false;
  } else if (filtersBackup) {
    el.filterReset.textContent = 'Undo';
    el.filterReset.hidden = false;
  } else {
    el.filterReset.hidden = true;
  }

  el.filterList.innerHTML = '';

  // Empty state
  if (count === 0) {
    const empty = document.createElement('div');
    empty.className = 'filter-empty';
    empty.textContent = 'No filters created.\n\nFilters mute domains, users, and channels.';
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
  btn.innerHTML = X_ICON;
  btn.setAttribute('aria-label', `Remove filter ${label}`);
  btn.title = 'Remove filter';
  btn.addEventListener('click', onRemove);
  row.appendChild(btn);

  return row;
}

const PLUS_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>';
const X_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
// lucide chevron-down / chevron-up (closed / open) and check (selected option).
const CHEVRON_DOWN = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
const CHEVRON_UP = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>';
const MENU_CHECK = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';

// Apply a filter-dropdown selection: update state + the trigger's label/check,
// refit the mobile labels, and reload. Replaces the old <select> 'change' wiring.
function onSelect(key, value) {
  state[key] = value;
  el[key].setValue(value);
  fitSelectLabels();
  loadFeed({ reset: true });
}

// Build one custom popover dropdown to replace a native <select> (scope/sort/
// type). Mirrors the per-item actions menu: a trigger button toggles a [popover]
// menu via the Popover API, positioned with CSS anchor positioning (down on
// desktop, up over the mobile bottom bar; anchorFallback covers browsers without
// anchor support). Returns a controller used in place of the old <select>.
function buildFilterDropdown(key) {
  const { label, options } = FILTER_DROPDOWNS[key];
  const menuId = `filter-dd-${key}`;
  const anchorName = `--dd-${key}`;

  const wrap = document.createElement('div');
  wrap.className = 'filter-select';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'filter-select-btn';
  btn.setAttribute('popovertarget', menuId);
  btn.setAttribute('aria-haspopup', 'listbox');
  btn.setAttribute('aria-expanded', 'false');
  btn.setAttribute('aria-label', `${label} filter`);
  btn.style.setProperty('anchor-name', anchorName);
  const labelSpan = document.createElement('span');
  labelSpan.className = 'filter-select-label';
  const chevron = document.createElement('span');
  chevron.className = 'filter-select-chevron';
  chevron.innerHTML = `<span class="chev-down">${CHEVRON_DOWN}</span><span class="chev-up">${CHEVRON_UP}</span>`;
  btn.append(labelSpan, chevron);

  const menu = document.createElement('div');
  // Reuse .item-actions-menu for the box + open/close animation; .filter-select-
  // menu only adds anchor direction and listbox tweaks.
  menu.className = 'item-actions-menu filter-select-menu';
  menu.id = menuId;
  menu.popover = 'auto';
  menu.setAttribute('role', 'listbox');
  menu.style.setProperty('position-anchor', anchorName);

  const optBtns = options.map(({ v, t }) => {
    const opt = document.createElement('button');
    opt.type = 'button';
    opt.className = 'actions-menu-row filter-select-option';
    opt.dataset.value = v;
    opt.setAttribute('role', 'option');
    const span = document.createElement('span');
    span.textContent = t;
    const check = document.createElement('span');
    check.className = 'opt-check';
    check.innerHTML = MENU_CHECK;
    opt.append(span, check);
    opt.addEventListener('click', () => {
      onSelect(key, v);
      menu.hidePopover();
    });
    menu.appendChild(opt);
    return opt;
  });
  wrap.append(btn);
  // Render the menu on <body>, not inside the (fixed, sometimes transformed)
  // bottom bar. A popover is position:fixed; any ancestor with a transform,
  // filter, containment, or container-type becomes its containing block, so on
  // close — as it leaves the top layer — it would snap under the field for a
  // frame. Anchored to the trigger by name, it positions identically from body.
  document.body.append(menu);

  // Reflect open state into aria-expanded; the chevron flip reads it (the menu
  // is no longer a child of .filter-select, so CSS can't watch it via :has).
  menu.addEventListener('toggle', (e) => {
    btn.setAttribute('aria-expanded', e.newState === 'open' ? 'true' : 'false');
  });
  // Desktop opens downward, the fixed mobile bottom bar upward — decide per open.
  anchorFallback(btn, menu, () => (mobileNavMQ.matches ? 'up' : 'down'));

  function setValue(v) {
    const opt = options.find((o) => o.v === v);
    labelSpan.textContent = opt ? opt.t : v;
    optBtns.forEach((o) => o.setAttribute('aria-selected', String(o.dataset.value === v)));
  }

  return { wrap, btn, setValue, currentLabel: () => labelSpan.textContent };
}

// A label + value row in the per-item actions menu. The trailing icon
// button adds the filter (+).
function actionsMenuRow(menu, sectionLabel, value, isFiltered, onAdd, onRemove) {
  const label = document.createElement('span');
  label.className = 'actions-menu-label';
  label.textContent = sectionLabel;
  menu.appendChild(label);
  const row = document.createElement('div');
  row.className = 'actions-menu-row';
  const span = document.createElement('span');
  span.textContent = value;
  row.appendChild(span);
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.innerHTML = PLUS_ICON;
  btn.setAttribute('aria-label', `Mute ${value}`);
  btn.title = 'Mute';
  btn.addEventListener('click', () => {
    onAdd();
    menu.hidePopover();
  });
  row.appendChild(btn);
  menu.appendChild(row);
  return row;
}

/* ---------- rendering ---------- */
// Popovers are positioned with CSS anchor positioning. Browsers without it
// drop popovers into the viewport center (top-layer UA default), so compute
// the position from the trigger on open instead.
const SUPPORTS_ANCHOR = CSS.supports('anchor-name: --a');
// `dir` is 'up'/'down', or a function returning one (evaluated at open time so
// the filter dropdowns can flip direction at the mobile breakpoint).
function anchorFallback(btn, pop, dir) {
  if (SUPPORTS_ANCHOR) return;
  pop.addEventListener('toggle', (e) => {
    if (e.newState !== 'open') return;
    const d = typeof dir === 'function' ? dir() : dir;
    const r = btn.getBoundingClientRect();
    pop.style.position = 'fixed';
    pop.style.left = 'auto';
    pop.style.right = `${Math.max(4, window.innerWidth - r.right)}px`;
    if (d === 'up') {
      pop.style.top = 'auto';
      pop.style.bottom = `${window.innerHeight - r.top + 4}px`;
    } else {
      pop.style.bottom = 'auto';
      pop.style.top = `${r.bottom + 4}px`;
    }
  });
}

// Build the custom scope/sort/type dropdowns and drop them into .select-row,
// exactly where the native <select>s used to sit. Must run after the icon
// consts and anchorFallback/SUPPORTS_ANCHOR above are initialized (they're
// const, so referencing them earlier hits the temporal dead zone). el.scope/
// sort/type now hold controllers ({ wrap, btn, setValue, currentLabel }).
el.scope = buildFilterDropdown('scope');
el.sort = buildFilterDropdown('sort');
el.type = buildFilterDropdown('type');
el.selectRow.append(el.scope.wrap, el.sort.wrap, el.type.wrap);

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

  // Attribution row: a leading stack (sharer over channel) and a trailing
  // group (timestamp · ✶✶ source · actions menu), vertically centered.
  const attribution = document.createElement('div');
  attribution.className = 'item-attribution';

  const lead = document.createElement('div');
  lead.className = 'item-attr-lead';

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
  lead.appendChild(authorLine);

  // Channel/collection line — populated asynchronously by enrichChannels()
  const channelSpan = document.createElement('span');
  channelSpan.className = 'meta-channel';
  channelSpan.setAttribute('data-block-id', String(b.id));
  lead.appendChild(channelSpan);

  attribution.appendChild(lead);

  // Trailing group: timestamp + source/filter icon buttons
  const metaActions = document.createElement('div');
  metaActions.className = 'meta-actions';
  const time = document.createElement('time');
  time.dateTime = created || '';
  time.textContent = relativeTime(created);
  time.title = absoluteTime(created);
  metaActions.appendChild(time);

  // Are.na source, now an icon button (matches the actions button styling)
  const arenaBtn = document.createElement('a');
  arenaBtn.className = 'item-icon-btn';
  arenaBtn.href = blockUrl(b);
  arenaBtn.target = '_blank';
  arenaBtn.rel = 'noopener';
  arenaBtn.textContent = '✶✶';
  arenaBtn.title = 'View on Are.na';
  arenaBtn.setAttribute('aria-label', 'View on Are.na');
  metaActions.appendChild(arenaBtn);

  if (domain || slug) {
    const actions = document.createElement('div');
    actions.className = 'item-actions';
    const actBtn = document.createElement('button');
    actBtn.type = 'button';
    actBtn.className = 'item-actions-btn';
    actBtn.setAttribute('aria-label', 'Actions');
    actBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/></svg>';
    actions.appendChild(actBtn);

    const actMenu = document.createElement('div');
    actMenu.className = 'item-actions-menu';
    actMenu.id = `item-actions-menu-${b.id}`;
    actMenu.popover = 'auto';
    actMenu.style.setProperty('position-anchor', `--act-${b.id}`);
    actBtn.style.setProperty('anchor-name', `--act-${b.id}`);
    actBtn.setAttribute('popovertarget', actMenu.id);
    anchorFallback(actBtn, actMenu, 'up');
    if (domain) {
      actionsMenuRow(actMenu, 'Domain', domainDisplay,
        () => state.filters.domains[domain] !== undefined,
        () => filterDomain(domain, domainDisplay),
        () => unfilterDomain(domain));
    }
    if (slug) {
      actionsMenuRow(actMenu, 'User', name,
        () => state.filters.users[slug] !== undefined,
        () => filterUser(slug, name),
        () => unfilterUser(slug));
    }
    actions.appendChild(actMenu);
    metaActions.appendChild(actions);
  }

  attribution.appendChild(metaActions);
  item.appendChild(attribution);

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

    const ch = info.channel;
    if (ch) {
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
    }

    // Connection count rides along on the channel line when sort is 'popular'.
    if (showCounts && info.count >= 2) {
      span.appendChild(dot());
      const badge = document.createElement('span');
      badge.className = 'connection-badge';
      badge.textContent = String(info.count);
      badge.title = `${info.count} connections`;
      span.appendChild(badge);
    }
  }));
}

function addChannelFilterOption(item, slug, title) {
  const menu = item.querySelector('.item-actions-menu');
  if (!menu || menu.querySelector('[data-channel-btn]')) return;
  const row = actionsMenuRow(menu, 'Channel', title,
    () => state.filters.channels[slug] !== undefined,
    () => filterChannel(slug, title),
    () => unfilterChannel(slug));
  row.querySelector('button').dataset.channelBtn = '1';
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
    };
    // Update modal if it's already showing
    if (el.auth.classList.contains('open')) showAuth(true);
    // Also update if closed — so next open reflects user
    el.authUser.hidden = false;
    renderAuthUser();
  } catch (_) {}
}

// Account preview uses the same avatar component as feed attribution:
// the user's image when available, otherwise their initial as fallback.
function renderAuthUser() {
  el.authUsername.textContent = state.user.name;
  const avatar = state.user.avatar;
  el.authAvatar.hidden = !avatar;
  el.authAvatarFallback.hidden = !!avatar;
  if (avatar) el.authAvatar.src = avatar;
  else el.authAvatarFallback.textContent = (state.user.name || '?').charAt(0).toUpperCase();
}

/* ---------- skeleton ---------- */
// A single placeholder primitive (see .skeleton in styles.css). Flat gray is
// "preview/placeholder" (behind the locked sign-in modal); shimmer is "content
// is loading" (first load, media-type/filter transitions). The same markup
// mirrors the feed's list and grid layouts so swapping to real items is clean.
const SKELETON_COUNT = 8;

function buildSkeletonItem() {
  const item = document.createElement('div');
  item.className = 'sk-item';
  item.innerHTML =
    '<div class="sk-body">' +
      '<div class="sk-line sk-line-title"></div>' +
      '<div class="sk-line sk-line-source"></div>' +
      '<div class="sk-line"></div>' +
      '<div class="sk-line"></div>' +
      '<div class="sk-line sk-line-desc-end"></div>' +
    '</div>' +
    '<div class="sk-thumb"></div>' +
    '<div class="sk-foot">' +
      '<div class="sk-dot"></div>' +
      '<div class="sk-line sk-line-meta"></div>' +
    '</div>';
  return item;
}

function showSkeleton({ shimmer }) {
  if (!el.skeleton.children.length) {
    const frag = document.createDocumentFragment();
    for (let i = 0; i < SKELETON_COUNT; i += 1) frag.appendChild(buildSkeletonItem());
    el.skeleton.appendChild(frag);
  }
  el.skeleton.classList.toggle('grid', state.view === 'grid');
  el.skeleton.classList.toggle('skeleton--loading', !!shimmer);
  el.skeleton.hidden = false;
}

function hideSkeleton() {
  el.skeleton.hidden = true;
  el.skeleton.classList.remove('skeleton--loading');
}

/* ---------- infinite scroll ---------- */
// Auto-load the next page as the bottom of the feed nears the viewport. The
// "Load more" button stays as an explicit fallback (and degrades gracefully
// where IntersectionObserver is unavailable).
const SENTINEL_MARGIN = 400; // px ahead of the sentinel to begin fetching

function sentinelNearViewport() {
  const r = el.sentinel.getBoundingClientRect();
  return r.top <= window.innerHeight + SENTINEL_MARGIN;
}

function maybeLoadMore() {
  if (!state.token || !state.hasMore || state.loading) return;
  if (!sentinelNearViewport()) return;
  loadFeed({ reset: false });
}

const feedObserver = ('IntersectionObserver' in window)
  ? new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) maybeLoadMore();
    }, { rootMargin: `${SENTINEL_MARGIN}px 0px` })
  : null;
if (feedObserver) feedObserver.observe(el.sentinel);

// While a "load more" is in flight the spinner stands in for the button.
function setLoadingMore(on) {
  el.loadmoreSpinner.hidden = !on;
  el.loadmore.hidden = on || !state.hasMore;
}

/* ---------- feed loading ---------- */
async function loadFeed({ reset }) {
  if (state.loading) return;
  state.loading = true;
  el.feed.setAttribute('aria-busy', 'true');

  if (reset) {
    state.page = 1;
    el.feed.innerHTML = '';
    el.loadmore.hidden = true;
    showSkeleton({ shimmer: true });
  } else {
    setLoadingMore(true);
  }

  el.loadmore.disabled = true;
  setStatus('');

  try {
    const data = await fetchPage(state.page);
    const blocks = Array.isArray(data.data) ? data.data : [];
    const meta = data.meta || {};

    if (reset) hideSkeleton();

    const frag = document.createDocumentFragment();
    for (const b of blocks) frag.appendChild(renderItem(b));
    el.feed.appendChild(frag);

    state.hasMore = meta.has_more_pages ?? (blocks.length === PER_PAGE);
    if (state.hasMore) state.page += 1;

    if (el.feed.children.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'Nothing here.';
      el.feed.appendChild(empty);
      el.loadmore.hidden = true;
      state.hasMore = false;
    } else {
      el.loadmore.hidden = !state.hasMore;
    }

    // Enrich in background (don't block UI); counts ride along when the
    // sort is 'popular'.
    enrichChannels();

    // Keep filling while the sentinel is still in view (e.g. a short first
    // page, or many items hidden by filters).
    if (state.hasMore) requestAnimationFrame(maybeLoadMore);
  } catch (err) {
    if (reset) hideSkeleton();
    setStatus(friendlyError(err), 'error');
    if (err instanceof ApiError && err.status === 401) {
      state.token = '';
      clearToken();
      showAuth(true);
      showSkeleton({ shimmer: false });
    }
  } finally {
    state.loading = false;
    el.loadmore.disabled = false;
    el.feed.removeAttribute('aria-busy');
    setLoadingMore(false);
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
    el.skeleton.classList.toggle('grid', isGrid);
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
  // Lock background scroll while the modal is open (see :root.modal-open).
  // Measure the live scrollbar width *before* locking so padding can backfill
  // the space it gives up (0 with overlay scrollbars) and the layout holds.
  const root = document.documentElement;
  if (show) {
    const comp = window.innerWidth - root.clientWidth;
    root.style.setProperty('--scrollbar-comp', `${comp}px`);
    root.classList.add('modal-open');
  } else {
    if (prefersReducedMotion()) {
      root.classList.remove('modal-open');
    } else {
      setTimeout(() => {
        if (!el.auth.classList.contains('open')) {
          root.classList.remove('modal-open');
        }
      }, 150); // 150ms matches the exit transition duration
    }
  }
  const hasToken = !!state.token;
  // Only hide controls on first visit (no token yet)
  el.controls.hidden = !hasToken;
  // Keep the relocated mobile filter bar in sync with the controls' state.
  syncSelectRowPlacement();
  // Toggle between connect and manage modes
  el.oauthConnect.hidden = hasToken || !oauthAvailable();
  el.rememberLabel.hidden = hasToken;
  el.manageApps.hidden = !hasToken;
  el.authActions.hidden = !hasToken;
  el.authClose.hidden = !hasToken;
  el.settingsToggle.classList.toggle('connected', hasToken);

  // User info
  if (hasToken && state.user) {
    el.authUser.hidden = false;
    renderAuthUser();
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
  // Paint a skeleton before any awaits so there's no blank flash while the
  // OAuth token exchange or first feed fetch is in flight: shimmer when a feed
  // load is expected (stored token, or returning from the OAuth redirect),
  // flat when the sign-in modal is about to lock the view.
  const params = new URLSearchParams(location.search);
  const expectFeed = state.token || params.has('code') || params.has('error');
  showSkeleton({ shimmer: !!expectFeed });

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

  el.scope.setValue(state.scope);
  el.sort.setValue(state.sort);
  el.type.setValue(state.type);
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
    // Flat gray skeleton sits behind the locked modal (no shimmer).
    showSkeleton({ shimmer: false });
  }
}

/* ---------- events ---------- */
el.oauthSignin.addEventListener('click', () => {
  startOAuth({ remember: el.rememberToken.checked });
});

el.settingsToggle.addEventListener('click', () => showAuth(!el.auth.classList.contains('open')));
el.authOverlay.addEventListener('click', () => { if (state.token) showAuth(false); });
el.authClose.addEventListener('click', () => { if (state.token) showAuth(false); });

document.getElementById('sign-out').addEventListener('click', () => {
  state.token = '';
  state.user = null;
  state.hasMore = false;
  clearToken();
  el.feed.innerHTML = '';
  el.loadmore.hidden = true;
  el.loadmoreSpinner.hidden = true;
  showAuth(true);
  // Return to the flat preview skeleton behind the modal.
  showSkeleton({ shimmer: false });
});

// scope/sort/type selection is handled by onSelect (wired per option in
// buildFilterDropdown): it updates state, the trigger label, the label fit,
// and reloads.

// Clicking the title returns to the default landing filter: My Network · Created · Links
function goToDefaultFeed() {
  state.scope = DEFAULT_SCOPE;
  state.sort = DEFAULT_SORT;
  state.type = DEFAULT_TYPE;
  el.scope.setValue(state.scope);
  el.sort.setValue(state.sort);
  el.type.setValue(state.type);
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

// Open/close, outside-click, and Escape dismissal are native popover
// behavior; only positioning needs the no-anchor-support fallback.
anchorFallback(el.filterBtn, el.filterDropdown, 'down');

el.filterToggle.addEventListener('click', () => {
  state.filters.enabled = !state.filters.enabled;
  saveFilters();
  applyFilters();
  renderFilterUI();
});

// Restore the snapshot stashed by the last reset. Shared by the header Undo
// button and the toast Undo so they can't double-fire (the first to run clears
// filtersBackup; the second no-ops).
function restoreFilters() {
  if (!filtersBackup) return;
  state.filters.domains = filtersBackup.domains;
  state.filters.users = filtersBackup.users;
  state.filters.channels = filtersBackup.channels;
  filtersBackup = null;
  saveFilters();
  applyFilters();
  renderFilterUI();
  showToast('Filters restored', 'unmute');
}

el.filterReset.addEventListener('click', () => {
  // After a reset the button doubles as Undo (renderFilterUI swaps the label
  // while a backup exists): restore instead of clearing again.
  if (filtersBackup) {
    restoreFilters();
    return;
  }

  filtersBackup = {
    domains: { ...state.filters.domains },
    users: { ...state.filters.users },
    channels: { ...state.filters.channels },
  };

  state.filters.domains = {};
  state.filters.users = {};
  state.filters.channels = {};

  saveFilters();
  applyFilters();
  renderFilterUI();

  showToast('All filters reset', 'mute', restoreFilters);
});

el.refresh.addEventListener('click', () => loadFeed({ reset: true }));
el.loadmore.addEventListener('click', () => loadFeed({ reset: false }));

/* Scroll-hide topbar: hide on scroll down, reveal on scroll up */
(function () {
  // Open the page at the top with the nav visible. Without this, the browser
  // restores the previous scroll position on launch, which fires the scroll
  // handler with a downward delta and hides the nav before the user scrolls.
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  setNavHidden(false);

  let lastY = window.scrollY;
  let accum = 0; // signed travel since the last direction change
  let ticking = false;
  const THRESHOLD = 10; // ignore micro-scrolls
  const HOVER_ZONE = 24; // px from the top edge that re-reveals the bar

  window.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      const y = window.scrollY;
      const delta = y - lastY;
      lastY = y;

      if (y <= 0) {
        // Always show at top of page
        accum = 0;
        setNavHidden(false);
      } else if (delta > 0) {
        // Moving down: accumulate travel since the last upward move. Comparing
        // total travel (not a single frame's delta) means a slow, deliberate
        // scroll still crosses the threshold instead of being ignored frame by
        // frame — which previously left the nav stranded on gentle scroll-ups.
        if (accum < 0) accum = 0; // reversed direction; restart the count
        accum += delta;
        if (accum > THRESHOLD) {
          setNavHidden(true);
          // Close any open filter dropdown when hiding nav
          if (el.filterDropdown.matches(':popover-open')) el.filterDropdown.hidePopover();
        }
      } else if (delta < 0) {
        // Moving up: same accumulation, mirrored.
        if (accum > 0) accum = 0; // reversed direction; restart the count
        accum += delta;
        if (accum < -THRESHOLD) setNavHidden(false);
      }

      ticking = false;
    });
  }, { passive: true });

  // Hovering the top edge reveals the hidden bar without scrolling; it stays
  // until the next scroll down hides it again.
  window.addEventListener('mousemove', (e) => {
    if (e.clientY <= HOVER_ZONE) setNavHidden(false);
  }, { passive: true });
})();

/* ---------- keyboard shortcuts ---------- */
// Single source of truth: drives both dispatch (below) and the cheat sheet
// (renderShortcuts). The Enter/Space activation on #app-title stays a local
// element handler — it's an activation key, not a global shortcut.
const SHORTCUTS = [
  { keys: ['?'],      group: 'General',    label: 'Show this shortcut sheet', run: () => toggleShortcuts() },
  { keys: ['j', 'k'], group: 'Navigation', label: 'Next / previous item',     run: (e) => moveFocus(e.key) },
  { keys: ['g'],      group: 'View',       label: 'Toggle grid / list view',  run: () => setView(state.view === 'grid' ? 'list' : 'grid') },
  { keys: ['f'],      group: 'View',       label: 'Toggle filters',           run: () => toggleFilters() },
  { keys: ['r'],      group: 'Feed',       label: 'Refresh feed',             run: () => loadFeed({ reset: true }) },
];

function toggleFilters() {
  if (el.filterDropdown.matches(':popover-open')) el.filterDropdown.hidePopover();
  else el.filterDropdown.showPopover();
}

// Move focus through unfiltered feed headlines (j = down, k = up).
function moveFocus(key) {
  const items = Array.from(document.querySelectorAll('.item:not(.filtered) .item-title a'));
  if (!items.length) return;

  const active = document.activeElement;
  let index = items.indexOf(active);
  if (index === -1) {
    const closestItem = active ? active.closest('.item') : null;
    if (closestItem) index = items.indexOf(closestItem.querySelector('.item-title a'));
  }

  if (key === 'j') index = index === -1 ? 0 : Math.min(index + 1, items.length - 1);
  else index = index === -1 ? items.length - 1 : Math.max(index - 1, 0);

  const target = items[index];
  if (target) {
    target.focus();
    target.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

window.addEventListener('keydown', (e) => {
  // Escape closes the shortcut sheet from anywhere (it isn't a native popover).
  if (e.key === 'Escape' && el.shortcuts.classList.contains('open')) {
    toggleShortcuts(false);
    return;
  }

  if (e.altKey || e.ctrlKey || e.metaKey) return;

  // Shortcuts don't fire from form fields — except 'f', which must still close
  // the filter dropdown when focus is on one of its checkboxes. The custom
  // scope/sort/type dropdowns count as fields too (they replaced <select>s).
  const inField = e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' ||
    e.target.tagName === 'TEXTAREA' || e.isContentEditable ||
    e.target.closest('.filter-select');
  if (inField && !(e.key === 'f' && e.target.closest('#filter-dropdown'))) return;

  const shortcut = SHORTCUTS.find((s) => s.keys.includes(e.key));
  if (!shortcut) return;
  e.preventDefault();
  shortcut.run(e);
});

/* ---------- shortcut cheat sheet ---------- */
function renderShortcuts() {
  const order = [];
  const byGroup = {};
  SHORTCUTS.forEach((s) => {
    if (!byGroup[s.group]) { byGroup[s.group] = []; order.push(s.group); }
    byGroup[s.group].push(s);
  });

  el.shortcutsList.innerHTML = '';
  order.forEach((group) => {
    const section = document.createElement('div');
    section.className = 'shortcut-group';
    const heading = document.createElement('div');
    heading.className = 'shortcut-group-label';
    heading.textContent = group;
    section.appendChild(heading);

    byGroup[group].forEach((s) => {
      const row = document.createElement('div');
      row.className = 'shortcut-row';
      const label = document.createElement('span');
      label.className = 'shortcut-label';
      label.textContent = s.label;
      const keys = document.createElement('span');
      keys.className = 'shortcut-keys';
      s.keys.forEach((k, i) => {
        if (i > 0) {
          const sep = document.createElement('span');
          sep.className = 'shortcut-key-sep';
          sep.textContent = '/';
          keys.appendChild(sep);
        }
        const kbd = document.createElement('kbd');
        kbd.textContent = k;
        keys.appendChild(kbd);
      });
      row.append(label, keys);
      section.appendChild(row);
    });
    el.shortcutsList.appendChild(section);
  });
}

// Modeled on showAuth: same scroll-lock measurement, --scrollbar-comp backfill,
// and reduced-motion-gated deferred release so the fade-out holds without shift.
function toggleShortcuts(show) {
  if (show === undefined) show = !el.shortcuts.classList.contains('open');
  if (show && !el.shortcutsList.children.length) renderShortcuts();

  el.shortcuts.classList.toggle('open', show);
  el.shortcutsOverlay.classList.toggle('open', show);

  const root = document.documentElement;
  if (show) {
    const comp = window.innerWidth - root.clientWidth;
    root.style.setProperty('--scrollbar-comp', `${comp}px`);
    root.classList.add('modal-open');
    el.shortcutsClose.focus();
  } else {
    const release = () => {
      // Keep the lock if another modal is still open.
      if (!el.shortcuts.classList.contains('open') && !el.auth.classList.contains('open')) {
        root.classList.remove('modal-open');
      }
    };
    if (prefersReducedMotion()) release();
    else setTimeout(release, 150); // matches the exit transition
  }
}

el.shortcutsClose.addEventListener('click', () => toggleShortcuts(false));
el.shortcutsOverlay.addEventListener('click', () => toggleShortcuts(false));

start();
