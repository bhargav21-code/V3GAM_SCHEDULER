import { db } from 'hatchable';
import { createHash } from 'node:crypto';

/*
 * Headers for JSON/API responses. Hatchable must apply equivalent headers to
 * static HTML at the hosting layer; application code cannot set those headers
 * on static-file responses. Do not emit Access-Control-Allow-Origin: *.
 */
export function setApiSecurityHeaders(req, res) {
  if (!res) return;
  const headers = [
    ['X-Content-Type-Options', 'nosniff'],
    ['X-Frame-Options', 'DENY'],
    ['Referrer-Policy', 'no-referrer'],
    ['Content-Security-Policy', "default-src 'none'; base-uri 'none'; frame-ancestors 'none'"],
    ['Cache-Control', 'no-store, max-age=0'],
    ['Cross-Origin-Resource-Policy', 'same-origin'],
    ['Strict-Transport-Security', 'max-age=31536000; includeSubDomains']
  ];
  for (const [name, value] of headers) {
    try {
      if (typeof res.setHeader === 'function') res.setHeader(name, value);
      else if (typeof res.header === 'function') res.header(name, value);
      else if (typeof res.set === 'function') res.set(name, value);
    } catch (_) {
      // Header support differs between response adapters; do not break API behavior.
    }
  }
}

export async function checkRateLimit(subject, bucket, limit, windowSeconds) {
  const subjectValue = String(subject || '');
  if (!subjectValue || !/^[a-z0-9:_-]{1,80}$/i.test(String(bucket)) ||
      !Number.isSafeInteger(limit) || limit < 1 ||
      !Number.isSafeInteger(windowSeconds) || windowSeconds < 1) {
    throw new Error('Invalid rate-limit configuration.');
  }

  // Hash the subject so raw user identifiers never enter the limiter table.
  const subjectHash = createHash('sha256').update(subjectValue).digest('hex');
  const now = new Date();
  const windowMs = windowSeconds * 1000;
  const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs);
  const windowExpires = new Date(windowStart.getTime() + windowMs);

  const { rows } = await db.query(
    `INSERT INTO orbit_security_rate_limits
       (bucket, subject_hash, window_started_at, request_count, expires_at)
     VALUES ($1, $2, $3, 1, $4)
     ON CONFLICT (bucket, subject_hash) DO UPDATE SET
       request_count = CASE
         WHEN orbit_security_rate_limits.window_started_at < EXCLUDED.window_started_at THEN 1
         ELSE orbit_security_rate_limits.request_count + 1
       END,
       window_started_at = GREATEST(
         orbit_security_rate_limits.window_started_at,
         EXCLUDED.window_started_at
       ),
       expires_at = CASE
         WHEN orbit_security_rate_limits.window_started_at < EXCLUDED.window_started_at THEN EXCLUDED.expires_at
         ELSE orbit_security_rate_limits.expires_at
       END
     RETURNING request_count, expires_at`,
    [String(bucket), subjectHash, windowStart, windowExpires]
  );

  const count = Number(rows[0]?.request_count);
  const expiryMs = new Date(rows[0]?.expires_at || windowExpires).getTime();
  return {
    allowed: Number.isFinite(count) && count <= limit,
    count,
    limit,
    retryAfterSeconds: Math.max(1, Math.ceil((expiryMs - now.getTime()) / 1000))
  };
}

/* Per-user limiter for authenticated write endpoints. Returns true when the request may proceed. */
export async function enforceWriteLimit(res, userId, bucket, limit, windowSeconds = 60) {
  try {
    const rate = await checkRateLimit(userId, bucket, limit, windowSeconds);
    if (!rate.allowed) {
      respondRateLimited(res, rate, 'Too many requests. Please slow down and try again shortly.');
      return false;
    }
    return true;
  } catch (_) {
    res.status(503).json({ error: 'Request protection is temporarily unavailable. Please retry shortly.', retryable: true });
    return false;
  }
}

export function respondRateLimited(res, result, message) {
  try {
    if (typeof res.setHeader === 'function') res.setHeader('Retry-After', String(result.retryAfterSeconds));
    else if (typeof res.header === 'function') res.header('Retry-After', String(result.retryAfterSeconds));
    else if (typeof res.set === 'function') res.set('Retry-After', String(result.retryAfterSeconds));
  } catch (_) {}
  return res.status(429).json({
    error: message,
    retry_after_seconds: result.retryAfterSeconds
  });
}

