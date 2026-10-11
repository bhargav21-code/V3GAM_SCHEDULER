import { config } from 'hatchable';
export const access='public';
export const methods=['GET'];
export default async function(req,res){
 const header=String(req.headers?.authorization||'');
 const token=header.match(/^Bearer\s+(.+)$/i)?.[1];
 if(!token)return res.status(401).json({error:'Sign in required.'});
 try{
  const url=await config.get('SUPABASE_URL'),key=await config.get('SUPABASE_ANON_KEY');
  const r=await fetch(url.replace(/\/$/,'')+'/auth/v1/user',{headers:{apikey:key,Authorization:'Bearer '+token}});
  if(!r.ok)return res.status(401).json({error:'Session expired. Please sign in again.'});
  const user=await r.json();return res.status(200).json({user:{id:user.id,email:user.email}});
 }catch(e){return res.status(503).json({error:'Supabase is not configured yet.',setup_required:true});}
}