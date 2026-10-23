import { db } from 'hatchable';
import { requireSupabaseUser } from '../lib/supabase.js';
import { canMutateTask, setApiSecurityHeaders, enforceWriteLimit } from '../lib/security.js';

export const access = 'public';
export const methods = ['GET', 'POST', 'PATCH', 'DELETE'];

function json(res, status, body) { return res.status(status).json(body); }
function validDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [year, month, day] = s.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}
function cleanTitle(v) { return typeof v === 'string' ? v.trim().slice(0, 180) : ''; }
function parseWorkspaceId(v) {
  if (v === undefined || v === null || v === '') return null;
  const id = Number(v);
  return Number.isSafeInteger(id) && id > 0 ? id : NaN;
}
async function isMember(userId, workspaceId) {
  const { rows } = await db.query('SELECT 1 FROM orbit_workspace_members WHERE workspace_id=$1 AND user_id=$2 LIMIT 1', [workspaceId,userId]);
  return rows.length > 0;
}

export default async function (req, res) {
  setApiSecurityHeaders(req,res);
  const userId = await requireSupabaseUser(req,res); if(!userId)return;
  if (req.method !== 'GET' && !await enforceWriteLimit(res, userId, 'tasks-write', 60)) return;

  if (req.method === 'GET') {
    const date = typeof req.query?.date === 'string' && validDate(req.query.date) ? req.query.date : null;
    const workspaceId = parseWorkspaceId(req.query?.workspace_id);
    if (Number.isNaN(workspaceId)) return json(res, 400, { error: 'Invalid workspace.' });
    if (workspaceId !== null) {
      if (!await isMember(userId,workspaceId)) return json(res, 403, { error: 'You are not a member of this group workspace.' });
      const { rows } = await db.query(
        'SELECT id,user_id,title,category,duration_minutes,starts_at,due_date,status,detail,source,workspace_id,created_at,updated_at FROM orbit_tasks WHERE workspace_id=$1 AND EXISTS (SELECT 1 FROM orbit_workspace_members m WHERE m.workspace_id=$1 AND m.user_id=$3) AND ($2::date IS NULL OR due_date=$2::date) ORDER BY due_date NULLS LAST,starts_at NULLS LAST,created_at DESC LIMIT 500',
        [workspaceId,date,userId]
      );
      return json(res,200,{tasks:rows});
    }
    const { rows } = await db.query(
      'SELECT id,user_id,title,category,duration_minutes,starts_at,due_date,status,detail,source,workspace_id,created_at,updated_at FROM orbit_tasks WHERE user_id=$1 AND workspace_id IS NULL AND ($2::date IS NULL OR due_date=$2::date) ORDER BY due_date NULLS LAST,starts_at NULLS LAST,created_at DESC LIMIT 500',
      [userId,date]
    );
    return json(res, 200, { tasks: rows });
  }

  if (req.method === 'POST') {
    const b = req.body || {};
    const title = cleanTitle(b.title);
    if (!title) return json(res, 400, { error: 'Task title is required.' });
    const duration = Number(b.duration_minutes ?? 60);
    if (!Number.isInteger(duration) || duration < 5 || duration > 1440) return json(res, 400, { error: 'Duration must be 5–1440 minutes.' });
    const status = ['planned','active','done','skipped'].includes(b.status) ? b.status : 'planned';
    const category = typeof b.category === 'string' ? b.category.slice(0, 40) : 'study';
    const detail = typeof b.detail === 'string' ? b.detail.slice(0, 1000) : '';
    const dueDate = validDate(b.due_date) ? b.due_date : null;
    const startsAt = typeof b.starts_at === 'string' && !Number.isNaN(Date.parse(b.starts_at)) ? new Date(b.starts_at).toISOString() : null;
    const workspaceId = parseWorkspaceId(b.workspace_id);
    if (Number.isNaN(workspaceId)) return json(res, 400, { error: 'Invalid workspace.' });
    if (workspaceId !== null && !await isMember(userId,workspaceId)) return json(res, 403, { error: 'You are not a member of this group workspace.' });
    const params=[userId,workspaceId,title,category,duration,startsAt,dueDate,status,detail,b.source === 'voice' ? 'voice' : 'manual'];
    const result = workspaceId !== null
      ? await db.query('INSERT INTO orbit_tasks(user_id,workspace_id,title,category,duration_minutes,starts_at,due_date,status,detail,source) SELECT $1,$2,$3,$4,$5,$6::timestamptz,$7::date,$8,$9,$10 FROM orbit_workspace_members m WHERE m.workspace_id=$2 AND m.user_id=$1 RETURNING *',params)
      : await db.query('INSERT INTO orbit_tasks(user_id,workspace_id,title,category,duration_minutes,starts_at,due_date,status,detail,source) VALUES($1,$2,$3,$4,$5,$6::timestamptz,$7::date,$8,$9,$10) RETURNING *',params);
    if (!result.rows[0]) return json(res,403,{error:'You are no longer a member of this group workspace.'});
    return json(res, 201, { task: result.rows[0] });
  }

  const b = req.body || {};
  const id = Number(req.query?.id ?? b.id);
  if (!Number.isSafeInteger(id) || id < 1) return json(res, 400, { error: 'A valid task id is required.' });
  const workspaceId = parseWorkspaceId(req.query?.workspace_id ?? b.workspace_id);
  if (Number.isNaN(workspaceId)) return json(res,400,{error:'Invalid workspace.'});
  if (workspaceId !== null && !await isMember(userId,workspaceId)) return json(res,403,{error:'You are not a member of this group workspace.'});

  if (req.method === 'DELETE') {
    const found = workspaceId !== null
      ? await db.query('SELECT * FROM orbit_tasks WHERE id=$1 AND workspace_id=$2 LIMIT 1', [id,workspaceId])
      : await db.query('SELECT * FROM orbit_tasks WHERE id=$1 AND user_id=$2 AND workspace_id IS NULL LIMIT 1', [id,userId]);
    const task = found.rows[0];
    if (!task) return json(res,404,{error:'Task not found.'});
    const permission = await canMutateTask(userId,task,workspaceId,'delete');
    if (!permission.allowed) return json(res,403,{error:'You can delete only tasks you created. Group owners can delete any group task.'});
    const deleted = workspaceId !== null
      ? await db.query('DELETE FROM orbit_tasks WHERE id=$1 AND workspace_id=$2 AND EXISTS (SELECT 1 FROM orbit_workspace_members m WHERE m.workspace_id=$2 AND m.user_id=$3) AND EXISTS (SELECT 1 FROM orbit_workspaces w WHERE w.id=$2 AND (w.owner_id=$3 OR orbit_tasks.user_id=$3))', [id,workspaceId,userId])
      : await db.query('DELETE FROM orbit_tasks WHERE id=$1 AND user_id=$2 AND workspace_id IS NULL', [id,userId]);
    return deleted.rowCount ? json(res,200,{ok:true}) : json(res,403,{error:'Task permission changed. Refresh and try again.'});
  }

  const allowed = [];
  const values = [];
  const add = (column, value, cast = '') => { values.push(value); allowed.push(column + '=$' + values.length + cast); };
  if (b.title !== undefined) { const v=cleanTitle(b.title); if(!v)return json(res,400,{error:'Task title cannot be empty.'}); add('title',v); }
  if (b.status !== undefined) { if(!['planned','active','done','skipped'].includes(b.status))return json(res,400,{error:'Invalid status.'}); add('status',b.status); }
  if (b.category !== undefined) add('category',String(b.category).slice(0,40));
  if (b.detail !== undefined) add('detail',String(b.detail).slice(0,1000));
  if (b.duration_minutes !== undefined) { const n=Number(b.duration_minutes);if(!Number.isInteger(n)||n<5||n>1440)return json(res,400,{error:'Invalid duration.'});add('duration_minutes',n); }
  if (b.due_date !== undefined) add('due_date',validDate(b.due_date)?b.due_date:null,'::date');
  if (b.starts_at !== undefined) add('starts_at',b.starts_at && !Number.isNaN(Date.parse(b.starts_at))?new Date(b.starts_at).toISOString():null,'::timestamptz');
  if (!allowed.length) return json(res,400,{error:'No editable fields supplied.'});
  const taskLookup = workspaceId !== null
    ? await db.query('SELECT * FROM orbit_tasks WHERE id=$1 AND workspace_id=$2 LIMIT 1',[id,workspaceId])
    : await db.query('SELECT * FROM orbit_tasks WHERE id=$1 AND user_id=$2 AND workspace_id IS NULL LIMIT 1',[id,userId]);
  const existingTask = taskLookup.rows[0];
  if (!existingTask) return json(res,404,{error:'Task not found.'});
  const onlyCompleting = b.status === 'done' && Object.keys(b).every(k => ['id','workspace_id','status'].includes(k));
  const permission = await canMutateTask(userId,existingTask,workspaceId,onlyCompleting?'complete':'edit');
  if (!permission.allowed) return json(res,403,{error:'You can edit only tasks you created. Assigned members may mark their assigned task complete; group owners can edit any group task.'});
  values.push(id);
  const taskIndex=values.length;
  let where;
  if(workspaceId !== null){
    values.push(workspaceId);const workspaceIndex=values.length;
    values.push(userId);const userIndex=values.length;
    where='id=$'+taskIndex+' AND workspace_id=$'+workspaceIndex+' AND EXISTS (SELECT 1 FROM orbit_workspace_members m WHERE m.workspace_id=$'+workspaceIndex+' AND m.user_id=$'+userIndex+')';
  } else {values.push(userId);where='id=$'+taskIndex+' AND user_id=$'+values.length+' AND workspace_id IS NULL';}
  if (workspaceId !== null) {
    where += onlyCompleting
      ? ' AND EXISTS (SELECT 1 FROM orbit_workspaces w WHERE w.id=orbit_tasks.workspace_id AND (w.owner_id=$'+(values.length)+' OR orbit_tasks.user_id=$'+(values.length)+' OR orbit_tasks.assigned_to_user_id=$'+(values.length)+'))'
      : ' AND EXISTS (SELECT 1 FROM orbit_workspaces w WHERE w.id=orbit_tasks.workspace_id AND (w.owner_id=$'+(values.length)+' OR orbit_tasks.user_id=$'+(values.length)+'))';
  }
  const { rows } = await db.query('UPDATE orbit_tasks SET '+allowed.join(',')+',updated_at=now() WHERE '+where+' RETURNING *',values);
  return rows[0] ? json(res,200,{task:rows[0]}) : json(res,404,{error:'Task not found.'});
}