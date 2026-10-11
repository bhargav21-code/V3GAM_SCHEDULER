import { db } from 'hatchable';
export const access='user';
export const methods=['GET','POST'];
export default async function(req,res){
 const uid=req.user.id;
 if(req.method==='GET'){const date=typeof req.query?.date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(req.query.date)?req.query.date:null;const {rows}=await db.query('SELECT habit_id,habit_date,completed,updated_at FROM orbit_habit_logs WHERE user_id=$1 AND ($2::date IS NULL OR habit_date=$2::date) ORDER BY habit_date',[uid,date]);return res.status(200).json({logs:rows});}
 const id=Number(req.body?.habit_id),date=req.body?.habit_date,completed=req.body?.completed!==false;if(!Number.isSafeInteger(id)||id<1||typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date))return res.status(400).json({error:'Habit and date are required.'});const exists=await db.query('SELECT id FROM orbit_habits WHERE id=$1 AND user_id=$2 AND active=true',[id,uid]);if(!exists.rows.length)return res.status(404).json({error:'Habit not found.'});const {rows}=await db.query('INSERT INTO orbit_habit_logs(user_id,habit_id,habit_date,completed) VALUES($1,$2,$3::date,$4) ON CONFLICT(user_id,habit_id,habit_date) DO UPDATE SET completed=EXCLUDED.completed,updated_at=now() RETURNING *',[uid,id,date,completed]);return res.status(200).json({log:rows[0]});
}