import { getSupabaseConfig } from '../lib/supabase.js';
import {
  setApiSecurityHeaders,
  checkRateLimit,
  peekRateLimit,
  recordRateLimitFailure,
  clearRateLimit,
  respondRateLimited
} from '../lib/security.js';

export const access = 'public';
export const methods = ['POST'];

function json(res, status, body) {
  return res.status(status).json(body);
}

function getClientIp(req) {
  const headers = req.headers || {};
  const validIp = value => typeof value === 'string' &&
    value.length >= 3 && value.length <= 64 &&
    /^[0-9a-f:.]+$/i.test(value.trim()) &&
    (value.includes('.') || value.includes(':'));

  // Trust only the rightmost X-Forwarded-For entry, which Hatchable's reverse proxy
  // appends. Client-supplied headers such as X-Real-IP are ignored so they cannot
  // be rotated to evade the per-IP rate limits.
  const forwarded = headers['x-forwarded-for'] || headers['X-Forwarded-For'] || '';
  if (typeof forwarded === 'string') {
    const rightmost = forwarded.split(',').map(v => v.trim()).filter(Boolean).pop() || '';
    if (validIp(rightmost)) return rightmost;
  }
  return '';
}

export default async function (req, res) {
  setApiSecurityHeaders(req, res);
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed.' });

  const body = req.body || {};
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!email || email.length > 254 || !email.includes('@') ||
      !password || password.length > 1024) {
    return json(res, 400, { error: 'Enter a valid email and password.' });
  }

  const ip = getClientIp(req);
  // Failure buckets are scoped to the IP/email pair to avoid globally locking
  // an account just because an attacker knows its email. Supabase also enforces
  // its own IP-based token-endpoint limits.
  const failureSubject = ip ? 'ip:' + ip + '|email:' + email : 'email:' + email;

  try {
    if (ip) {
      for (const [bucket, limit, seconds] of [
        ['login-ip-minute', 30, 60],
        ['login-ip-hour', 120, 3600]
      ]) {
        const rate = await checkRateLimit(ip, bucket, limit, seconds);
        if (!rate.allowed) return respondRateLimited(res, rate, 'Too many sign-in attempts. Please wait before trying again.');
      }
    }
    for (const [bucket, limit, seconds] of [
      ['login-fail-minute', 5, 60],
      ['login-fail-hour', 20, 3600]
    ]) {
      const rate = await peekRateLimit(failureSubject, bucket, limit, seconds);
      if (!rate.allowed) return respondRateLimited(res, rate, 'Too many unsuccessful sign-in attempts. Please wait before trying again.');
    }
  } catch (_) {
    return json(res, 503, { error: 'Sign-in protection is temporarily unavailable. Please retry shortly.' });
  }

  let supabase;
  try {
    supabase = await getSupabaseConfig();
  } catch (_) {
    return json(res, 503, { error: 'Authentication is temporarily unavailable. Please try again later.' });
  }

  let response;
  let data;
  try {
    response = await fetch(supabase.url + '/auth/v1/token?grant_type=password', {
      method: 'POST',
      headers: {
        apikey: supabase.key,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify({ email, password })
    });
    data = await response.json().catch(() => ({}));
  } catch (_) {
    return json(res, 503, { error: 'Authentication is temporarily unavailable. Please try again later.' });
  }

  if (response.status === 429) {
    const retryAfter = Number(response.headers.get('retry-after'));
    const retry = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.ceil(retryAfter) : 60;
    try {
      if (typeof res.setHeader === 'function') res.setHeader('Retry-After', String(retry));
      else if (typeof res.header === 'function') res.header('Retry-After', String(retry));
      else if (typeof res.set === 'function') res.set('Retry-After', String(retry));
    } catch (_) {}
    return json(res, 429, { error: 'Too many sign-in attempts. Please wait before trying again.', retry_after_seconds: retry });
  }

  if (response.status === 400 || response.status === 401) {
    try {
      await recordRateLimitFailure(failureSubject, 'login-fail-minute', 60);
      await recordRateLimitFailure(failureSubject, 'login-fail-hour', 3600);
    } catch (_) {
      return json(res, 503, { error: 'Sign-in protection is temporarily unavailable. Please retry shortly.' });
    }
    return json(res, 401, { error: 'Invalid login credentials.' });
  }

  if (!response.ok) return json(res, 503, { error: 'Authentication is temporarily unavailable. Please try again later.' });
  if (typeof data.access_token !== 'string' || !data.access_token ||
      typeof data.refresh_token !== 'string' || !data.refresh_token ||
      !data.user || typeof data.user.id !== 'string') {
    return json(res, 502, { error: 'Authentication returned an invalid session.' });
  }

  // Password failures are cleared after a successful authentication.
  try {
    await clearRateLimit(failureSubject, 'login-fail-minute');
    await clearRateLimit(failureSubject, 'login-fail-hour');
  } catch (_) {
    // Do not discard a valid session because failure-counter cleanup failed.
  }

  try {
    if (typeof res.setHeader === 'function') res.setHeader('Cache-Control', 'no-store, max-age=0');
  } catch (_) {}
  return json(res, 200, {
    session: {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      token_type: data.token_type || 'bearer',
      expires_in: data.expires_in,
      expires_at: data.expires_at
    },
    user: data.user
  });
}