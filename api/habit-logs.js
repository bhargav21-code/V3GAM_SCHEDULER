import { db } from 'hatchable';
import { requireSupabaseUser } from '../lib/supabase.js';
import { setApiSecurityHeaders, enforceWriteLimit } from '../lib/security.js';
export const access='public';
export const methods=['GET','POST'];
function validDate(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const [year,month,day]=value.split('-').map(Number);const parsed=new Date(Date.UTC(year,month-1,day));return parsed.getUTCFullYear()===year&&parsed.getUTCMonth()===month-1&&parsed.getUTCDate()===day;}
export default async function(req,res){
 setApiSecurityHeaders(req,res);
 const uid=await requireSupabaseUser(req,res);if(!uid)return;
 if(req.method==='POST'&&!await enforceWriteLimit(res,uid,'habit-logs-write',120))return;
 if(req.method==='GET'){const date=validDate(req.query?.date)?req.query.date:null;const {rows}=await db.query('SELECT habit_id,habit_date,completed,updated_at FROM orbit_habit_logs WHERE user_id=$1 AND ($2::date IS NULL OR habit_date=$2::date) ORDER BY habit_date',[uid,date]);return res.status(200).json({logs:rows});}
 const id=Number(req.body?.habit_id),date=req.body?.habit_date,completed=req.body?.completed!==false;if(!Number.isSafeInteger(id)||id<1||!validDate(date))return res.status(400).json({error:'Habit and date are required.'});const exists=await db.query('SELECT id FROM orbit_habits WHERE id=$1 AND user_id=$2 AND active=true',[id,uid]);if(!exists.rows.length)return res.status(404).json({error:'Habit not found.'});const {rows}=await db.query('INSERT INTO orbit_habit_logs(user_id,habit_id,habit_date,completed) VALUES($1,$2,$3::date,$4) ON CONFLICT(user_id,habit_id,habit_date) DO UPDATE SET completed=EXCLUDED.completed,updated_at=now() RETURNING *',[uid,id,date,completed]);return res.status(200).json({log:rows[0]});
}