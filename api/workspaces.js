import { db } from 'hatchable';
import { requireSupabaseUser } from '../lib/supabase.js';
import { randomBytes } from 'node:crypto';

export const access = 'public';
export const methods = ['GET', 'POST'];

function json(res, status, body) { return res.status(status).json(body); }

export default async function (req, res) {
  const userId = await requireSupabaseUser(req, res);
  if (!userId) return;

  if (req.method === 'GET') {
    const { rows } = await db.query(
      'SELECT w.id,w.name,w.owner_id,w.invite_code,w.created_at,m.role,(SELECT COUNT(*)::int FROM orbit_workspace_members mx WHERE mx.workspace_id=w.id) AS member_count FROM orbit_workspace_members m JOIN orbit_workspaces w ON w.id=m.workspace_id WHERE m.user_id=$1 ORDER BY w.created_at DESC',
      [userId]
    );
    return json(res, 200, { workspaces: rows });
  }

  const body = req.body || {};
  const action = body.action;
  if (action === 'create') {
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 80) : '';
    if (name.length < 2) return json(res, 400, { error: 'Workspace name must be at least 2 characters.' });
    const inviteCode = randomBytes(10).toString('hex').toUpperCase();
    const { rows } = await db.query(
      "WITH w AS (INSERT INTO orbit_workspaces(name,owner_id,invite_code) VALUES($1,$2,$3) RETURNING id,name,owner_id,invite_code,created_at), m AS (INSERT INTO orbit_workspace_members(workspace_id,user_id,role) SELECT id,$2,'owner' FROM w RETURNING workspace_id) SELECT w.* FROM w JOIN m ON m.workspace_id=w.id",
      [name, userId, inviteCode]
    );
    return json(res, 201, { workspace: { ...rows[0], role: 'owner' } });
  }

  if (action === 'join') {
    const inviteCode = typeof body.invite_code === 'string' ? body.invite_code.trim().toUpperCase().replace(/\s+/g, '') : '';
    if (!/^[A-F0-9]{20}$/.test(inviteCode)) return json(res, 400, { error: 'Enter a valid 20-character group invite code.' });
    const { rows } = await db.query('SELECT id,name,owner_id,invite_code,created_at FROM orbit_workspaces WHERE invite_code=$1 LIMIT 1', [inviteCode]);
    if (!rows.length) return json(res, 404, { error: 'That invite code was not found. Ask the workspace owner for a fresh code.' });
    const workspace = rows[0];
    await db.query("INSERT INTO orbit_workspace_members(workspace_id,user_id,role) VALUES($1,$2,'member') ON CONFLICT(workspace_id,user_id) DO NOTHING", [workspace.id,userId]);
    const membership = await db.query('SELECT role FROM orbit_workspace_members WHERE workspace_id=$1 AND user_id=$2', [workspace.id,userId]);
    return json(res, 200, { workspace: { ...workspace, role: membership.rows[0]?.role || 'member' } });
  }

  return json(res, 400, { error: 'Choose create or join.' });
}