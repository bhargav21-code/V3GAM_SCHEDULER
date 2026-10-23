import { config } from 'hatchable';
import { setApiSecurityHeaders } from './security.js';

export async function getSupabaseConfig() {
  const rawUrl = String(await config.get('SUPABASE_URL') || '').replace(/\/$/, '');
  const key = String(await config.get('SUPABASE_ANON_KEY') || '');

  let parsed;
  try { parsed = new URL(rawUrl); } catch (_) { throw new Error('Supabase setup required'); }
  if (parsed.protocol !== 'https:' || !/^[a-z0-9.-]+$/i.test(parsed.hostname) ||
      parsed.pathname !== '/' || parsed.username || parsed.password || parsed.search || parsed.hash || !key) {
    throw new Error('Supabase setup required');
  }
  return { url: parsed.origin, key };
}

export async function requireSupabaseIdentity(req, res) {
  setApiSecurityHeaders(req, res);

  const authorization = String(req.headers?.authorization || '');
  const match = authorization.match(/^Bearer\s+([^\s]+)$/i);
  const token = match?.[1] || '';
  // Real Supabase access tokens are far shorter; reject oversized headers early.
  if (!token || token.length > 8192) {
    res.status(401).json({ error: 'Please sign in to continue.' });
    return null;
  }

  let supabase;
  try {
    supabase = await getSupabaseConfig();
  } catch (_) {
    res.status(503).json({
      error: 'Supabase authentication is not configured. Check SUPABASE_URL and SUPABASE_ANON_KEY in Hatchable Setup.',
      setup_required: true
    });
    return null;
  }

  try {
    const response = await fetch(supabase.url + '/auth/v1/user', {
      method: 'GET',
      headers: {
        apikey: supabase.key,
        Authorization: 'Bearer ' + token,
        Accept: 'application/json'
      }
    });
    if (!response.ok) {
      res.status(401).json({ error: 'Your session expired. Please sign in again.' });
      return null;
    }
    const user = await response.json();
    if (!user || typeof user.id !== 'string' || !user.id || user.id.length > 256) {
      res.status(401).json({ error: 'Invalid session.' });
      return null;
    }
    return {
      id: user.id,
      email: typeof user.email === 'string' ? user.email.trim().slice(0, 254) : ''
    };
  } catch (_) {
    res.status(503).json({
      error: 'The authentication service is temporarily unavailable. Please try again shortly.',
      setup_required: false,
      retryable: true
    });
    return null;
  }
}

export async function requireSupabaseUser(req, res) {
  const identity = await requireSupabaseIdentity(req, res);
  return identity?.id || null;
}