/* Read a failure-only bucket without consuming an attempt. */
export async function peekRateLimit(subject, bucket, limit, windowSeconds) {
  const subjectValue = String(subject || '');
  if (!subjectValue || !/^[a-z0-9:_-]{1,80}$/i.test(String(bucket)) ||
      !Number.isSafeInteger(limit) || limit < 1 ||
      !Number.isSafeInteger(windowSeconds) || windowSeconds < 1) {
    throw new Error('Invalid rate-limit configuration.');
  }
  const subjectHash = createHash('sha256').update(subjectValue).digest('hex');
  const now = new Date();
  const windowMs = windowSeconds * 1000;
  const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs);
  const windowExpires = new Date(windowStart.getTime() + windowMs);
  const { rows } = await db.query(
    'SELECT request_count, window_started_at, expires_at FROM orbit_security_rate_limits WHERE bucket=$1 AND subject_hash=$2 LIMIT 1',
    [String(bucket), subjectHash]
  );
  const row = rows[0];
  const activeWindow = !!row && new Date(row.window_started_at).getTime() >= windowStart.getTime();
  const count = activeWindow ? Number(row.request_count) : 0;
  const expiryMs = activeWindow ? new Date(row.expires_at).getTime() : windowExpires.getTime();
  return {
    allowed: Number.isFinite(count) && count < limit,
    count,
    limit,
    retryAfterSeconds: Math.max(1, Math.ceil((expiryMs - now.getTime()) / 1000))
  };
}

/* Increment a failure-only bucket after a rejected credential attempt. */
export async function recordRateLimitFailure(subject, bucket, windowSeconds) {
  const subjectValue = String(subject || '');
  if (!subjectValue || !/^[a-z0-9:_-]{1,80}$/i.test(String(bucket)) ||
      !Number.isSafeInteger(windowSeconds) || windowSeconds < 1) {
    throw new Error('Invalid rate-limit configuration.');
  }
  const subjectHash = createHash('sha256').update(subjectValue).digest('hex');
  const now = new Date();
  const windowMs = windowSeconds * 1000;
  const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs);
  const windowExpires = new Date(windowStart.getTime() + windowMs);
  await db.query(
    'INSERT INTO orbit_security_rate_limits (bucket, subject_hash, window_started_at, request_count, expires_at) ' +
    'VALUES ($1, $2, $3, 1, $4) ON CONFLICT (bucket, subject_hash) DO UPDATE SET ' +
    'request_count = CASE WHEN orbit_security_rate_limits.window_started_at < EXCLUDED.window_started_at THEN 1 ' +
    'ELSE orbit_security_rate_limits.request_count + 1 END, ' +
    'window_started_at = GREATEST(orbit_security_rate_limits.window_started_at, EXCLUDED.window_started_at), ' +
    'expires_at = CASE WHEN orbit_security_rate_limits.window_started_at < EXCLUDED.window_started_at THEN EXCLUDED.expires_at ' +
    'ELSE orbit_security_rate_limits.expires_at END',
    [String(bucket), subjectHash, windowStart, windowExpires]
  );
}

export async function clearRateLimit(subject, bucket) {
  const subjectValue = String(subject || '');
  if (!subjectValue || !/^[a-z0-9:_-]{1,80}$/i.test(String(bucket))) {
    throw new Error('Invalid rate-limit configuration.');
  }
  const subjectHash = createHash('sha256').update(subjectValue).digest('hex');
  await db.query(
    'DELETE FROM orbit_security_rate_limits WHERE bucket=$1 AND subject_hash=$2',
    [String(bucket), subjectHash]
  );
}

/**
 * Authorize a task mutation using fresh database state. `action` is one of
 * edit, delete, or complete. Assigned users may only complete their task;
 * assignment never grants edit, reschedule, skip, snooze, or delete rights.
 */
export async function canMutateTask(user, task, workspace, action = 'edit') {
  const userId = String(user?.id || user || '');
  if (!userId || !task || !['edit', 'delete', 'complete'].includes(action)) {
    return { allowed: false, reason: 'invalid_request' };
  }

  const taskWorkspaceId = task.workspace_id == null ? null : Number(task.workspace_id);
  if (taskWorkspaceId === null) {
    const ownsPersonalTask = String(task.user_id) === userId;
    return { allowed: ownsPersonalTask, reason: ownsPersonalTask ? null : 'not_owner' };
  }

  const suppliedWorkspaceId = Number(typeof workspace === 'object' ? workspace?.id : workspace);
  if (!Number.isSafeInteger(taskWorkspaceId) || taskWorkspaceId < 1 || suppliedWorkspaceId !== taskWorkspaceId) {
    return { allowed: false, reason: 'workspace_mismatch' };
  }

  // Never trust a workspace object cached by the caller; check live membership
  // and owner identity on every mutation so revocation takes effect immediately.
  const { rows } = await db.query(
    'SELECT w.owner_id, m.user_id AS member_id FROM orbit_workspaces w LEFT JOIN orbit_workspace_members m ON m.workspace_id=w.id AND m.user_id=$2 WHERE w.id=$1 LIMIT 1',
    [taskWorkspaceId, userId]
  );
  if (!rows[0] || !rows[0].member_id) return { allowed: false, reason: 'not_member' };
  if (String(rows[0].owner_id) === userId) return { allowed: true, reason: null };
  if (String(task.user_id) === userId) return { allowed: true, reason: null };
  if (action === 'complete' && String(task.assigned_to_user_id || '') === userId) {
    return { allowed: true, reason: null };
  }
  return { allowed: false, reason: 'not_task_creator_or_owner' };
}