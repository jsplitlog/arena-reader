/*
 * Are.na OAuth 2.0 — Authorization Code + PKCE (public client).
 * Exploration for issue #18. See docs/oauth-exploration.md.
 *
 * This app is a static site with no backend, so it is a *public* OAuth
 * client: there is no place to keep a client secret, and PKCE replaces it
 * (per the Are.na SDK docs, which support "Authorization Code + PKCE").
 */

const OAUTH = {
  // Registered at https://www.are.na/developers/oauth/applications.
  // The registered redirect URIs must exactly match redirectUri below
  // (production URL and http://127.0.0.1:8000/ for local dev).
  clientId: 'jCHfPWPrViwkd23ZgyHM42X0DDKvrV3vwaDi9DULbCE',
  redirectUri: location.origin + location.pathname,
  authorizeUrl: 'https://www.are.na/oauth/authorize',
  tokenUrl: 'https://api.are.na/v3/oauth/token',
  // Least privilege: the reader only needs 'read'. The registered app
  // supports 'write' too — flip this when the connect-to-channel feature
  // (#19) lands; users will see one re-consent redirect.
  scope: 'read',
};

// PKCE verifier/state are transient redirect-transaction values — the docs
// recommend sessionStorage over localStorage for them.
const OAUTH_VERIFIER_KEY = 'arena_oauth_code_verifier';
const OAUTH_STATE_KEY = 'arena_oauth_state';
// The "Remember on this device" choice has to survive the redirect to
// are.na, so it rides along with the other transient values.
const OAUTH_REMEMBER_KEY = 'arena_oauth_remember';

function base64url(bytes) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function generatePKCE() {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { verifier, challenge: base64url(new Uint8Array(digest)) };
}

function generateState() {
  return base64url(crypto.getRandomValues(new Uint8Array(16)));
}

// WebCrypto requires a secure context (https or localhost), which OAuth
// needs anyway — redirect URIs should not be plain http in production.
function oauthAvailable() {
  return !!OAUTH.clientId && window.isSecureContext && !!(crypto && crypto.subtle);
}

async function startOAuth(opts) {
  const { verifier, challenge } = await generatePKCE();
  const state = generateState();
  sessionStorage.setItem(OAUTH_VERIFIER_KEY, verifier);
  sessionStorage.setItem(OAUTH_STATE_KEY, state);
  if (opts && opts.remember) sessionStorage.setItem(OAUTH_REMEMBER_KEY, '1');
  else sessionStorage.removeItem(OAUTH_REMEMBER_KEY);
  const params = new URLSearchParams({
    client_id: OAUTH.clientId,
    redirect_uri: OAUTH.redirectUri,
    response_type: 'code',
    scope: OAUTH.scope,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  location.assign(`${OAUTH.authorizeUrl}?${params.toString()}`);
}

/*
 * Call once on startup. Returns:
 *   null                — current URL is not an OAuth callback
 *   { token, remember } — success; remember reflects the pre-redirect choice
 *   { error: string }   — callback failed (state mismatch, denial, exchange error)
 * Always strips OAuth params from the URL and clears transient storage.
 */
async function handleOAuthCallback() {
  const params = new URLSearchParams(location.search);
  if (!params.has('code') && !params.has('error')) return null;

  const storedState = sessionStorage.getItem(OAUTH_STATE_KEY);
  const verifier = sessionStorage.getItem(OAUTH_VERIFIER_KEY);
  const remember = sessionStorage.getItem(OAUTH_REMEMBER_KEY) === '1';
  sessionStorage.removeItem(OAUTH_STATE_KEY);
  sessionStorage.removeItem(OAUTH_VERIFIER_KEY);
  sessionStorage.removeItem(OAUTH_REMEMBER_KEY);
  // Remove code/state from the address bar and history before doing
  // anything else, so the one-time code never lingers in the URL.
  history.replaceState(null, '', location.pathname);

  if (params.get('error')) {
    return { error: params.get('error_description') || `Sign-in was cancelled (${params.get('error')}).` };
  }
  if (!storedState || params.get('state') !== storedState) {
    return { error: 'Sign-in state mismatch. Please try again.' };
  }
  if (!verifier) {
    return { error: 'Sign-in session expired. Please try again.' };
  }

  try {
    const res = await fetch(OAUTH.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: OAUTH.clientId,
        redirect_uri: OAUTH.redirectUri,
        code: params.get('code'),
        code_verifier: verifier,
      }),
    });
    let body = {};
    try { body = await res.json(); } catch (_) {}
    if (!res.ok || !body.access_token) {
      return { error: body.error_description || body.error || `Token exchange failed (${res.status}).` };
    }
    return { token: body.access_token, remember };
  } catch (_) {
    return { error: 'Could not reach api.are.na to complete sign-in.' };
  }
}
