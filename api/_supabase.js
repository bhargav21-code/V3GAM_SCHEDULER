import { config } from 'hatchable';
export const access='public';
export const methods=['GET'];
export default async function(req,res){return res.status(404).json({error:'Not found'});}
export async function getSupabaseConfig(){
 const url=String(await config.get('SUPABASE_URL')||'').replace(/\/$/,'');
 const key=String(await config.get('SUPABASE_ANON_KEY')||'');
 if(!/^https:\/\/[a-z0-9.-]+$/.test(url)||!key)throw new Error('Supabase setup required');
 return {url,key};
}
export async function requireSupabaseUser(req,res){
 const token=String(req.headers?.authorization||'').match(/^Bearer\s+(.+)$/i)?.[1];
 if(!token){res.status(401).json({error:'Please sign in to continue.'});return null;}
 try{
  const {url,key}=await getSupabaseConfig();
  const r=await fetch(url+'/auth/v1/user',{headers:{apikey:key,Authorization:'Bearer '+token}});
  if(!r.ok){res.status(401).json({error:'Your session expired. Please sign in again.'});return null;}
  const u=await r.json();if(!u?.id){res.status(401).json({error:'Invalid session.'});return null;}
  return u.id;
 }catch(e){res.status(503).json({error:'Supabase setup is incomplete. Add SUPABASE_URL and SUPABASE_ANON_KEY in Hatchable Setup.',setup_required:true});return null;}
}