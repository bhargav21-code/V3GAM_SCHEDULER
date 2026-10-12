import { db, ai } from 'hatchable';
import { requireSupabaseUser } from '../lib/supabase.js';

export const access = 'public';
export const methods = ['POST'];

function json(res,status,body){return res.status(status).json(body);}
async function memberOf(userId,workspaceId){
  const {rows}=await db.query('SELECT 1 FROM orbit_workspace_members WHERE workspace_id=$1 AND user_id=$2 LIMIT 1',[workspaceId,userId]);
  return rows.length>0;
}

export default async function(req,res){
  const uid=await requireSupabaseUser(req,res);if(!uid)return;
  const message=String(req.body?.message||'').trim().slice(0,1200);
  if(!message)return json(res,400,{error:'Message required.'});
  let workspaceId=null;
  if(req.body?.workspace_id!==undefined&&req.body?.workspace_id!==null&&req.body?.workspace_id!==''){
    workspaceId=Number(req.body.workspace_id);
    if(!Number.isSafeInteger(workspaceId)||workspaceId<1)return json(res,400,{error:'Invalid workspace.'});
    if(!await memberOf(uid,workspaceId))return json(res,403,{error:'You are not a member of this group workspace.'});
  }
  const taskQuery=workspaceId!==null
    ? "SELECT id,title,category,duration_minutes,starts_at,due_date,status FROM orbit_tasks WHERE workspace_id=$1 AND status IN ('planned','active') ORDER BY due_date NULLS LAST,starts_at NULLS LAST LIMIT 100"
    : "SELECT id,title,category,duration_minutes,starts_at,due_date,status FROM orbit_tasks WHERE user_id=$1 AND workspace_id IS NULL AND status IN ('planned','active') ORDER BY due_date NULLS LAST,starts_at NULLS LAST LIMIT 100";
  const {rows:tasks}=await db.query(taskQuery,[workspaceId!==null?workspaceId:uid]);
  let parsed;
  try{
    const r=await ai.generateText({model:'gemini',asUser:uid,maxTokens:800,prompt:'Return only JSON with reply, action, task, task_id, changes. action: add_task, complete_task, skip_task, snooze_task, plan_change, open_view, help. task fields: title, category, duration_minutes, due_date YYYY-MM-DD, start_time HH:MM, detail. Only use task_id from existing tasks. Multi-task changes must be proposed, never auto-applied. Today: '+new Date().toISOString().slice(0,10)+'. Timezone: '+String(req.body?.timezone||'Asia/Kolkata')+'. Current workspace: '+(workspaceId===null?'Personal':('Group workspace '+workspaceId))+'. Existing tasks: '+JSON.stringify(tasks)+'. User request: '+JSON.stringify(message)});
    parsed=JSON.parse(String(r.text||'').replace(/^\x60\x60\x60json\s*/i,'').replace(/\s*\x60\x60\x60$/,''));
  }catch(e){return json(res,503,{error:'AI provider is not configured or could not interpret the request. Configure AI in Hatchable Setup, or add a task manually.',setup_required:true});}
  const action=parsed.action;
  if(action==='add_task'){
    const t=parsed.task||{},title=String(t.title||'').trim().slice(0,180);
    if(!title)return json(res,200,{action:'clarify',reply:'What task would you like to add?'});
    const duration=Number(t.duration_minutes||60);
    if(!Number.isInteger(duration)||duration<5||duration>1440)return json(res,400,{error:'Invalid task duration.'});
    const dueDate=typeof t.due_date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(t.due_date)?t.due_date:new Date().toISOString().slice(0,10);
    let start=null;if(typeof t.start_time==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(t.start_time))start=dueDate+'T'+t.start_time+':00';
    const {rows}=await db.query('INSERT INTO orbit_tasks(user_id,workspace_id,title,category,duration_minutes,starts_at,due_date,detail,source) VALUES($1,$2,$3,$4,$5,$6::timestamptz,$7::date,$8,$9) RETURNING *',[uid,workspaceId,title,String(t.category||'study').slice(0,40),duration,start,dueDate,String(t.detail||'').slice(0,1000),'voice']);
    await db.query('INSERT INTO orbit_notifications(user_id,title,body,kind) VALUES($1,$2,$3,$4)',[uid,'Task added',title,'task']);
    return json(res,201,{action,task:rows[0],reply:String(parsed.reply||'Task added.').slice(0,500)});
  }
  if(['complete_task','skip_task','snooze_task'].includes(action)){
    const id=Number(parsed.task_id);if(!Number.isSafeInteger(id)||id<1)return json(res,200,{action:'clarify',reply:'Which task did you mean?'});
    if(action==='snooze_task'){
      const {rows}=workspaceId!==null
        ? await db.query("UPDATE orbit_tasks SET starts_at=COALESCE(starts_at,now())+interval '10 minutes',updated_at=now() WHERE id=$1 AND workspace_id=$2 RETURNING *",[id,workspaceId])
        : await db.query("UPDATE orbit_tasks SET starts_at=COALESCE(starts_at,now())+interval '10 minutes',updated_at=now() WHERE id=$1 AND user_id=$2 AND workspace_id IS NULL RETURNING *",[id,uid]);
      return rows[0]?json(res,200,{action,task:rows[0],reply:'Snoozed by 10 minutes.'}):json(res,404,{error:'Task not found.'});
    }
    const status=action==='complete_task'?'done':'skipped';
    const {rows}=workspaceId!==null
      ? await db.query('UPDATE orbit_tasks SET status=$1,updated_at=now() WHERE id=$2 AND workspace_id=$3 RETURNING *',[status,id,workspaceId])
      : await db.query('UPDATE orbit_tasks SET status=$1,updated_at=now() WHERE id=$2 AND user_id=$3 AND workspace_id IS NULL RETURNING *',[status,id,uid]);
    if(!rows[0])return json(res,404,{error:'Task not found.'});
    await db.query('INSERT INTO orbit_notifications(user_id,title,body,kind) VALUES($1,$2,$3,$4)',[uid,status==='done'?'Task completed':'Task skipped',rows[0].title,'task']);
    return json(res,200,{action,task:rows[0],reply:String(parsed.reply||'Task updated.').slice(0,500)});
  }
  if(action==='plan_change')return json(res,200,{action,reply:String(parsed.reply||'Review the proposed schedule before applying changes.').slice(0,700),changes:Array.isArray(parsed.changes)?parsed.changes.slice(0,50):[]});
  if(action==='open_view')return json(res,200,{action,view:String(parsed.view||'today'),reply:String(parsed.reply||'Opening that view.').slice(0,500)});
  return json(res,200,{action:'help',reply:String(parsed.reply||'I can add tasks, complete, skip or snooze tasks, and propose schedule changes.').slice(0,700)});
}