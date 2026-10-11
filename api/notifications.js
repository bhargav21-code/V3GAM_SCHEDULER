import { db } from 'hatchable';
export const access='user';
export const methods=['GET','POST','PATCH'];
export default async function(req,res){
 const uid=req.user.id;
 if(req.method==='GET'){const {rows}=await db.query('SELECT id,title,body,kind,read_at,created_at FROM orbit_notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100',[uid]);return res.status(200).json({notifications:rows,unread:rows.filter(n=>!n.read_at).length});}
 const b=req.body||{};
 if(req.method==='POST'){const title=typeof b.title==='string'?b.title.trim().slice(0,160):'';if(!title)return res.status(400).json({error:'Notification title required.'});const {rows}=await db.query('INSERT INTO orbit_notifications(user_id,title,body,kind) VALUES($1,$2,$3,$4) RETURNING *',[uid,title,typeof b.body==='string'?b.body.slice(0,800):'',typeof b.kind==='string'?b.kind.slice(0,30):'reminder']);return res.status(201).json({notification:rows[0]});}
 const id=Number(b.id);if(!Number.isSafeInteger(id)||id<1)return res.status(400).json({error:'Valid notification id required.'});const {rows}=await db.query('UPDATE orbit_notifications SET read_at=now() WHERE id=$1 AND user_id=$2 RETURNING *',[id,uid]);return res.status(rows.length?200:404).json(rows.length?{notification:rows[0]}:{error:'Notification not found.'});
}