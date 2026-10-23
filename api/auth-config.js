import { getSupabaseConfig } from '../lib/supabase.js';
import { setApiSecurityHeaders } from '../lib/security.js';
export const access='public';
export const methods=['GET'];
export default async function(req,res){
 setApiSecurityHeaders(req,res);
 try{const {url,key}=await getSupabaseConfig();return res.status(200).json({url,key});}
 catch(e){return res.status(503).json({error:'Supabase setup is required. Add SUPABASE_URL and SUPABASE_ANON_KEY in Hatchable Setup.',setup_required:true});}
}