import { db } from 'hatchable';
import { requireSupabaseUser } from '../lib/supabase.js';
import { randomBytes } from 'node:crypto';

export const access = 'public';
export const methods = ['GET', 'POST', 'DELETE'];

function json(res, status, body) { return res.status(status).json(body); }

export default async function (req, res) {
  const userId = await requireSupabaseUser(req, res);
  if (!userId) return;

  if (req.method === 'GET') {
    const workspaceId = req.query?.workspace_id ? Number(req.query.workspace_id) : null;
    if (workspaceId !== null) {
      if (!Number.isSafeInteger(workspaceId) || workspaceId < 1) return json(res,400,{error:'Invalid workspace.'});
      const { rows: membership } = await db.query('SELECT w.id,w.name,w.owner_id,w.invite_code,w.created_at,m.role FROM orbit_workspace_members m JOIN orbit_workspaces w ON w.id=m.workspace_id WHERE m.user_id=$1 AND w.id=$2',[userId,workspaceId]);
      if (!membership.length) return json(res,403,{error:'You are not a member of this group workspace.'});
      const { rows: members } = await db.query("SELECT m.user_id,COALESCE(NULLIF(m.email,''),u.email) AS email,COALESCE(NULLIF(u.name,''),split_part(COALESCE(NULLIF(m.email,''),u.email),'@',1),'Member') AS display_name,m.role,m.joined_at FROM orbit_workspace_members m LEFT JOIN users u ON u.id=m.user_id WHERE m.workspace_id=$1 ORDER BY CASE WHEN m.role='owner' THEN 0 ELSE 1 END,m.joined_at ASC",[workspaceId]);
      return json(res,200,{workspace:membership[0],members});
    }
    const { rows } = await db.query(
      'SELECT w.id,w.name,w.owner_id,w.invite_code,w.created_at,m.role,(SELECT COUNT(*)::int FROM orbit_workspace_members mx WHERE mx.workspace_id=w.id) AS member_count FROM orbit_workspace_members m JOIN orbit_workspaces w ON w.id=m.workspace_id WHERE m.user_id=$1 ORDER BY w.created_at DESC',
      [userId]
    );
    return json(res, 200, { workspaces: rows });
  }

  if (req.method === 'DELETE') {
    const workspaceId=Number(req.query?.workspace_id), targetUserId=String(req.query?.user_id||'');
    if(!Number.isSafeInteger(workspaceId)||workspaceId<1||!targetUserId)return json(res,400,{error:'Workspace and member are required.'});
    const {rows:ws}=await db.query('SELECT owner_id FROM orbit_workspaces WHERE id=$1',[workspaceId]);
    if(!ws.length)return json(res,404,{error:'Workspace not found.'});
    if(ws[0].owner_id!==userId)return json(res,403,{error:'Only the group creator can remove members.'});
    if(targetUserId===userId)return json(res,400,{error:'The creator cannot remove themselves. Transfer ownership or delete the group instead.'});
    const removed=await db.query('DELETE FROM orbit_workspace_members WHERE workspace_id=$1 AND user_id=$2 AND role<>$3',[workspaceId,targetUserId,'owner']);
    if(!removed.rowCount)return json(res,404,{error:'Member not found or cannot be removed.'});
    return json(res,200,{ok:true,removed_user_id:targetUserId});
  }

  const body = req.body || {};
  const action = body.action;
  if (action === 'create') {
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 80) : '';
    if (name.length < 2) return json(res, 400, { error: 'Workspace name must be at least 2 characters.' });
    const inviteCode = randomBytes(10).toString('hex').toUpperCase();
    const email=typeof body.email==='string'?body.email.trim().slice(0,254):'';
    const { rows } = await db.query(
      "WITH w AS (INSERT INTO orbit_workspaces(name,owner_id,invite_code) VALUES($1,$2,$3) RETURNING id,name,owner_id,invite_code,created_at), m AS (INSERT INTO orbit_workspace_members(workspace_id,user_id,role,email) SELECT id,$2,'owner',$4 FROM w RETURNING workspace_id) SELECT w.* FROM w JOIN m ON m.workspace_id=w.id",
      [name, userId, inviteCode, email]
    );
    return json(res, 201, { workspace: { ...rows[0], role: 'owner' } });
  }

  if (action === 'join') {
    const inviteCode = typeof body.invite_code === 'string' ? body.invite_code.trim().toUpperCase().replace(/\s+/g, '') : '';
    if (!/^[A-F0-9]{20}$/.test(inviteCode)) return json(res, 400, { error: 'Enter a valid 20-character group invite code.' });
    const { rows } = await db.query('SELECT id,name,owner_id,invite_code,created_at FROM orbit_workspaces WHERE invite_code=$1 LIMIT 1', [inviteCode]);
    if (!rows.length) return json(res, 404, { error: 'That invite code was not found. Ask the workspace owner for a fresh code.' });
    const workspace = rows[0];
    const email=typeof body.email==='string'?body.email.trim().slice(0,254):'';
    await db.query("INSERT INTO orbit_workspace_members(workspace_id,user_id,role,email) VALUES($1,$2,'member',$3) ON CONFLICT(workspace_id,user_id) DO NOTHING", [workspace.id,userId,email]);
    const membership = await db.query('SELECT role FROM orbit_workspace_members WHERE workspace_id=$1 AND user_id=$2', [workspace.id,userId]);
    return json(res, 200, { workspace: { ...workspace, role: membership.rows[0]?.role || 'member' } });
  }

  return json(res, 400, { error: 'Choose create or join.' });
}