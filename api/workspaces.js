import { db } from 'hatchable';
import { requireSupabaseIdentity } from '../lib/supabase.js';
import { checkRateLimit, respondRateLimited, setApiSecurityHeaders, enforceWriteLimit } from '../lib/security.js';
import { randomBytes } from 'node:crypto';

export const access = 'public';
export const methods = ['GET', 'POST', 'DELETE'];

function json(res, status, body) { return res.status(status).json(body); }

export default async function (req, res) {
  setApiSecurityHeaders(req,res);
  const identity = await requireSupabaseIdentity(req, res);
  if (!identity) return;
  const userId = identity.id;
  const verifiedEmail = identity.email;

  if (req.method === 'GET') {
    const workspaceId = req.query?.workspace_id ? Number(req.query.workspace_id) : null;
    if (workspaceId !== null) {
      if (!Number.isSafeInteger(workspaceId) || workspaceId < 1) return json(res,400,{error:'Invalid workspace.'});
      const { rows: membership } = await db.query('SELECT w.id,w.name,w.owner_id,w.invite_code,w.created_at,m.role,(SELECT COUNT(*)::int FROM orbit_workspace_members mx WHERE mx.workspace_id=w.id) AS member_count FROM orbit_workspace_members m JOIN orbit_workspaces w ON w.id=m.workspace_id WHERE m.user_id=$1 AND w.id=$2',[userId,workspaceId]);
      if (!membership.length) return json(res,403,{error:'You are not a member of this group workspace.'});
      if (membership[0].owner_id !== userId) return json(res,403,{error:'Only the group creator can access member management.'});
      const { rows: members } = await db.query("SELECT m.user_id,COALESCE(NULLIF(m.email,''),u.email) AS email,COALESCE(NULLIF(u.name,''),split_part(COALESCE(NULLIF(m.email,''),u.email),'@',1),'Member') AS display_name,m.role,m.joined_at FROM orbit_workspace_members m LEFT JOIN users u ON u.id=m.user_id WHERE m.workspace_id=$1 ORDER BY CASE WHEN m.role='owner' THEN 0 ELSE 1 END,m.joined_at ASC",[workspaceId]);
      const workspace=membership[0];
      return json(res,200,{workspace,members});
    }
    const { rows } = await db.query(
      'SELECT w.id,w.name,w.owner_id,CASE WHEN w.owner_id=$1 THEN w.invite_code ELSE NULL END AS invite_code,w.created_at,m.role,(SELECT COUNT(*)::int FROM orbit_workspace_members mx WHERE mx.workspace_id=w.id) AS member_count FROM orbit_workspace_members m JOIN orbit_workspaces w ON w.id=m.workspace_id WHERE m.user_id=$1 ORDER BY w.created_at DESC',
      [userId]
    );
    return json(res, 200, { workspaces: rows });
  }

  if (req.method === 'DELETE') {
    if (!await enforceWriteLimit(res, userId, 'workspace-delete-minute', 30, 60)) return;
    const workspaceId=Number(req.query?.workspace_id);
    if(!Number.isSafeInteger(workspaceId)||workspaceId<1)return json(res,400,{error:'A valid workspace is required.'});
    const {rows:ws}=await db.query('SELECT owner_id FROM orbit_workspaces WHERE id=$1',[workspaceId]);
    if(!ws.length)return json(res,404,{error:'Workspace not found.'});
    const targetUserId=String(req.query?.user_id||'').trim();

    // Owners may delete their group; ordinary members may only leave it.
    if(!targetUserId){
      if(ws[0].owner_id===userId){
        const deleted=await db.query('DELETE FROM orbit_workspaces WHERE id=$1 AND owner_id=$2 RETURNING id',[workspaceId,userId]);
        return deleted.rowCount
          ? json(res,200,{ok:true,deleted_workspace_id:workspaceId})
          : json(res,404,{error:'Workspace not found.'});
      }
      const result=await db.query(
        "WITH removed AS (DELETE FROM orbit_workspace_members WHERE workspace_id=$1 AND user_id=$2 AND role='member' RETURNING user_id), moved AS (UPDATE orbit_tasks SET workspace_id=NULL,updated_at=now() WHERE workspace_id=$1 AND user_id=$2 AND EXISTS (SELECT 1 FROM removed) RETURNING id) SELECT (SELECT COUNT(*)::int FROM removed) AS removed_count,(SELECT COUNT(*)::int FROM moved) AS tasks_moved",
        [workspaceId,userId]
      );
      if(!Number(result.rows[0]?.removed_count))return json(res,404,{error:'You are not a member of this workspace.'});
      return json(res,200,{ok:true,left_workspace_id:workspaceId,tasks_moved:Number(result.rows[0]?.tasks_moved)||0});
    }

    // Targeting another user is still restricted to the workspace owner.
    if(ws[0].owner_id!==userId)return json(res,403,{error:'Only the group creator can remove members.'});
    if(targetUserId===userId)return json(res,400,{error:'The creator cannot remove themselves. Transfer ownership or delete the group instead.'});
    const removed=await db.query("DELETE FROM orbit_workspace_members WHERE workspace_id=$1 AND user_id=$2 AND role='member'",[workspaceId,targetUserId]);
    if(!removed.rowCount)return json(res,404,{error:'Member not found or cannot be removed.'});
    return json(res,200,{ok:true,removed_user_id:targetUserId});
  }

  const body = req.body || {};
  const action = body.action;
  if (action === 'rotate_invite') {
    if (!await enforceWriteLimit(res, userId, 'workspace-rotate-hour', 20, 3600)) return;
    const workspaceId=Number(body.workspace_id);
    if(!Number.isSafeInteger(workspaceId)||workspaceId<1)return json(res,400,{error:'A valid workspace is required.'});
    const {rows:existing}=await db.query('SELECT owner_id FROM orbit_workspaces WHERE id=$1',[workspaceId]);
    if(!existing.length)return json(res,404,{error:'Workspace not found.'});
    if(existing[0].owner_id!==userId)return json(res,403,{error:'Only the group creator can regenerate the invite code.'});
    const inviteCode=randomBytes(10).toString('hex').toUpperCase();
    const {rows}=await db.query('UPDATE orbit_workspaces SET invite_code=$1 WHERE id=$2 RETURNING id,name,owner_id,invite_code,created_at',[inviteCode,workspaceId]);
    return json(res,200,{workspace:rows[0]});
  }
  if (action === 'create') {
    if (!await enforceWriteLimit(res, userId, 'workspace-create-hour', 10, 3600)) return;
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 80) : '';
    if (name.length < 2) return json(res, 400, { error: 'Workspace name must be at least 2 characters.' });
    const inviteCode = randomBytes(10).toString('hex').toUpperCase();
    const email=verifiedEmail;
    const { rows } = await db.query(
      "WITH w AS (INSERT INTO orbit_workspaces(name,owner_id,invite_code) VALUES($1,$2,$3) RETURNING id,name,owner_id,invite_code,created_at), m AS (INSERT INTO orbit_workspace_members(workspace_id,user_id,role,email) SELECT id,$2,'owner',$4 FROM w RETURNING workspace_id) SELECT w.* FROM w JOIN m ON m.workspace_id=w.id",
      [name, userId, inviteCode, email]
    );
    return json(res, 201, { workspace: { ...rows[0], role: 'owner' } });
  }

  if (action === 'join') {
    // Rate-limit before validating the code so malformed guesses count too.
    try {
      for (const [bucket, limit, seconds] of [
        ['workspace-join-minute', 5, 60],
        ['workspace-join-hour', 20, 3600]
      ]) {
        const rate = await checkRateLimit(userId, bucket, limit, seconds);
        if (!rate.allowed) return respondRateLimited(res, rate, 'Too many invite attempts. Please wait before trying again.');
      }
    } catch (_) {
      return json(res, 503, { error: 'Invite protection is temporarily unavailable. Please retry shortly.' });
    }
    const inviteCode = typeof body.invite_code === 'string' ? body.invite_code.trim().toUpperCase().replace(/\s+/g, '') : '';
    if (!/^[A-F0-9]{20}$/.test(inviteCode)) return json(res, 400, { error: 'Enter a valid 20-character group invite code.' });
    const { rows } = await db.query('SELECT id,name,owner_id,created_at FROM orbit_workspaces WHERE invite_code=$1 LIMIT 1', [inviteCode]);
    if (!rows.length) return json(res, 404, { error: 'That invite code was not found. Ask the workspace owner for a fresh code.' });
    const workspace = rows[0];
    const email=verifiedEmail;
    // Re-check the still-current invite code in the INSERT statement to avoid a rotate/join race.
    await db.query("INSERT INTO orbit_workspace_members(workspace_id,user_id,role,email) SELECT w.id,$2,'member',$3 FROM orbit_workspaces w WHERE w.id=$1 AND w.invite_code=$4 ON CONFLICT(workspace_id,user_id) DO NOTHING", [workspace.id,userId,email,inviteCode]);
    const membership = await db.query('SELECT role FROM orbit_workspace_members WHERE workspace_id=$1 AND user_id=$2', [workspace.id,userId]);
    if(!membership.rows[0])return json(res,404,{error:'That invite code is no longer valid. Ask the workspace owner for a fresh code.'});
    return json(res, 200, { workspace: { id: workspace.id, name: workspace.name, owner_id: workspace.owner_id, created_at: workspace.created_at, role: membership.rows[0].role } });
  }

  return json(res, 400, { error: 'Choose create or join.' });
}