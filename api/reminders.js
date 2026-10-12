import { db } from 'hatchable';
import { requireSupabaseUser } from '../lib/supabase.js';

export const access = 'public';
export const methods = ['GET'];

function json(res,status,body){return res.status(status).json(body);}

export default async function(req,res){
  const userId=await requireSupabaseUser(req,res);
  if(!userId)return;
  if(req.method!=='GET')return json(res,405,{error:'Method not allowed.'});
  const {rows}=await db.query(
    "SELECT t.id,t.title,t.due_date,t.starts_at,t.status,t.workspace_id, COALESCE(w.name,'Personal workspace') AS workspace_name FROM orbit_tasks t LEFT JOIN orbit_workspaces w ON w.id=t.workspace_id WHERE t.status IN ('planned','active') AND ((t.workspace_id IS NULL AND t.user_id=$1) OR (t.workspace_id IS NOT NULL AND EXISTS (SELECT 1 FROM orbit_workspace_members m WHERE m.workspace_id=t.workspace_id AND m.user_id=$1))) AND ((t.starts_at IS NOT NULL AND t.starts_at >= now() - interval '5 minutes') OR (t.starts_at IS NULL AND COALESCE(t.due_date,CURRENT_DATE) >= CURRENT_DATE)) ORDER BY t.starts_at NULLS LAST,t.due_date ASC LIMIT 1000",
    [userId]
  );
  return json(res,200,{tasks:rows});
}