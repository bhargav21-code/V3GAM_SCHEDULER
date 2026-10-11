import { db } from 'hatchable';
import { requireSupabaseUser } from '../lib/supabase.js';
export const access='public';
export const methods=['GET','POST','PATCH','DELETE'];
export default async function(req,res){
 const uid=await requireSupabaseUser(req,res);if(!uid)return;
 if(req.method==='GET'){const {rows}=await db.query('SELECT h.id,h.name,h.icon,h.active,h.created_at,COUNT(l.id) FILTER (WHERE l.completed)::int AS completed_days FROM orbit_habits h LEFT JOIN orbit_habit_logs l ON l.habit_id=h.id AND l.user_id=h.user_id WHERE h.user_id=$1 AND h.active=true GROUP BY h.id ORDER BY h.created_at',[uid]);return res.status(200).json({habits:rows});}
 const b=req.body||{};
 if(req.method==='POST'){const name=typeof b.name==='string'?b.name.trim().slice(0,80):'';if(!name)return res.status(400).json({error:'Habit name required.'});try{const {rows}=await db.query('INSERT INTO orbit_habits(user_id,name,icon) VALUES($1,$2,$3) RETURNING *',[uid,name,typeof b.icon==='string'?b.icon.slice(0,12):'✦']);return res.status(201).json({habit:rows[0]});}catch(e){if(String(e.message||'').includes('unique'))return res.status(409).json({error:'That habit already exists.'});throw e;}}
 const id=Number(req.query?.id??b.id);if(!Number.isSafeInteger(id)||id<1)return res.status(400).json({error:'Valid habit id required.'});
 if(req.method==='DELETE'){const {rows}=await db.query('UPDATE orbit_habits SET active=false,updated_at=now() WHERE id=$1 AND user_id=$2 RETURNING id',[id,uid]);return res.status(rows.length?200:404).json({ok:!!rows.length});}
 const sets=[],values=[];if(b.name!==undefined){const n=String(b.name).trim().slice(0,80);if(!n)return res.status(400).json({error:'Habit name required.'});values.push(n);sets.push('name=$'+values.length);}if(b.icon!==undefined){values.push(String(b.icon).slice(0,12));sets.push('icon=$'+values.length);}if(!sets.length)return res.status(400).json({error:'No fields to update.'});values.push(id,uid);const {rows}=await db.query('UPDATE orbit_habits SET '+sets.join(',')+',updated_at=now() WHERE id=$'+(values.length-1)+' AND user_id=$'+values.length+' AND active=true RETURNING *',values);return res.status(rows.length?200:404).json(rows.length?{habit:rows[0]}:{error:'Habit not found.'});
}