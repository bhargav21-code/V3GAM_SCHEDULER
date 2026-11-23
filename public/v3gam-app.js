(function(){
const $=s=>document.querySelector(s), $$=s=>Array.from(document.querySelectorAll(s));
const state={theme:'light',screen:'home',focused:null,pending:null,recording:false,preview:false,rec:null,tm:null,id:20};
const names={study:'Study',lecture:'Lecture',meal:'Meal',gym:'Wellness',lab:'Project / lab',personal:'Personal / Other'};
const icons={study:'✦',lecture:'▤',meal:'◓',gym:'↗',lab:'⌘',personal:'🏠'};
const classes={study:'study',lecture:'lecture',meal:'meal',gym:'gym',lab:'lab',personal:'meal'};
const demoTasks=[
{id:1,title:'Breakfast & reset',category:'meal',start:'08:00',duration:30,status:'done',day:0,detail:'Ease into the morning. No rushing.'},
{id:2,title:'Data Structures lecture',category:'lecture',start:'09:00',duration:60,status:'done',day:0,detail:'Lecture notes and key examples.'},
{id:3,title:'ADA problem set',category:'study',start:'10:30',duration:90,status:'active',day:0,detail:'Quiet time, one problem at a time. You have got this.'},
{id:4,title:'Lunch break',category:'meal',start:'12:15',duration:45,status:'planned',day:0,detail:'Step away from your desk and recharge.'},
{id:5,title:'Lab report — results',category:'lab',start:'13:30',duration:120,status:'planned',day:0,detail:'Clean up graphs, write the results section.'},
{id:6,title:'Gym session',category:'gym',start:'16:00',duration:60,status:'planned',day:0,detail:'Strength and mobility. Keep it consistent.'},
{id:7,title:'Dinner',category:'meal',start:'18:00',duration:45,status:'planned',day:0,detail:'Take a real break before the evening.'},
{id:8,title:'Revision sprint',category:'study',start:'19:00',duration:60,status:'planned',day:0,detail:'Review today’s notes and make 5 flashcards.'},
{id:9,title:'Lab report buffer',category:'lab',start:'20:15',duration:30,status:'planned',day:0,detail:'Small finishing touches only, no pressure.'}
];
let tasks=[];
let orbitBootstrapInFlight=false, pendingBackendProposal=null, orbitDemoMode=false, orbitRealTaskSnapshot=[], orbitWorkspaces=[], orbitWorkspaceId=null, orbitSessionActive=false, orbitUserId='', orbitUserEmail='', orbitDisplayName='';
let orbitReminderInterval=null,orbitReminderPollBusy=false,orbitNotificationCache=[],orbitNotificationFilter='all';
let orbitElevenLabsEnabled=false, orbitVoiceTtsEnabled=true, orbitVoiceLang='en-IN';
function orbitUpdateElevenLabsAvailability(){const widget=$('#orbitElevenLabsWidget');if(widget)widget.style.display=(orbitSessionActive&&!orbitDemoMode&&orbitElevenLabsEnabled)?'block':'none';}
function orbitRenderNotificationRows(){
 const host=$('#notificationsList');if(!host)return;host.innerHTML='';let visible=0;
 const filtered=orbitNotificationCache.filter(n=>orbitNotificationFilter==='all'||(orbitNotificationFilter==='tasks'?n.kind==='task_reminder':n.kind!=='task_reminder'));
 if(!filtered.length){host.innerHTML='<div class="workspace-page-empty"><b>'+ (orbitNotificationCache.length?'No notifications in this filter':'You are all caught up') +'</b>'+ (orbitNotificationCache.length?'Try another category to see more updates.':'V3GAM will show five-minute task reminders here.') +'</div>';return}
 filtered.forEach(n=>{
  visible++;
  const row=document.createElement('article');row.className='notification-row'+(!n.read_at?' unread':'');
  row.dataset.notificationKind=n.kind==='task_reminder'?'tasks':'system';
  const icon=document.createElement('div');icon.className='notification-row-icon '+(n.kind==='task_reminder'?'notification-task-icon':'notification-system-icon');icon.textContent=n.kind==='task_reminder'?'◷':'✦';
  const copy=document.createElement('div');copy.className='notification-row-copy';
  const title=document.createElement('b');title.textContent=n.title||'V3GAM notification';
  const body=document.createElement('p');body.textContent=n.body||'';
  const when=document.createElement('small');const d=new Date(n.created_at);when.textContent=Number.isNaN(d.getTime())?'':d.toLocaleString();
  copy.append(title,body,when);row.append(icon,copy);
  if(!n.read_at){const read=document.createElement('button');read.type='button';read.textContent='Mark read';read.addEventListener('click',async()=>{read.disabled=true;try{const rr=await orbitAuthorizedFetch('/api/notifications',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:n.id})});const out=await rr.json();if(!rr.ok)throw new Error(out.error||'Could not mark notification read');await orbitLoadNotifications()}catch(err){read.disabled=false;toast(err.message)}});row.appendChild(read)}
  host.appendChild(row);
 });
}
$$('[data-notification-filter]').forEach(button=>button.addEventListener('click',()=>{
 orbitNotificationFilter=button.dataset.notificationFilter||'all';
 $$('[data-notification-filter]').forEach(tab=>{const active=tab===button;tab.classList.toggle('active',active);tab.setAttribute('aria-selected',String(active))});
 orbitRenderNotificationRows();
}));
async function orbitLoadNotifications(){
 const host=$('#notificationsList');if(!host)return;
 if(!orbitSessionActive){host.innerHTML='<div class="workspace-page-empty"><b>Sign in to view reminders</b>Your in-app task notifications will appear here.</div>';$('#notificationUnread').hidden=true;return}
 host.innerHTML='<div class="workspace-page-empty">Loading notifications…</div>';
 try{
  const response=await orbitAuthorizedFetch('/api/notifications');const data=await response.json();if(!response.ok)throw new Error(data.error||'Could not load notifications');
  orbitNotificationCache=Array.isArray(data.notifications)?data.notifications:[];
  if('Notification' in window&&Notification.permission==='granted')$('#enableBrowserNotifications').textContent='✓ Browser alerts enabled';
  const unread=orbitNotificationCache.filter(n=>!n.read_at).length,badge=$('#notificationUnread');
  badge.textContent=unread>99?'99+':String(unread);badge.hidden=unread===0;
  orbitRenderNotificationRows();
 }catch(err){host.innerHTML='<div class="workspace-page-empty"><b>Could not load notifications</b>'+esc(err.message||'Please try again.')+'</div>';if(orbitBootstrapInFlight)throw err;}
}
function orbitOpenNotifications(){ $('#notificationsDialog').classList.add('open');$('#notificationsDialog').setAttribute('aria-hidden','false');orbitLoadNotifications(); }
function orbitCloseNotifications(){ $('#notificationsDialog').classList.remove('open');$('#notificationsDialog').setAttribute('aria-hidden','true'); }
async function orbitEnableBrowserNotifications(){
 if(!('Notification' in window)){toast('This browser does not support browser notifications. In-app reminders still work while V3GAM is open.');return}
 try{const permission=await Notification.requestPermission();$('#enableBrowserNotifications').textContent=permission==='granted'?'✓ Browser alerts enabled':permission==='denied'?'Browser alerts blocked':'Enable browser alerts';$('#workspaceDialogMessage').textContent='';toast(permission==='granted'?'Browser task alerts enabled':permission==='denied'?'Browser alerts are blocked in browser settings':'Browser alert permission was not granted')}
 catch(e){toast('Could not enable browser alerts: '+e.message)}
}
async function orbitCheckUpcomingReminders(){
 if(!orbitSessionActive||orbitDemoMode||!orbitUserId||orbitReminderPollBusy)return;
 orbitReminderPollBusy=true;
 try{
  const response=await orbitAuthorizedFetch('/api/reminders');const data=await response.json();if(!response.ok)throw new Error(data.error||'Could not check upcoming tasks');
  const now=Date.now();
  for(const task of (data.tasks||[])){
   if(!task.starts_at||!['planned','active'].includes(task.status))continue;
   const start=new Date(task.starts_at).getTime();if(!Number.isFinite(start))continue;
   const until=start-now;if(until<=0||until>5*60*1000)continue;
   const reminderKey='orbit-reminder-sent:'+encodeURIComponent(orbitUserId)+':'+task.id+':'+start;
   try{if(localStorage.getItem(reminderKey))continue}catch(e){}
   const minsLeft=Math.max(1,Math.ceil(until/60000));
   const title='Task in '+minsLeft+' minute'+(minsLeft===1?'':'s');
   const body='“'+task.title+'” starts at '+new Date(start).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})+'. '+(task.workspace_name&&task.workspace_name!=='Personal workspace'?'Workspace: '+task.workspace_name+'. ':'')+'Take a moment to get ready.';
   const saved=await orbitAuthorizedFetch('/api/notifications',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title,body,kind:'task_reminder'})});
   const savedData=await saved.json();if(!saved.ok)throw new Error(savedData.error||'Could not save reminder');
   try{localStorage.setItem(reminderKey,'1')}catch(e){}
   if(document.hidden&&'Notification' in window&&Notification.permission==='granted'){try{new Notification('V3GAM · '+title,{body,tag:'orbit-task-'+task.id})}catch(e){toast(title+': '+task.title)}}
   else toast(title+': '+task.title);
   orbitLoadNotifications();
  }
 }catch(e){if(!String(e.message||'').toLowerCase().includes('sign in'))console.warn('V3GAM reminder check failed:',e.message)}
 finally{orbitReminderPollBusy=false}
}
function orbitStartReminderPolling(){
 if(orbitReminderInterval)clearInterval(orbitReminderInterval);
 if(orbitSessionActive&&!orbitDemoMode){orbitReminderInterval=setInterval(orbitCheckUpcomingReminders,20000);orbitCheckUpcomingReminders()}
}
$('#openNotifications').addEventListener('click',orbitOpenNotifications);
$('#closeNotifications').onclick=e=>{e.preventDefault();e.stopPropagation();orbitCloseNotifications()};
$('#closeNotifications').addEventListener('pointerup',e=>{e.preventDefault();e.stopPropagation();orbitCloseNotifications()},{passive:false});
$('#notificationsDialog').addEventListener('click',e=>{if(e.target===$('#notificationsDialog'))orbitCloseNotifications()});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&$('#notificationsDialog').classList.contains('open'))orbitCloseNotifications()});
$('#refreshNotifications').addEventListener('click',orbitLoadNotifications);
$('#enableBrowserNotifications').addEventListener('click',orbitEnableBrowserNotifications);
function orbitUpdateGreeting(user){
 const meta=user?.user_metadata||{};
 const username=String(meta.username||'').trim();
 const raw=String(username||meta.display_name||meta.full_name||meta.name||user?.email?.split('@')[0]||'there').trim();
 const cleaned=username?username:raw.replace(/[._-]+/g,' ').trim();
 const name=username||cleaned.split(' ').filter(Boolean).slice(0,2).map(s=>s.charAt(0).toUpperCase()+s.slice(1)).join(' ')||'there';
 orbitDisplayName=name;
 $('#greetingText').textContent='Hey, '+name+'!';
 const lines=['Small steps today can turn into big wins tomorrow.','You do not need a perfect day — just your next small step.','Your future self will thank you for starting today.','One task at a time. You are building momentum.','Progress beats perfection. Keep going at your own pace.'];
 const day=Math.floor(new Date().setHours(0,0,0,0)/86400000);
 $('#greetingMotivation').textContent=lines[Math.abs(day)%lines.length];
 const initials=name.split(' ').map(part=>part.charAt(0)).join('').slice(0,2).toUpperCase();
 const profileLabel=$('#orbitProfileLabel'),profileAvatar=$('#orbitProfileAvatar');
 if(profileLabel)profileLabel.textContent=name;
 if(profileAvatar)profileAvatar.textContent=initials||'O';
}
function refreshTaskViews(){renderTimeline();renderWeek();renderMonth();renderHabitMatrix();renderBars();renderDashboard()}
const defaultHabits=[
{id:'wake',name:'Wake up at 6:00',icon:'☀'},
{id:'gym',name:'Gym / movement',icon:'🏃'},
{id:'read',name:'Reading / learning',icon:'📚'},
{id:'plan',name:'Day planning',icon:'✎'},
{id:'budget',name:'Budget tracking',icon:'◈'},
{id:'project',name:'Project work',icon:'⌘'},
{id:'alcohol',name:'No alcohol',icon:'◉'},
{id:'social',name:'Social media detox',icon:'◌'},
{id:'journal',name:'Goal journaling',icon:'✧'},
{id:'cold',name:'Cold shower',icon:'❄'}
];
let habits=defaultHabits.map(h=>({...h}));
let habitChecks=Object.create(null);
function orbitHabitScopeKey(userId=orbitUserId,workspaceId=orbitWorkspaceId){return encodeURIComponent((userId||'anonymous')+'|'+(workspaceId===null?'personal':'group:'+workspaceId))}
function orbitWorkspaceStorageKey(){return 'orbit-active-workspace:'+encodeURIComponent(orbitUserId||'anonymous')}
function orbitHabitKeys(){const suffix=orbitHabitScopeKey();return {habits:'orbit-custom-habits:'+suffix,checks:'orbit-habit-checks:'+suffix}}
function orbitSaveHabitScope(){try{const k=orbitHabitKeys();localStorage.setItem(k.habits,JSON.stringify(habits));localStorage.setItem(k.checks,JSON.stringify(habitChecks))}catch(e){}}
function orbitLoadHabitScope(){const k=orbitHabitKeys();try{const saved=JSON.parse(localStorage.getItem(k.habits)||'null');habits=Array.isArray(saved)?saved.filter(h=>h&&h.id&&h.name).map(h=>({id:String(h.id),name:String(h.name),icon:String(h.icon||'✦')})):defaultHabits.map(h=>({...h}))}catch(e){habits=defaultHabits.map(h=>({...h}))}habitChecks=Object.create(null);try{const savedChecks=JSON.parse(localStorage.getItem(k.checks)||'{}');Object.keys(savedChecks).forEach(key=>{habitChecks[key]=!!savedChecks[key]})}catch(e){}}
let selectedPlanDate;
function dateKey(d){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')}
function dayOffset(d){return Math.round((new Date(d.getFullYear(),d.getMonth(),d.getDate())-new Date(date.getFullYear(),date.getMonth(),date.getDate()))/86400000)}
function defaultHabitDone(d,h){return false}
function isHabitDone(d,h){const k=dateKey(d)+'|'+habits[h].id;return Object.prototype.hasOwnProperty.call(habitChecks,k)?habitChecks[k]:defaultHabitDone(d,h)}
function setHabitDone(d,h,value){habitChecks[dateKey(d)+'|'+habits[h].id]=value;orbitSaveHabitScope()}
function saveHabits(){orbitSaveHabitScope()}
function renderHabitManager(){const list=$('#habitManagerList');if(!list)return;$('#habitManagerCount').textContent=habits.length+' habit'+(habits.length===1?'':'s');list.innerHTML='';if(!habits.length){list.innerHTML='<div class="selected-day-empty"><b>No habits yet</b>Add one above to start your personal routine.</div>';return}habits.forEach((h,i)=>{const row=document.createElement('div');row.className='habit-manager-row';row.innerHTML='<span class="habit-manager-icon">'+esc(h.icon)+'</span><span class="habit-manager-info"><strong>'+esc(h.name)+'</strong><small>Included in your daily and weekly progress</small></span><span class="habit-manager-actions"><button type="button" data-edit-habit="'+esc(h.id)+'" aria-label="Rename '+esc(h.name)+'" title="Rename habit">✎</button><button type="button" class="remove-habit" data-remove-habit="'+esc(h.id)+'" aria-label="Remove '+esc(h.name)+'" title="Remove habit">×</button></span>';list.appendChild(row)})}
function refreshHabitViews(){renderHabitManager();renderHabitMatrix();renderWeek();renderMonth()}
function tasksForDate(d){const offset=dayOffset(d);return tasks.filter(t=>t.day===offset&&t.status!=='skipped').slice().sort((a,b)=>mins(a.start)-mins(b.start))}
function mins(s){const a=s.split(':').map(Number);return a[0]*60+a[1]}
function clock(s){let a=s.split(':').map(Number),h=a[0]%12||12;return h+':'+String(a[1]).padStart(2,'0')+' '+(a[0]>=12?'PM':'AM')}
function esc(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function toast(s){const n=$('#toast');clearTimeout(state.toast);n.classList.remove('completion-toast');n.textContent=s;n.classList.add('show');state.toast=setTimeout(()=>n.classList.remove('show'),2300)}
function go(screen){state.screen=screen;$$('.screen').forEach(x=>x.classList.toggle('active',x.id==='screen-'+screen));$$('.nav button').forEach(x=>x.classList.toggle('active',x.dataset.screen===screen));$('#scroll').scrollTop=0;if(screen==='workspace')orbitRenderWorkspaceDirectory()}
$$('.nav button[data-screen]').forEach(b=>b.addEventListener('click',()=>{if(b.dataset.screen==='add')state.pendingDayOffset=0;go(b.dataset.screen)}));
const date=new Date(), days=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
selectedPlanDate=new Date(date.getFullYear(),date.getMonth(),date.getDate());
$('#todayLabel').textContent=days[date.getDay()].toUpperCase()+' · '+date.toLocaleDateString('en-US',{month:'short',day:'numeric'}).toUpperCase();
$('#themeToggle').addEventListener('click',()=>{state.theme=state.theme==='dark'?'light':'dark';$('#app').classList.toggle('light',state.theme==='light');$('#themeToggle').textContent=state.theme==='light'?'☾':'☼';$('#themeToggle').setAttribute('aria-label',state.theme==='light'?'Switch to dark theme':'Switch to light theme');toast(state.theme==='light'?'Light theme enabled':'Dark theme enabled')});
function fitLaptopPreview(){const scale=Math.min(1,Math.max(.5,(window.innerHeight-48)/844));document.documentElement.style.setProperty('--preview-scale',String(scale))}window.addEventListener('resize',fitLaptopPreview);fitLaptopPreview();
function getWorkspaceTaskSnapshot(){
 const mapTask=t=>({id:t.id,title:t.title,when:t.start?clock(t.start):"",start:t.start||"09:00",duration:Number(t.duration)||60,category:['study','lab','lecture','gym','meal','personal'].includes(String(t.category||'').toLowerCase())?String(t.category).toLowerCase():'personal',day:Number(t.day)||0,status:t.status||"planned",detail:t.detail||""});
 const allActive=tasks.filter(t=>t&&t.title&&t.status!=="skipped");
 const todayRaw=allActive.filter(t=>Number(t.day)===0).slice().sort((a,b)=>mins(a.start||"09:00")-mins(b.start||"09:00"));
 const todayAll=todayRaw.map(mapTask);
 const todayDone=todayAll.filter(t=>t.status==="done");
 const todayRemaining=todayAll.filter(t=>t.status!=="done");
 const tomorrowAll=allActive.filter(t=>Number(t.day)===1).slice().sort((a,b)=>mins(a.start||"09:00")-mins(b.start||"09:00")).map(mapTask);
 const allDone=allActive.filter(t=>t.status==="done");
 const totalMinutesToday=todayAll.reduce((n,t)=>n+t.duration,0);
 return {
  allActive:allActive.map(mapTask),
  todayRaw,
  todayAll,
  todayDone,
  todayRemaining,
  tomorrowAll,
  totalCount:allActive.length,
  totalDoneCount:allDone.length,
  todayCount:todayAll.length,
  todayDoneCount:todayDone.length,
  todayRemainingCount:todayRemaining.length,
  tomorrowCount:tomorrowAll.length,
  totalMinutesToday
 };
}
function renderTimeline(){
const el=$("#timeline");el.innerHTML="";const snap=getWorkspaceTaskSnapshot(),today=snap.todayRaw;
if(!today.length){el.innerHTML='<div class="insight"><b>Nothing scheduled yet</b><p>Your day is clear. Add your first task, or open Demo to explore how V3GAM works.</p></div>';$('#completedCount').textContent='0';$('#tasksLeft').textContent='0 / 0';$('#tasksSub').textContent='A fresh start';$('#taskProgress').style.width='0%';$('#focusSummary').textContent='0h 0m';$('#focusProgress').style.width='0%';renderDashboard();return}
let now=false;
today.forEach(t=>{
if(!now&&mins(t.start)>=600){const r=document.createElement('div');r.className='now';r.innerHTML='<i class="dot"></i> A good time for deep work';el.appendChild(r);now=true}
const row=document.createElement('div');row.className='time-row';const dur=t.duration>=60?(t.duration%60?Math.floor(t.duration/60)+'.5h':t.duration/60+'h'):t.duration+'m';
row.innerHTML='<div class="time-label">'+clock(t.start)+'</div><div class="time-content"><div class="task '+(classes[t.category]||classes.personal)+(t.status==='done'?' completed':'')+'"><button type="button" class="task-check '+(t.status==='done'?'checked':'')+'" data-toggle-task="'+t.id+'" aria-label="'+(t.status==='done'?'Mark incomplete':'Mark done')+'" aria-pressed="'+(t.status==='done')+'">'+(t.status==='done'?'✓':'')+'</button><button type="button" class="task-open" data-task="'+t.id+'"><i class="mark"></i><div class="taskmain"><div class="tasktitle">'+esc(t.title)+'</div><div class="taskmeta">'+esc(names[t.category]||names.personal)+' · '+(t.status==='done'?'Completed':t.status==='active'?'In progress':'Smart scheduled')+'</div></div><span class="duration">'+dur+'</span></button></div></div>';el.appendChild(row)
});
if(!now){const n=document.createElement('div');n.className='now';n.innerHTML='<i class="dot"></i> Keep your momentum';el.appendChild(n)}
const done=snap.todayDoneCount,left=snap.todayRemainingCount,total=snap.totalMinutesToday;
$('#completedCount').textContent=done;$('#tasksLeft').textContent=left+' / '+today.length;$('#tasksSub').textContent=left<=2?'Almost there':'You’re on track';$('#taskProgress').style.width=(done/today.length*100)+'%';
$('#focusSummary').textContent=Math.floor(total/60)+'h '+total%60+'m';$('#focusProgress').style.width=(done/today.length*100)+'%';
renderDashboard();
}
async function orbitToggleTaskDone(id){
 const task=tasks.find(t=>Number(t.id)===Number(id));if(!task)return;
 const oldStatus=task.status,nextStatus=oldStatus==='done'?'planned':'done';
 task.status=nextStatus;
 try{
  if(!orbitDemoMode&&orbitSessionActive&&task.serverId){
   const wid=task.workspaceId??null;
   const url='/api/tasks?id='+encodeURIComponent(task.serverId)+(wid!==null?'&workspace_id='+encodeURIComponent(wid):'');
   const r=await orbitAuthorizedFetch(url,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:nextStatus,...(wid!==null?{workspace_id:wid}:{})})});
   const data=await r.json();if(!r.ok)throw new Error(data.error||'Could not save task status');
  }
  renderTimeline();renderWeek();renderMonth();renderHabitMatrix();renderDashboard();
  if(orbitWorkspaceId!==null)orbitRenderGroupBoard();
  if(nextStatus==='done'){celebrateTask(Number(task.id));toast('Task completed — nice work! ✦')}else toast('Task marked as not done');
 }catch(err){task.status=oldStatus;renderTimeline();renderDashboard();toast('Could not save task status: '+err.message)}
}
$('#timeline').addEventListener('click',e=>{const check=e.target.closest('[data-toggle-task]');if(check){e.preventDefault();e.stopPropagation();orbitToggleTaskDone(check.dataset.toggleTask);return}const b=e.target.closest('.task-open[data-task]');if(b)openFocus(Number(b.dataset.task))});
// Move the existing live checklist into the redesigned dashboard card; keep its element, IDs and event listeners intact.
$('#dashboardTimelineMount').appendChild($('#timeline'));$('#timeline').classList.add('dashboard-home-timeline');
function openFocus(id){const t=tasks.find(x=>x.id===id);if(!t)return;state.focused=id;$('#focusIcon').textContent=icons[t.category]||'✦';$('#focusCategory').textContent=esc(names[t.category]||names.personal).toUpperCase()+' · '+t.duration+' MIN';$('#focusTitle').textContent=t.title;$('#focusMeta').textContent=t.detail||'One thing at a time. You have got this.';$('#focusIndex').textContent='TASK '+String(id).padStart(2,'0');state.focusEnd=Date.now()+t.duration*60000;clearInterval(state.focusTicker);function tickFocus(){const left=Math.max(0,state.focusEnd-Date.now());const sec=Math.floor(left/1000);$('#countdown').textContent=String(Math.floor(sec/3600)).padStart(2,'0')+':'+String(Math.floor(sec%3600/60)).padStart(2,'0')+':'+String(sec%60).padStart(2,'0');$('#focusTimerProgress').style.width=(t.status==='done'?100:Math.max(0,Math.min(100,(1-left/(t.duration*60000))*100)))+'%';if(left===0)clearInterval(state.focusTicker)}tickFocus();state.focusTicker=setInterval(tickFocus,1000);$('#focusOverlay').classList.add('open');$('#focusOverlay').setAttribute('aria-hidden','false')}
function close(id){$( '#'+id).classList.remove('open');$('#'+id).setAttribute('aria-hidden','true')}
$('#closeFocus').addEventListener('click',()=>close('focusOverlay'));$('#focusMore').addEventListener('click',()=>toast('Task options · coming next'));
function celebrateTask(id){const target=$('[data-task="'+id+'"]');if(!target)return;target.classList.add('rewarded');const appRect=$('#app').getBoundingClientRect(),r=target.getBoundingClientRect();['✦','✧','＋','✦','•','✧'].forEach((glyph,i)=>{const p=document.createElement('span');p.className='reward-spark';p.textContent=glyph;p.style.left=(r.left+r.width*(.25+.1*i)-appRect.left)+'px';p.style.top=(r.top+r.height*.45-appRect.top)+'px';p.style.setProperty('--dx',((i-2.5)*11)+'px');p.style.setProperty('--rot',((i-2.5)*18)+'deg');$('#app').appendChild(p);setTimeout(()=>p.remove(),900)})}
function completionToast(task){const n=$('#toast');clearTimeout(state.toast);n.classList.add('completion-toast','show');const today=tasks.filter(x=>x.day===0&&x.status!=='skipped').sort((a,b)=>mins(a.start)-mins(b.start));const done=today.filter(x=>x.status==='done').length,total=today.length,percent=Math.round(done/Math.max(total,1)*100);const next=today.find(x=>x.status!=='done'&&mins(x.start)>mins(task.start))||today.find(x=>x.status!=='done');n.innerHTML='<div class="completion-title"><span class="completion-check">✓</span><span>Nice work — task complete</span></div><div class="completion-copy">'+done+' of '+total+' tasks complete · '+percent+'% of today’s plan finished.</div><div class="completion-track" role="progressbar" aria-label="Today’s task progress" aria-valuemin="0" aria-valuemax="'+total+'" aria-valuenow="'+done+'"><span style="width:'+percent+'%"></span></div>'+(next?'<div class="completion-next-row"><div class="completion-next-text">COMING UP<strong>'+esc(next.title)+'</strong><span>'+clock(next.start)+'</span></div><button class="completion-next" type="button" data-task-id="'+next.id+'">Start next →</button></div>':'<div class="completion-copy" style="margin-bottom:0">Your plan is clear. Take a breath — you earned it.</div>');const b=n.querySelector('.completion-next');if(b)b.addEventListener('click',()=>{clearTimeout(state.toast);n.classList.remove('show','completion-toast');openFocus(Number(b.dataset.taskId))});state.toast=setTimeout(()=>{n.classList.remove('show','completion-toast')},6500)}
function actionTask(action){const t=tasks.find(x=>x.id===state.focused);if(!t)return;let msg='';if(action==='done'){t.status='done';msg='Task complete. Nice work ✦'}else if(action==='snooze'){let m=(mins(t.start)+10)%1440;t.start=String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0');t.status='planned';msg='Snoozed for 10 minutes'}else{t.status='skipped';msg='Skipped. Your plan stays flexible'}if(t.serverId&&window.orbitSupabase&&action!=='snooze')orbitAuthorizedFetch('/api/tasks?id='+encodeURIComponent(t.serverId)+(orbitWorkspaceId!==null?'&workspace_id='+encodeURIComponent(orbitWorkspaceId):''),{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:t.status})}).then(async r=>{if(!r.ok){const d=await r.json();throw new Error(d.error||'Could not save task status')}}).catch(e=>toast('Task status was not synced: '+e.message));close('focusOverlay');renderTimeline();renderWeek();renderMonth();if(action==='done'){celebrateTask(t.id);completionToast(t)}else{toast(msg)}}
$('#focusDone').addEventListener('click',()=>actionTask('done'));$('#focusSnooze').addEventListener('click',()=>actionTask('snooze'));$('#focusSkip').addEventListener('click',()=>actionTask('skip'));
$('#addTaskBtn').addEventListener('click',()=>{state.pendingDayOffset=0;go('add');$('#taskName').focus()});$('#backHomeBtn').addEventListener('click',()=>{state.pendingDayOffset=0;go('home')});
function taskSlot(pref,offset=0){if(pref==='manual')return $('#taskManualTime').value;if(pref==='morning')return '11:00';if(pref==='afternoon')return '14:30';if(pref==='evening')return '17:30';const occupied=tasks.filter(t=>t.day===offset).map(t=>mins(t.start));for(const s of ['11:00','14:30','15:00','17:30'])if(!occupied.some(m=>Math.abs(m-mins(s))<50))return s;return '15:00'}
$('#taskWhen').addEventListener('change',()=>{const manual=$('#taskWhen').value==='manual';$('#manualTimeField').style.display=manual?'block':'none';$('#taskManualTime').required=manual;if(manual)$('#taskManualTime').focus();orbitSyncWhenChoice()});
function orbitSyncWhenChoice(){
 const value=$('#taskWhen').value;
 $$('[data-when-pick]').forEach(button=>{const active=button.dataset.whenPick===value;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active))});
 $('#taskWhenPreset').value=['morning','afternoon','evening'].includes(value)?value:'';
}
$$('[data-when-pick]').forEach(button=>button.addEventListener('click',()=>{$('#taskWhen').value=button.dataset.whenPick;$('#taskWhen').dispatchEvent(new Event('change',{bubbles:true}));}));
$('#taskWhenPreset').addEventListener('change',()=>{if($('#taskWhenPreset').value){$('#taskWhen').value=$('#taskWhenPreset').value;$('#taskWhen').dispatchEvent(new Event('change',{bubbles:true}));}else{$('#taskWhen').value='flexible';$('#taskWhen').dispatchEvent(new Event('change',{bubbles:true}));}});
orbitSyncWhenChoice();
function showParsed(){const title=$('#taskName').value.trim();if(!title){$('#taskName').focus();return}const pref=$('#taskWhen').value;if(pref==='manual'&&!$('#taskManualTime').value){$('#taskManualTime').focus();toast('Choose the time for this task first.');return}const task={title,category:$('#taskCategory').value,duration:Number($('#taskDuration').value),pref,slot:taskSlot(pref,state.pendingDayOffset||0),detail:$('#taskNote').value.trim()};state.pending=task;$('#parsedTitle').textContent=title;$('#parsedText').textContent=task.duration+' minutes · '+esc(names[task.category]||names.personal)+' · '+(pref==='manual'?'Your chosen time: ': 'Suggested for ')+clock(task.slot)+'. '+(pref==='manual'?'This task will be saved at your selected time.':pref==='flexible'?'Placed in a flexible gap.':'Matched your preferred time.');$('#parsedCard').classList.add('show');$('#parsedCard').scrollIntoView({behavior:'smooth',block:'nearest'})}
$('#taskForm').addEventListener('submit',e=>{e.preventDefault();showParsed()});
$('#confirmTaskBtn').addEventListener('click',async()=>{if(!state.pending)return;const p=state.pending,targetOffset=state.pendingDayOffset||0,localTask={id:++state.id,title:p.title,category:p.category,duration:p.duration,start:p.slot,status:'planned',day:targetOffset,detail:p.detail};try{if(!orbitDemoMode){const {data:{session}}=await window.orbitSupabase.auth.getSession();if(session&&session.user){const date=new Date();date.setDate(date.getDate()+targetOffset);const due_date=date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0')+'-'+String(date.getDate()).padStart(2,'0');const response=await orbitAuthorizedFetch('/api/tasks',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:p.title,category:p.category,duration_minutes:p.duration,due_date,starts_at:new Date(due_date+'T'+p.slot+':00').toISOString(),detail:p.detail,source:'manual',...(orbitWorkspaceId!==null?{workspace_id:orbitWorkspaceId}:{})})});const data=await response.json();if(!response.ok)throw new Error(data.error||'Could not save task');localTask.serverId=data.task.id;localTask.id=Number(data.task.id)||localTask.id}}}catch(e){toast('Could not sync to account: '+e.message);return}tasks.push(localTask);state.pending=null;state.pendingDayOffset=0;$('#taskForm').reset();$('#manualTimeField').style.display='none';$('#taskManualTime').required=false;$('#parsedCard').classList.remove('show');renderTimeline();renderWeek();renderMonth();renderHabitMatrix();renderDashboard();go(targetOffset===0?'home':'plan');toast('Added to your plan · V3GAM found a slot ✦')});
function stopRecord(){state.recording=false;clearTimeout(state.tm);$('#recordTaskBtn').classList.remove('recording');$('#recordLabel').textContent='Describe it with your voice';$('#agentBtn').classList.remove('listening');if(state.rec){try{state.rec.stop()}catch(e){}state.rec=null}}
function mockRecord(){state.tm=setTimeout(()=>{if(state.recording){stopRecord();$('#taskName').focus();toast('Speak or type your task name')}},1700)}
$('#recordTaskBtn').addEventListener('click',()=>{if(state.recording){stopRecord();return}state.recording=true;$('#recordTaskBtn').classList.add('recording');$('#recordLabel').textContent='Listening… speak now';$('#agentBtn').classList.add('listening');const SR=window.SpeechRecognition||window.webkitSpeechRecognition;if(SR){try{const rec=new SR();state.rec=rec;rec.lang='en-US';rec.interimResults=false;rec.onresult=e=>{const tr=String(e.results?.[0]?.[0]?.transcript||'').trim();if(tr){$('#taskName').value=tr;stopRecord();showParsed()}else{stopRecord()}};rec.onerror=()=>{stopRecord();$('#taskName').focus();toast('Speak to V3GAM Live or type your task name')};rec.onend=()=>{if(state.recording)stopRecord()};rec.start();state.tm=setTimeout(()=>{if(state.recording){stopRecord();$('#taskName').focus()}},7000)}catch(e){stopRecord();$('#taskName').focus()}}else{stopRecord();$('#taskName').focus()}});
function renderWeek(){
 const head=$('#weekHead'),el=$('#weekGrid');if(!head||!el)return;head.innerHTML='';el.innerHTML='';
 const monday=new Date(date.getFullYear(),date.getMonth(),date.getDate());monday.setDate(monday.getDate()-((date.getDay()+6)%7));
 const short=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];let pctSum=0,doneSum=0,elapsedCount=0;const todayMidnight=new Date(date.getFullYear(),date.getMonth(),date.getDate());
 const weekDates=[];
 for(let i=0;i<7;i++){
  const d=new Date(monday);d.setDate(monday.getDate()+i);weekDates.push(d);
  const done=habits.reduce((n,h,hi)=>n+(isHabitDone(d,hi)?1:0),0),pct=Math.round(done/habits.length*100),isFuture=d>todayMidnight;if(!isFuture){pctSum+=pct;doneSum+=done;elapsedCount++;}
  const h=document.createElement('div');h.className='week-day-heading'+(dateKey(d)===dateKey(date)?' today':'');h.innerHTML='<span>'+short[i]+'</span><strong>'+d.getDate()+'</strong>';head.appendChild(h);
  const cell=document.createElement('div');cell.className='week-habit-day'+(dateKey(d)===dateKey(date)?' today':'');cell.innerHTML='<div class="week-percent">'+(isFuture?'—':pct+'%')+'</div><div class="week-habit-bar"><span style="width:'+(isFuture?0:pct)+'%"></span></div><div class="week-habit-count">'+(isFuture?'Up next':done+'/'+habits.length+' habits')+'</div>';cell.title=short[i]+' '+d.getDate()+(isFuture?': upcoming day':': '+done+' habits completed');el.appendChild(cell);
 }
 $('#weekHabitPercent').textContent=Math.round(pctSum/Math.max(1,elapsedCount))+'%';
 $('#weekHabitSummary').textContent=doneSum+' habit check-ins so far';
 const rows=$('#weeklyHabitRows');rows.innerHTML='';
 habits.forEach((h,hi)=>{const n=weekDates.filter(d=>d<=todayMidnight).reduce((sum,d)=>sum+(isHabitDone(d,hi)?1:0),0),p=Math.round(n/Math.max(1,elapsedCount)*100),row=document.createElement('div');row.className='weekly-habit-row';row.innerHTML='<span class="weekly-habit-name"><span class="habit-emoji">'+esc(h.icon)+'</span> '+esc(h.name)+'</span><span class="weekly-habit-track"><span style="width:'+p+'%"></span></span><span class="weekly-habit-rate">'+n+'/'+Math.max(1,elapsedCount)+'</span>';rows.appendChild(row)});
}
$$('[data-plan]').forEach(b=>b.addEventListener('click',()=>{$$('[data-plan]').forEach(x=>{x.classList.toggle('active',x===b);x.setAttribute('aria-selected',x===b?'true':'false')});$('#weekPane').style.display=b.dataset.plan==='week'?'block':'none';$('#monthPane').style.display=b.dataset.plan==='month'?'block':'none';$('#dailyPane').style.display=b.dataset.plan==='daily'?'block':'none';if(b.dataset.plan==='week')renderWeek();if(b.dataset.plan==='month'){renderMonth();renderSelectedDayTasks()}if(b.dataset.plan==='daily')renderHabitMatrix()}));
function renderMonth(){
 const el=$('#monthGrid');if(!el)return;el.innerHTML='';
 $('#monthHeading').textContent=date.toLocaleDateString('en-US',{month:'long',year:'numeric'});
 ['M','T','W','T','F','S','S'].forEach(s=>{const w=document.createElement('div');w.className='weekday';w.textContent=s;el.appendChild(w)});
 const first=new Date(date.getFullYear(),date.getMonth(),1),offset=(first.getDay()+6)%7;
 for(let i=0;i<offset;i++){const x=document.createElement('div');x.className='heat blank';x.setAttribute('aria-hidden','true');el.appendChild(x)}
 const count=new Date(date.getFullYear(),date.getMonth()+1,0).getDate();
 for(let n=1;n<=count;n++){
  const d=new Date(date.getFullYear(),date.getMonth(),n),done=habits.reduce((sum,h,hi)=>sum+(isHabitDone(d,hi)?1:0),0),pct=Math.round(done/habits.length*100),level=pct?Math.min(4,Math.ceil(pct/25)):0,taskCount=tasksForDate(d).length;
  const b=document.createElement('button');b.type='button';b.className='heat'+(level?' l'+level:'')+(dateKey(d)===dateKey(date)?' today':'')+(dateKey(d)===dateKey(selectedPlanDate)?' selected':'');b.dataset.date=dateKey(d);b.setAttribute('aria-pressed',dateKey(d)===dateKey(selectedPlanDate)?'true':'false');b.innerHTML='<span>'+n+'</span><small>'+(taskCount?taskCount+' task'+(taskCount>1?'s':''):done?done+'/10':'·')+'</small>';b.title=d.toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'})+' · '+taskCount+' tasks · '+pct+'% habits completed';el.appendChild(b)
 }
 renderSelectedDayTasks();
}
function renderSelectedDayTasks(){
 const title=$('#selectedDateHeader'),summary=$('#selectedDateSummary'),list=$('#selectedDayTasks');if(!title||!summary||!list||!selectedPlanDate)return;
 title.textContent=selectedPlanDate.toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'});
 const items=tasksForDate(selectedPlanDate);summary.textContent=items.length?items.length+' task'+(items.length===1?'':'s')+' on this day · '+items.reduce((n,t)=>n+t.duration,0)+' scheduled minutes':'No tasks are scheduled for this date yet.';
 list.innerHTML='';
 if(!items.length){list.innerHTML='<div class="selected-day-empty"><b>Nothing planned here yet</b>This date is open. Add a task whenever you are ready.</div>';return}
 items.forEach(t=>{const row=document.createElement('div');row.className='selected-task-row';const check=document.createElement('button');check.type='button';check.className='task-check '+(t.status==='done'?'checked':'');check.textContent=t.status==='done'?'✓':'';check.dataset.toggleTask=String(t.id);check.setAttribute('aria-label',t.status==='done'?'Mark incomplete':'Mark done');check.setAttribute('aria-pressed',String(t.status==='done'));const open=document.createElement('button');open.type='button';open.className='selected-task-open';open.dataset.task=String(t.id);open.innerHTML='<span class="selected-task-time">'+clock(t.start)+'</span><span class="selected-task-info"><strong>'+esc(t.title)+'</strong><small>'+esc(names[t.category]||names.personal)+' · '+t.duration+' minutes</small></span><span class="selected-task-state '+(t.status==='done'?'done':'')+'">'+(t.status==='done'?'✓ Done':t.status==='active'?'In progress':'Planned')+'</span>';row.append(check,open);list.appendChild(row)})
}
function renderHabitMatrix(){
 const matrix=$('#habitMatrix'),groups=$('#habitWeekGroups');if(!matrix||!groups)return;
 const daysInMonth=new Date(date.getFullYear(),date.getMonth()+1,0).getDate(),cols='178px repeat('+daysInMonth+',31px)';
 matrix.style.gridTemplateColumns=cols;groups.style.gridTemplateColumns=cols;matrix.innerHTML='';groups.innerHTML='';
 $('#habitMonthLabel').textContent=date.toLocaleDateString('en-US',{month:'long',year:'numeric'});
 const firstGroup=document.createElement('div');firstGroup.className='habit-matrix-cell matrix-corner';firstGroup.textContent='WEEK';groups.appendChild(firstGroup);
 for(let start=1,week=1;start<=daysInMonth;start+=7,week++){
  const span=Math.min(7,daysInMonth-start+1),g=document.createElement('div');g.className='habit-week-group';g.style.gridColumn='span '+span;g.textContent='Week '+week;groups.appendChild(g)
 }
 const corner=document.createElement('div');corner.className='habit-matrix-cell matrix-corner';corner.textContent='MY HABITS';matrix.appendChild(corner);
 for(let n=1;n<=daysInMonth;n++){const d=new Date(date.getFullYear(),date.getMonth(),n),c=document.createElement('div');c.className='habit-matrix-cell matrix-date';c.innerHTML='<span>'+n+'</span><small>'+['Su','Mo','Tu','We','Th','Fr','Sa'][d.getDay()]+'</small>';matrix.appendChild(c)}
 habits.forEach((h,hi)=>{
  const label=document.createElement('div');label.className='habit-matrix-cell habit-name-cell';label.innerHTML='<span class="habit-emoji">'+esc(h.icon)+'</span><span>'+esc(h.name)+'</span>';matrix.appendChild(label);
  for(let n=1;n<=daysInMonth;n++){
   const d=new Date(date.getFullYear(),date.getMonth(),n),done=isHabitDone(d,hi),future=new Date(d.getFullYear(),d.getMonth(),d.getDate())>new Date(date.getFullYear(),date.getMonth(),date.getDate()),btn=document.createElement('button');
   btn.type='button';btn.className='habit-check'+(done?' done':'');btn.textContent=done?'✓':'□';btn.disabled=future;btn.dataset.habitDate=dateKey(d);btn.dataset.habitIndex=String(hi);btn.setAttribute('aria-pressed',done?'true':'false');btn.setAttribute('aria-label',h.name+' on '+d.toLocaleDateString('en-US',{month:'short',day:'numeric'})+(future?' (future date)':''));btn.title=btn.getAttribute('aria-label');matrix.appendChild(btn)
  }
 });
 let checked=0;
 for(let n=1;n<=date.getDate();n++){const d=new Date(date.getFullYear(),date.getMonth(),n);habits.forEach((h,hi)=>{if(isHabitDone(d,hi))checked++})}
 const possible=habits.length*date.getDate(),pct=Math.round(checked/Math.max(1,possible)*100);
 $('#habitTotal').textContent=habits.length;$('#habitCompleted').textContent=checked;$('#habitProgressText').textContent=pct+'%';$('#habitProgressFill').style.width=pct+'%';
 renderHabitChart(daysInMonth);
}
function renderHabitChart(daysInMonth){
 const host=$('#habitChart');if(!host)return;
 const vals=[];
 for(let n=1;n<=daysInMonth;n++){const d=new Date(date.getFullYear(),date.getMonth(),n),count=habits.reduce((sum,h,hi)=>sum+(isHabitDone(d,hi)?1:0),0);vals.push(Math.round(count/habits.length*100))}
 const W=900,H=205,base=180,top=10,usable=base-top;
 const pts=vals.map((v,i)=>{const x=daysInMonth===1?0:i/(daysInMonth-1)*W,y=base-v/100*usable;return [x,y]});
 const path=pts.map((p,i)=>(i?'L':'M')+p[0].toFixed(1)+','+p[1].toFixed(1)).join(' ');
 const area=path+' L'+W+','+base+' L0,'+base+' Z';
 const grid=[25,50,75,100].map(v=>{const y=base-v/100*usable;return '<line x1="0" y1="'+y+'" x2="'+W+'" y2="'+y+'" stroke="var(--line)" stroke-dasharray="4 5"/><text x="4" y="'+(y-4)+'" fill="var(--m)" font-size="10">'+v+'%</text>'}).join('');
 host.innerHTML='<svg viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="none" aria-hidden="true">'+grid+'<path d="'+area+'" fill="#a8d29a" fill-opacity=".36"/><path d="'+path+'" fill="none" stroke="#89ad7d" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>'+pts.filter((p,i)=>i===0||i===pts.length-1||((i+1)%5===0)).map(p=>'<circle cx="'+p[0]+'" cy="'+p[1]+'" r="3" fill="#89ad7d"/>').join('')+'</svg>';
}
$('#manageHabitsBtn').addEventListener('click',()=>{renderHabitManager();$('#habitManagerOverlay').classList.add('open');$('#habitManagerOverlay').setAttribute('aria-hidden','false');setTimeout(()=>$('#newHabitName').focus(),60)});
$('#habitCreateForm').addEventListener('submit',e=>{e.preventDefault();const input=$('#newHabitName'),name=input.value.trim();if(!name)return;if(habits.some(h=>h.name.toLocaleLowerCase()===name.toLocaleLowerCase())){toast('That habit is already on your list');return}if(habits.length>=24){toast('Keep your routine focused: up to 24 habits');return}habits.push({id:'custom-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,6),name,icon:$('#newHabitIcon').value||'✦'});saveHabits();input.value='';$('#newHabitIcon').value='✦';refreshHabitViews();toast('Habit added to your routine ✦')});
$('#habitManagerList').addEventListener('click',e=>{const edit=e.target.closest('[data-edit-habit]'),remove=e.target.closest('[data-remove-habit]');if(edit){const h=habits.find(x=>x.id===edit.dataset.editHabit);if(!h)return;const name=prompt('Rename habit',h.name);if(name===null)return;const trimmed=name.trim();if(!trimmed){toast('Habit name cannot be empty');return}if(habits.some(x=>x.id!==h.id&&x.name.toLowerCase()===trimmed.toLowerCase())){toast('A habit with that name already exists');return}h.name=trimmed;saveHabits();refreshHabitViews();toast('Habit renamed')}else if(remove){const h=habits.find(x=>x.id===remove.dataset.removeHabit);if(!h)return;if(!confirm('Remove “'+h.name+'” from your habit list? Its saved checkbox history will be kept.'))return;habits=habits.filter(x=>x.id!==h.id);saveHabits();refreshHabitViews();toast('Habit removed from your routine')}});
$('#monthGrid').addEventListener('click',e=>{const b=e.target.closest('[data-date]');if(!b)return;const parts=b.dataset.date.split('-').map(Number);selectedPlanDate=new Date(parts[0],parts[1]-1,parts[2]);renderMonth()});
$('#habitMatrix').addEventListener('click',e=>{const b=e.target.closest('.habit-check');if(!b||b.disabled)return;const parts=b.dataset.habitDate.split('-').map(Number),d=new Date(parts[0],parts[1]-1,parts[2]),hi=Number(b.dataset.habitIndex);setHabitDone(d,hi,!isHabitDone(d,hi));renderHabitMatrix();renderWeek();renderMonth()});
$('#selectedDayTasks').addEventListener('click',e=>{const check=e.target.closest('[data-toggle-task]');if(check){e.preventDefault();e.stopPropagation();orbitToggleTaskDone(check.dataset.toggleTask);return}const b=e.target.closest('.selected-task-open[data-task]');if(b)openFocus(Number(b.dataset.task))});
$('#addSelectedDayTask').addEventListener('click',()=>{state.pendingDayOffset=dayOffset(selectedPlanDate);go('add');$('#taskName').focus()});
function renderBars(){const el=$('#barChart');if(!el)return;el.innerHTML='';const weekday=(date.getDay()+6)%7,labels=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];const maxHours=Math.max(1,...Array.from({length:7},(_,i)=>tasks.filter(t=>Number(t.day)===i-weekday+dashboardWeekOffset*7&&t.status!=='skipped').reduce((s,t)=>s+t.duration,0)/60));for(let i=0;i<7;i++){const offset=i-weekday+dashboardWeekOffset*7,dayTasks=tasks.filter(t=>Number(t.day)===offset&&t.status!=='skipped'),planned=dayTasks.reduce((s,t)=>s+t.duration,0)/60,actual=dayTasks.filter(t=>t.status==='done').reduce((s,t)=>s+t.duration,0)/60,x=document.createElement('div');x.className='bargrp';x.title=labels[i]+': '+planned.toFixed(1)+' planned hours, '+actual.toFixed(1)+' completed hours';x.innerHTML='<div class="barpair"><span class="bar" style="height:'+(planned/maxHours*100)+'%" title="Planned '+planned.toFixed(1)+'h"></span><span class="bar actual" style="height:'+(actual/maxHours*100)+'%" title="Completed '+actual.toFixed(1)+'h"></span></div><span class="barlabel">'+labels[i]+'</span>';el.appendChild(x)}const weekTasks=tasks.filter(t=>Number(t.day)>=-weekday+dashboardWeekOffset*7&&Number(t.day)<7-weekday+dashboardWeekOffset*7&&t.status!=='skipped'),done=weekTasks.filter(t=>t.status==='done').length,pct=Math.round(done/Math.max(1,weekTasks.length)*100);if($('#insightsDateRange'))$('#insightsDateRange').textContent=weekTasks.length+' tasks · '+labels[0]+'–'+labels[6];if($('#insightsScore'))$('#insightsScore').textContent=pct;if($('#insightsScoreFill'))$('#insightsScoreFill').style.width=pct+'%';if($('#insightsDelta'))$('#insightsDelta').textContent=weekTasks.length?'Completion rate for this workspace':'Add tasks to start tracking progress';}
function renderWeeklyActivity(){const host=$('#dashboardActivityChart');if(!host)return;host.innerHTML='';const weekday=(date.getDay()+6)%7,labels=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'],hours=Array.from({length:7},(_,i)=>tasks.filter(t=>Number(t.day)===i-weekday+dashboardWeekOffset*7&&t.status!=='skipped').reduce((s,t)=>s+t.duration,0)/60),max=Math.max(1,6,...hours);hours.forEach((h,i)=>{const done=tasks.filter(t=>Number(t.day)===i-weekday+dashboardWeekOffset*7&&t.status==='done').reduce((s,t)=>s+t.duration,0)/60,g=document.createElement('div');g.className='activity-bar-group';g.title=labels[i]+': '+h.toFixed(1)+'h scheduled, '+done.toFixed(1)+'h completed';const bar=document.createElement('div');bar.className='activity-bar '+(done>0?'gold':'purple');bar.style.height=(h/max*100)+'%';const label=document.createElement('span');label.textContent=labels[i];g.append(bar,label);host.appendChild(g)});const weekHours=hours.reduce((s,h)=>s+h,0),weekDone=tasks.filter(t=>Number(t.day)>=-weekday+dashboardWeekOffset*7&&Number(t.day)<7-weekday+dashboardWeekOffset*7&&t.status==='done').length,weekCount=tasks.filter(t=>Number(t.day)>=-weekday+dashboardWeekOffset*7&&Number(t.day)<7-weekday+dashboardWeekOffset*7&&t.status!=='skipped').length,pct=Math.round(weekDone/Math.max(1,weekCount)*100);const footer=$('.activity-bottom');if(footer)footer.innerHTML='<span><i class="legend-dot purple-dot"></i>'+pct+'% Complete</span><div class="activity-track"><span style="width:'+pct+'%"></span></div><span class="activity-bottom-right">'+weekHours.toFixed(1)+'h <b>↗</b></span>';const period=$('.activity-card .panel-period');if(period)period.textContent=dashboardWeekOffset===0?'This week':dashboardWeekOffset>0?'+'+dashboardWeekOffset+' week(s)':'−'+Math.abs(dashboardWeekOffset)+' week(s)';}
function updateInsights(){
 const visible=tasks.filter(t=>t.status!=='skipped'),done=visible.filter(t=>t.status==='done'),totalMinutes=visible.reduce((s,t)=>s+t.duration,0),doneMinutes=done.reduce((s,t)=>s+t.duration,0),total=visible.length;
 if($('#insightsCompleted'))$('#insightsCompleted').textContent=done.length;
 if($('#insightsHours'))$('#insightsHours').textContent=(doneMinutes/60).toFixed(1)+'h';
 if($('#insightsTotalHours'))$('#insightsTotalHours').innerHTML=(totalMinutes/60).toFixed(1)+'<small>hours</small>';
 if($('#insightsCategoryCaption'))$('#insightsCategoryCaption').textContent=total?(done.length+' of '+total+' tasks completed in this workspace'):'No saved tasks in this workspace yet';
 const categories=['study','lecture','gym','meal','lab'],colors=['var(--a)','var(--blue)','var(--green)','var(--gold)','var(--pink)'],sums=Object.fromEntries(categories.map(c=>[c,visible.filter(t=>t.category===c).reduce((s,t)=>s+t.duration,0)]));
 categories.forEach(c=>{const el=$('[data-insight-category="'+c+'"]');if(el)el.textContent=Math.round(sums[c]/Math.max(1,totalMinutes)*100)+'%'});
 const donut=$('#insightsDonut');if(donut){let cursor=0;const stops=categories.map((c,i)=>{const pct=sums[c]/Math.max(1,totalMinutes)*100,start=cursor;cursor+=pct;return colors[i]+' '+start.toFixed(2)+'% '+cursor.toFixed(2)+'%'});donut.style.background=totalMinutes?'conic-gradient('+stops.join(',')+')':'conic-gradient(var(--line) 0 100%)'}
 renderBars();
}
let dashboardWeekOffset=0;let dashboardFilter='';
function renderDashboard(){
 const snap=getWorkspaceTaskSnapshot(),total=snap.totalCount,todayTasks=snap.todayRaw,todayCount=snap.todayCount,closed=snap.totalDoneCount,percent=Math.round(closed/Math.max(total,1)*100);
 $('#dashFocus').textContent=$('#focusSummary').textContent;
 $('#dashTaskCount').textContent=todayCount;$('#dashClosed').textContent=closed;
 const dashEm=$('#dashTaskCount')&&$('#dashTaskCount').parentElement&&$('#dashTaskCount').parentElement.querySelector('em');
 if(dashEm)dashEm.textContent=total!==todayCount?(todayCount+' today \u00b7 '+total+' total in workspace'):'In your plan today';
 $('#dashboardTotal2').textContent=total;$('#dashboardClosed2').textContent=closed;
 $('#dashboardPercent').textContent=percent+'%';
 $('#dashboardPercentPanel').textContent=percent+'%';
 $('#dashboardRing').style.background='conic-gradient(from -90deg,var(--olive-500) 0 '+percent+'%,var(--s3) '+percent+'% 100%)';
 $('#dashboardRingPanel').style.background='conic-gradient(from -90deg,var(--olive-500) 0 '+percent+'%,var(--s3) '+percent+'% 100%)';
 $('#dashboardPercent').style.color='var(--t)';
 $('#dashboardProductivity').textContent=percent>=80?'Excellent momentum':percent>=40?'Steady progress':"You're on track";
 const start=new Date(date);const weekday=(date.getDay()+6)%7;start.setDate(date.getDate()-weekday+dashboardWeekOffset*7);
 const dnames=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
 $('#dashboardWeekHeader').innerHTML='';$('#dashboardCalendar').innerHTML='';
 const q=dashboardFilter.trim().toLowerCase();
 const cats={study:'study',lecture:'lecture',meal:'meal',gym:'gym',lab:'lab',personal:'meal'};
 const allMatch=tasks.filter(t=>t.status!=='skipped'&&(!q||(t.title+' '+esc(names[t.category]||names.personal)+' '+t.detail).toLowerCase().includes(q)));
 for(let i=0;i<7;i++){
  const d=new Date(start);d.setDate(start.getDate()+i);
  const iso=d.toDateString(),isToday=iso===date.toDateString();
  const hd=document.createElement('div');hd.className='week-date'+(isToday?' today':'');
  hd.innerHTML='<strong>'+d.getDate()+'</strong><span>'+dnames[i]+'</span>';$('#dashboardWeekHeader').appendChild(hd);
  const cell=document.createElement('div');cell.className='calendar-day';
  let items=[];
  const targetOffset=Math.round((new Date(d.getFullYear(),d.getMonth(),d.getDate())-new Date(date.getFullYear(),date.getMonth(),date.getDate()))/86400000);
  items=allMatch.filter(t=>Number(t.day)===targetOffset).sort((a,b)=>mins(a.start)-mins(b.start)).map(t=>({id:t.id,title:t.title,start:t.start,duration:t.duration,category:cats[t.category],done:t.status==='done'}));
  if(items.length){
   items.slice(0,3).forEach(t=>{
    const b=document.createElement('button');b.className='mini-task '+(t.category||'study')+(t.done?' done':'');b.type='button';b.title=t.title+' · '+clock(t.start);b.innerHTML='<span>'+esc(t.title)+'<small>'+clock(t.start)+' · '+t.duration+'m</small></span>';
    if(t.id)b.dataset.task=String(t.id);else {b.classList.add('sample');b.setAttribute('aria-label',t.title+' sample schedule');}
    cell.appendChild(b);
   });
   if(items.length>3){const more=document.createElement('button');more.className='calendar-tools-button';more.textContent='+'+(items.length-3)+' more';more.style.cssText='border:0;background:transparent;color:var(--m);font-size:8px;padding:4px;cursor:pointer';more.addEventListener('click',()=>{go('plan');toast('Open the full plan to see all tasks')});cell.appendChild(more)}
  }else{const empty=document.createElement('span');empty.className='day-empty';empty.textContent=q?'No matches':'Open space';cell.appendChild(empty)}
  $('#dashboardCalendar').appendChild(cell);
 }
 const deadline=$('#deadlineList');deadline.innerHTML='';
 const upcoming=allMatch.filter(t=>t.status!=='done').sort((a,b)=>mins(a.start)-mins(b.start)).slice(0,3);
 upcoming.forEach((t,i)=>{
  const b=document.createElement('button');b.className='deadline-item '+t.category;b.type='button';b.dataset.task=String(t.id);
  const prog=t.status==='active'?54:t.status==='planned'?Math.max(22,Math.min(70,Math.round((mins(t.start)/1440)*100))):100;
  b.innerHTML='<span class="deadline-icon">'+(t.category==='study'?'✦':t.category==='lab'?'⌘':t.category==='gym'?'↗':t.category==='lecture'?'▤':'◓')+'</span><span class="deadline-copy"><small>'+(i===0?'UP NEXT':i===1?'ON YOUR LIST':'COMING UP')+'</small><b>'+esc(t.title)+'</b></span><span class="deadline-percent">'+prog+'%</span><span class="deadline-progress"><span style="width:'+prog+'%"></span></span>';
  deadline.appendChild(b);
 });
 if(!upcoming.length)deadline.innerHTML='<div class="day-empty">All caught up — nicely done.</div>';
 const meeting=$('#meetingList');meeting.innerHTML='';
 const meetings=allMatch.filter(t=>t.status!=='done').sort((a,b)=>mins(a.start)-mins(b.start)).slice(0,2);
 meetings.forEach((t,i)=>{
  const b=document.createElement('button');b.className='meeting-item';b.type='button';if(t.id)b.dataset.task=String(t.id);
  const end=mins(t.start)+t.duration,et=String(Math.floor((end%1440)/60)).padStart(2,'0')+':'+String(end%60).padStart(2,'0');
  b.innerHTML='<span class="meeting-time">'+clock(t.start).replace(' ','<br>')+'</span><span class="meeting-copy"><small>'+(i===0?'UP NEXT · '+t.duration+' MIN':'LATER TODAY · '+t.duration+' MIN')+'</small><b>'+esc(t.title)+'</b></span><span class="meeting-badge">'+(t.status==='active'?'Now':'Planned')+'</span>';
  meeting.appendChild(b);
 });
 if(!meetings.length)meeting.innerHTML='<div class="day-empty">Nothing pending. Take a break.</div>';
 const agenda=$('#dashboardTodayAgenda');agenda.innerHTML='';
 allMatch.filter(t=>t.day===0&&t.status!=='skipped').sort((a,b)=>mins(a.start)-mins(b.start)).slice(0,3).forEach(t=>{
  const b=document.createElement('button');b.className='agenda-item';b.type='button';b.dataset.task=String(t.id);b.style.setProperty('--task-accent','var(--c)');b.innerHTML='<i class="agenda-color" style="--task-accent:'+(t.category==='gym'?'#4dd5aa':t.category==='lab'?'#ff8ba7':t.category==='lecture'?'#77b8ff':t.category==='meal'?'#f5cc72':'#a493ff')+'"></i><span><b>'+esc(t.title)+'</b><small>'+clock(t.start)+' · '+t.duration+' min</small></span>';agenda.appendChild(b);
 });
 renderWeeklyActivity();updateInsights();
}
function openDashboardTask(e){const b=e.target.closest('[data-task]');if(b&&b.dataset.task)openFocus(Number(b.dataset.task))}
$('#dashboardCalendar').addEventListener('click',openDashboardTask);
$('#deadlineList').addEventListener('click',openDashboardTask);
$('#meetingList').addEventListener('click',openDashboardTask);
$('#dashboardTodayAgenda').addEventListener('click',openDashboardTask);
$('#globalSearch').addEventListener('input',e=>{dashboardFilter=e.target.value;renderDashboard()});
$('#globalSearch').addEventListener('keydown',e=>{if(e.key==='Escape'){e.target.value='';dashboardFilter='';renderDashboard()}});
document.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();if(window.innerWidth>800)$('#globalSearch').focus();else go('add')}});
$('#barTheme').addEventListener('click',()=>{$('#themeToggle').click();$('#barTheme span').textContent=state.theme==='light'?'☾':'☼';$('#settingsMenu').hidden=true;$('#settingsToggle').setAttribute('aria-expanded','false')});
$('#themeToggle').addEventListener('click',()=>{$('#barTheme span').textContent=state.theme==='light'?'☾':'☼';});
$('#settingsToggle').addEventListener('click',()=>{const menu=$('#settingsMenu');menu.hidden=!menu.hidden;$('#settingsToggle').setAttribute('aria-expanded',String(!menu.hidden))});$('#orbitProfileButton').addEventListener('click',()=>$('#settingsToggle').click());
document.addEventListener('click',e=>{if(!e.target.closest('.settings-wrap')&&!e.target.closest('#orbitProfileButton')){$('#settingsMenu').hidden=true;$('#settingsToggle').setAttribute('aria-expanded','false')}});
$('#barAssistant').addEventListener('click',()=>$('#agentBtn').click());
$('#sidebarToggle').addEventListener('click',()=>{
 const app=$('#app'),collapsed=app.classList.toggle('sidebar-collapsed'),toggle=$('#sidebarToggle');
 toggle.setAttribute('aria-expanded',String(!collapsed));
 toggle.setAttribute('aria-label',collapsed?'Show sidebar':'Hide sidebar');
 toggle.title=collapsed?'Show sidebar':'Hide sidebar';
});
$('#railAssistant').addEventListener('click',()=>$('#agentBtn').click());
$('#railTheme').addEventListener('click',()=>{$('#themeToggle').click();$('#railThemeIcon').textContent=state.theme==='light'?'☾':'☼';});
$('#themeToggle').addEventListener('click',()=>{$('#railThemeIcon').textContent=state.theme==='light'?'☾':'☼';});
$('#scheduleAssistant').addEventListener('click',()=>$('#agentBtn').click());$('#quoteAddTask').addEventListener('click',()=>$('#dashboardNew').click());
$('#deadlineAi').addEventListener('click',()=>$('#agentBtn').click());
$('#dashboardNew').addEventListener('click',()=>{go('add');$('#taskName').focus()});
$('#dashboardManage').addEventListener('click',()=>{go('plan');toast('Manage your week and monthly plan')});
$('#dashboardActions').addEventListener('click',()=>$('#agentBtn').click());
$('#dashboardMore').addEventListener('click',()=>toast('More project options coming soon'));
function orbitEnterDemo(){
 $('#groupManagementDashboard').hidden=true;
 if(!orbitDemoMode)orbitRealTaskSnapshot=tasks.map(t=>({...t}));
 orbitDemoMode=true;
 orbitUpdateElevenLabsAvailability();
 tasks.splice(0,tasks.length,...demoTasks.map(t=>({...t,serverId:undefined})));
 state.id=Math.max(20,...tasks.map(t=>Number(t.id)||0));
 $('#orbitAuth').hidden=true;
 $('#demoToggle').textContent='Exit demo';
 $('#demoToggle').classList.add('is-demo');
 $('#demoExitFloating').hidden=false;$('#demoExitFloating').classList.add('visible');
 refreshTaskViews();go('home');toast('Demo preview started · changes stay on this device only');
}
async function orbitExitDemo(){
 if(!orbitDemoMode)return;
 orbitDemoMode=false;
 orbitUpdateElevenLabsAvailability();
 tasks.splice(0,tasks.length,...orbitRealTaskSnapshot.map(t=>({...t})));
 orbitRealTaskSnapshot=[];
 $('#demoToggle').textContent='▷ Demo';$('#demoToggle').classList.remove('is-demo');
 $('#demoExitFloating').hidden=true;$('#demoExitFloating').classList.remove('visible');
 refreshTaskViews();
 if(orbitSessionActive){await orbitLoadTasks();if(orbitWorkspaceId!==null)await orbitLoadWorkspaceMembers();}
 else {$('#orbitAuth').hidden=false;orbitSetAuthMode('login');}
 toast('Demo ended · your saved tasks are unchanged');
}
async function orbitExitWorkspace(workspaceId,workspaceName){
 if(!orbitSessionActive||orbitDemoMode){toast('Sign in to leave a group workspace');return}
 const id=Number(workspaceId),name=String(workspaceName||'this workspace');
 if(!Number.isSafeInteger(id)||id<1)return;
 if(!confirm('Exit '+name+'? Your tasks in this group will move to your personal workspace. The group and other members’ tasks will stay intact.'))return;
 try{
  const response=await orbitAuthorizedFetch('/api/workspaces?workspace_id='+encodeURIComponent(id),{method:'DELETE'});
  const data=await response.json();if(!response.ok)throw new Error(data.error||'Could not exit the workspace');
  await orbitLoadWorkspaces();
  if(Number(orbitWorkspaceId)===id)await orbitSelectWorkspace(null,'Personal workspace',false);
  await orbitRenderWorkspaceDirectory();
  toast('You left '+name+'. '+(Number(data.tasks_moved)||0)+' of your tasks moved to Personal.');
 }catch(e){toast(e.message||'Could not exit this workspace');}
}
async function orbitRenderWorkspaceDirectory(){
 $('#workspaceDetail').hidden=true;
 const host=$('#workspacePageGroups');if(!host)return;
 if(!orbitSessionActive&&!orbitDemoMode&&!orbitWorkspaces.length){host.innerHTML='<div class="workspace-page-empty"><b>Sign in to manage workspaces</b>Your personal workspace and group memberships will appear here after you sign in.</div>';return}
 host.innerHTML='<div class="workspace-page-empty">Loading your workspaces…</div>';
 try{
  if(orbitSessionActive&&!orbitDemoMode)await orbitLoadWorkspaces();else orbitRenderWorkspaceMenuItems();
  host.innerHTML='';
  if(!orbitWorkspaces.length){host.innerHTML='<div class="workspace-page-empty"><b>No group workspaces yet</b>Create a group for friends or family, then share its invite code so everyone can plan together.</div>';return}
  orbitWorkspaces.forEach(w=>{
   const card=document.createElement('article');card.className='workspace-group-card';
   const icon=document.createElement('div');icon.className='workspace-group-icon';icon.textContent='♧';
   const info=document.createElement('div');info.className='workspace-group-info';
   const title=document.createElement('b');title.textContent=w.name;
   const desc=document.createElement('p');desc.textContent=(w.role==='owner'?'You own this shared workspace.':'You are a member of this shared workspace.')+' · '+(w.member_count||1)+' member'+((w.member_count||1)===1?'':'s')+' · Shared tasks and schedule';
   const role=document.createElement('span');role.textContent=w.role==='owner'?'OWNER':'GROUP WORKSPACE';
   info.append(title,desc,role);
   const open=document.createElement('button');open.className='btn primary';open.type='button';open.textContent='Open workspace ↗';open.addEventListener('click',()=>orbitSelectWorkspace(w.id,w.name));
   if(w.role!=='owner'){const exit=document.createElement('button');exit.className='btn workspace-exit-btn';exit.type='button';exit.textContent='Exit';exit.setAttribute('aria-label','Exit '+w.name);exit.addEventListener('click',()=>orbitExitWorkspace(w.id,w.name));card.append(icon,info,open,exit)}else card.append(icon,info,open);host.appendChild(card);
  });
 }catch(e){host.innerHTML='<div class="workspace-page-empty"><b>Could not load workspaces</b>'+esc(e.message||'Please try again.')+'</div>'}
}
async function orbitLoadWorkspaceMembers(){
 const card=$('#groupManagementDashboard'),host=$('#dashboardGroupMembers');
 $$('.workspace-members-section').forEach(el=>el.hidden=true);
 if(!card||!host||orbitWorkspaceId===null||!orbitSessionActive||orbitDemoMode){if(card)card.hidden=true;return}
 const workspaceId=orbitWorkspaceId,w=orbitWorkspaces.find(x=>Number(x.id)===workspaceId),isOwner=w?.role==='owner'||w?.owner_id===orbitUserId;
 card.hidden=!isOwner;
 if(!isOwner){host.innerHTML='';$('#dashboardGroupInviteCode').textContent='';return}
 $('#dashboardGroupInviteCode').textContent=w?.invite_code||'Loading…';
 host.innerHTML='<div class="workspace-page-empty">Loading members…</div>';
 $('#dashboardGroupManageMessage').textContent='';
 try{
  const response=await orbitAuthorizedFetch('/api/workspaces?workspace_id='+encodeURIComponent(workspaceId));
  const data=await response.json();if(!response.ok)throw new Error(data.error||'Could not load group members');
  if(orbitWorkspaceId!==workspaceId||!orbitSessionActive)return;
  const members=Array.isArray(data.members)?data.members:[],workspace=data.workspace||w;
  if(workspace){
   const local=orbitWorkspaces.find(x=>Number(x.id)===workspaceId);
   if(local){local.invite_code=workspace.invite_code;local.member_count=workspace.member_count;local.name=workspace.name}
   $('#dashboardGroupInviteCode').textContent=workspace.invite_code||'No invite code';
   $('#dashboardGroupMemberCount').textContent=members.length;
  }
  host.innerHTML='';
  if(!members.length){host.innerHTML='<div class="workspace-page-empty"><b>No members found</b>Refresh this list or share the invite code to bring your group together.</div>';return}
  members.forEach(member=>{
   const row=document.createElement('div');row.className='workspace-member-row';
   const avatar=document.createElement('div');avatar.className='workspace-member-avatar';avatar.textContent=String(member.display_name||member.email||'M').trim().charAt(0).toUpperCase();
   const copy=document.createElement('div');copy.className='workspace-member-copy';
   const name=document.createElement('b');name.textContent=member.display_name||member.email||'Group member';
   const email=document.createElement('small');email.textContent=member.email||'Email unavailable';copy.append(name,email);
   const role=document.createElement('span');role.className='workspace-member-role';role.textContent=member.role==='owner'?'CREATOR':'MEMBER';row.append(avatar,copy,role);
   if(member.role!=='owner'){
    const remove=document.createElement('button');remove.className='workspace-member-remove';remove.type='button';remove.textContent='Remove';
    remove.addEventListener('click',async()=>{
     const who=member.display_name||member.email||'this member';
     if(!confirm('Remove '+who+' from '+(workspace.name||'this group')+'? They will lose access to this group workspace.'))return;
     remove.disabled=true;
     try{
      const r=await orbitAuthorizedFetch('/api/workspaces?workspace_id='+encodeURIComponent(workspaceId)+'&user_id='+encodeURIComponent(member.user_id),{method:'DELETE'});
      const result=await r.json();if(!r.ok)throw new Error(result.error||'Could not remove member');
      await orbitLoadWorkspaces();await orbitLoadWorkspaceMembers();
      $('#dashboardGroupManageMessage').textContent=who+' was removed from this group.';
      toast('Member removed from group');
     }catch(e){toast(e.message);remove.disabled=false}
    });
    row.appendChild(remove);
   }
   host.appendChild(row);
  });
 }catch(e){
  host.innerHTML='<div class="workspace-page-empty"><b>Could not load members</b>'+esc(e.message||'Please try again.')+'</div>';
  $('#dashboardGroupManageMessage').textContent=e.message||'Could not load members';
 }
}
function orbitRenderGroupBoard(){
 const panel=$('#workspaceDetail'),list=$('#workspaceDetailTasks');if(!panel||!list)return;
 if(orbitWorkspaceId===null){panel.hidden=true;return}
 const w=orbitWorkspaces.find(x=>Number(x.id)===Number(orbitWorkspaceId));
 panel.hidden=false;$('#workspaceDetailTitle').textContent=w?.name||$('#workspaceName').textContent||'Group workspace';
 $('#workspaceDetailDescription').textContent='Tasks in this group are shared with its members. Add or complete tasks here to update the shared plan.';
 $('#workspaceDetailMemberCount').textContent=w?.member_count||'Group';
 $('#workspaceDetailInvite').hidden=!(w?.role==='owner'||w?.owner_id===orbitUserId);
 $('#workspaceDetailExit').hidden=!w||(w.role==='owner'||w.owner_id===orbitUserId);
 const groupTasks=tasks.filter(t=>Number(t.workspaceId||orbitWorkspaceId)===Number(orbitWorkspaceId));
 $('#workspaceDetailTaskCount').textContent=groupTasks.filter(t=>t.status!=='skipped').length;
 $('#workspaceDetailDoneCount').textContent=groupTasks.filter(t=>t.status==='done').length;
 list.innerHTML='';
 if(!groupTasks.length){list.innerHTML='<div class="workspace-page-empty"><b>This group is ready for its first task</b>Add a task to build your shared plan. It will be visible to members of this workspace.</div>';return}
 groupTasks.sort((a,b)=>mins(a.start)-mins(b.start)).forEach(t=>{
  const row=document.createElement('div');row.className='workspace-task-row'+(t.status==='done'?' done':'');
  const state=document.createElement('button');state.className='task-state';state.type='button';state.textContent=t.status==='done'?'✓':'○';state.setAttribute('aria-label',t.status==='done'?'Mark task active':'Complete task');
  state.addEventListener('click',()=>{const old=t.status;t.status=old==='done'?'planned':'done';orbitSaveTaskStatus(t).then(()=>{orbitRenderGroupBoard();renderDashboard()}).catch(e=>{t.status=old;toast(e.message)})});
  const copy=document.createElement('div');copy.className='task-copy';const title=document.createElement('b');title.textContent=t.title;const meta=document.createElement('small');meta.textContent=clock(t.start)+' · '+t.duration+' min · '+(t.status==='done'?'Completed':t.status==='active'?'In progress':'Planned');copy.append(title,meta);row.append(state,copy);list.appendChild(row);
 });
}
async function orbitSaveTaskStatus(t){
 if(orbitDemoMode||!orbitSessionActive||!t.serverId)return;
 const response=await orbitAuthorizedFetch('/api/tasks?id='+encodeURIComponent(t.serverId)+'&workspace_id='+encodeURIComponent(orbitWorkspaceId),{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:t.status,workspace_id:orbitWorkspaceId})});
 const data=await response.json();if(!response.ok)throw new Error(data.error||'Could not update group task');
}
function orbitOpenWorkspaceDialog(joinOnly=false){
 if(orbitDemoMode){toast('Exit demo to manage group workspaces');return}
 if(!orbitSessionActive){orbitAuthPanel.hidden=false;orbitAuthNotice('Sign in to create or join a group workspace.',true);return}
 $('#workspaceMenu').hidden=true;$('#workspaceSwitch').setAttribute('aria-expanded','false');
 $('#createWorkspaceForm').style.display=joinOnly?'none':'block';
 $('#joinWorkspaceForm').style.display=joinOnly?'block':'block';
 $('#workspaceInviteResult').classList.remove('visible');
 $('#workspaceDialogMessage').textContent='';
 $('#workspaceDialog').classList.add('open');$('#workspaceDialog').setAttribute('aria-hidden','false');
 if(joinOnly)$('#workspaceInviteCode').focus();else $('#newWorkspaceName').focus();
}
function orbitCloseWorkspaceDialog(){$('#workspaceDialog').classList.remove('open');$('#workspaceDialog').setAttribute('aria-hidden','true')}
function orbitRenderWorkspaceMenuItems(){
 const count=$('#workspaceGroupCount');if(count)count.textContent=orbitWorkspaces.length+' group'+(orbitWorkspaces.length===1?'':'s');
 const host=$('#groupWorkspaceItems');if(!host)return;host.innerHTML='';
 orbitWorkspaces.forEach(w=>{
  const b=document.createElement('button');b.type='button';b.className='workspace-menu-item'+(String(w.id)===String(orbitWorkspaceId)?' selected':'');b.dataset.workspaceId=String(w.id);
  const label=document.createElement('span');label.textContent='♧';
  const copy=document.createElement('span');const title=document.createElement('b');title.textContent=w.name;const sub=document.createElement('small');sub.textContent=(w.role==='owner'?'Owner':'Member')+' · '+(w.member_count||1)+' member'+((w.member_count||1)===1?'':'s')+(w.role==='owner'?' · Invite: '+w.invite_code:'');copy.append(title,sub);b.append(label,copy);b.addEventListener('click',()=>orbitSelectWorkspace(w.id,w.name));host.appendChild(b);
 });
}
async function orbitLoadWorkspaces(){
 if(!orbitSessionActive||orbitDemoMode){orbitRenderWorkspaceMenuItems();return;}
 try{
  const response=await orbitAuthorizedFetch('/api/workspaces');const data=await response.json();
  if(!response.ok)throw new Error(data.error||'Could not load workspaces');
  orbitWorkspaces=Array.isArray(data.workspaces)?data.workspaces:[];
  orbitRenderWorkspaceMenuItems();
 }catch(e){toast('Could not load group workspaces: '+e.message);if(orbitBootstrapInFlight)throw e;}
}
async function orbitSelectWorkspace(id,name,navigate=true){
 orbitWorkspaceId=id===null?null:Number(id);
 $('#groupManagementDashboard').hidden=true;
 try{localStorage.setItem(orbitWorkspaceStorageKey(),orbitWorkspaceId===null?'personal':String(orbitWorkspaceId))}catch(e){}
 const selected=orbitWorkspaceId===null?null:orbitWorkspaces.find(w=>Number(w.id)===orbitWorkspaceId);
 $('#workspaceName').textContent=orbitWorkspaceId===null?'V3GAM Pro':(name||selected?.name||'Group workspace');
 $('#workspaceSubtitle').textContent=orbitWorkspaceId===null?'Personal workspace':'Group workspace · '+(selected?.role==='owner'?'Owner':'Member');
 $('#personalWorkspaceItem').classList.toggle('selected',orbitWorkspaceId===null);
 $$('#groupWorkspaceItems [data-workspace-id]').forEach(b=>b.classList.toggle('selected',Number(b.dataset.workspaceId)===orbitWorkspaceId));
 $('#workspaceMenu').hidden=true;$('#workspaceSwitch').setAttribute('aria-expanded','false');
 dashboardWeekOffset=0;dashboardFilter='';$('#globalSearch').value='';
 orbitLoadHabitScope();
 $('#dashboardTitle').textContent=orbitWorkspaceId===null?'Personal workspace':($('#workspaceName').textContent||'Group workspace');
 $('#dashboardScopeBadge').textContent=orbitWorkspaceId===null?'PERSONAL WORKSPACE':'SHARED GROUP WORKSPACE · '+(selected?.member_count||1)+' MEMBER'+((selected?.member_count||1)===1?'':'S');
 $('#workspaceDetail').hidden=true;
 if(orbitSessionActive&&!orbitDemoMode)await orbitLoadTasks();else refreshTaskViews();
 if(orbitWorkspaceId!==null){orbitRenderGroupBoard();if(orbitSessionActive&&!orbitDemoMode)await orbitLoadWorkspaceMembers();}
 updateInsights();
 if(navigate)go('home');
}
async function orbitRestoreWorkspaceSelection(){
 if(!orbitSessionActive)return;
 await orbitLoadWorkspaces();
 let saved='personal';try{saved=localStorage.getItem(orbitWorkspaceStorageKey())||'personal'}catch(e){}
 const match=saved==='personal'?null:orbitWorkspaces.find(w=>String(w.id)===String(saved));
 if(match)await orbitSelectWorkspace(match.id,match.name,false);else await orbitSelectWorkspace(null,undefined,false);
}
async function orbitCreateWorkspace(e){
 e.preventDefault();if(!orbitSessionActive)return;
 const name=$('#newWorkspaceName').value.trim();if(name.length<2)return;
 const submit=$('#createWorkspaceForm').querySelector('button[type=submit]');submit.disabled=true;
 try{
  const response=await orbitAuthorizedFetch('/api/workspaces',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'create',name,email:orbitUserEmail})});
  const data=await response.json();if(!response.ok)throw new Error(data.error||'Could not create group workspace');
  const w=data.workspace;$('#workspaceInviteValue').textContent=w.invite_code;$('#workspaceInviteResult').classList.add('visible');
  $('#workspaceDialogMessage').textContent='Group created. Share the invite code with friends or family so they can join.';
  await orbitLoadWorkspaces();await orbitSelectWorkspace(w.id,w.name);
  toast('Group workspace created');
 }catch(err){$('#workspaceDialogMessage').textContent=err.message}
 finally{submit.disabled=false}
}
async function orbitJoinWorkspace(e){
 e.preventDefault();if(!orbitSessionActive)return;
 const invite_code=$('#workspaceInviteCode').value.trim().toUpperCase().replace(/\s+/g,'');if(!invite_code)return;
 const submit=$('#joinWorkspaceForm').querySelector('button[type=submit]');submit.disabled=true;
 try{
  const response=await orbitAuthorizedFetch('/api/workspaces',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'join',invite_code,email:orbitUserEmail})});
  const data=await response.json();if(!response.ok)throw new Error(data.error||'Could not join group workspace');
  await orbitLoadWorkspaces();await orbitSelectWorkspace(data.workspace.id,data.workspace.name);$('#workspaceInviteCode').value='';
  orbitCloseWorkspaceDialog();toast('Joined '+data.workspace.name);
 }catch(err){$('#workspaceDialogMessage').textContent=err.message}
 finally{submit.disabled=false}
}
$('#workspaceSwitch').addEventListener('click',()=>{const menu=$('#workspaceMenu');menu.hidden=!menu.hidden;$('#workspaceSwitch').setAttribute('aria-expanded',String(!menu.hidden));if(orbitSessionActive)orbitLoadWorkspaces()});
document.addEventListener('click',e=>{if(!e.target.closest('.workspace-select-wrap')){$('#workspaceMenu').hidden=true;$('#workspaceSwitch').setAttribute('aria-expanded','false')}});
$('#personalWorkspaceItem').addEventListener('click',()=>orbitSelectWorkspace(null));
$('#workspacePageCreate').addEventListener('click',()=>orbitOpenWorkspaceDialog(false));
$('#workspacePageJoin').addEventListener('click',()=>orbitOpenWorkspaceDialog(true));
$('#workspacePageOpenPersonal').addEventListener('click',()=>orbitSelectWorkspace(null));
$('#workspaceDetailAdd').addEventListener('click',()=>{state.pendingDayOffset=0;go('add');$('#taskName').focus()});
$('#workspaceDetailBack').addEventListener('click',()=>go('workspace'));
$('#workspaceMembersRefresh').addEventListener('click',orbitLoadWorkspaceMembers);
$('#dashboardRefreshMembers').addEventListener('click',orbitLoadWorkspaceMembers);
async function orbitCopyGroupInvite(showInviteMessage=true){
 const code=$('#dashboardGroupInviteCode').textContent.trim();
 if(!code||code==='Loading…'||code==='No invite code'){toast('Invite code is not ready yet');return}
 try{await navigator.clipboard.writeText(code);$('#dashboardGroupManageMessage').textContent=showInviteMessage?'Invite code copied. Share it with the person you want to add to this group.':'Invite code copied.'}
 catch(e){$('#dashboardGroupManageMessage').textContent='Copy this invite code manually and share it only with people you want in this group: '+code}
}
$('#dashboardCopyInvite').addEventListener('click',()=>orbitCopyGroupInvite(false));
$('#dashboardShareInvite').addEventListener('click',async()=>{await orbitCopyGroupInvite(true);if($('#dashboardGroupManageMessage').textContent.includes('copied'))toast('Invite code ready to share')});
$('#dashboardRotateInvite').addEventListener('click',async()=>{
 if(!orbitWorkspaceId||!orbitSessionActive)return;
 const w=orbitWorkspaces.find(x=>Number(x.id)===Number(orbitWorkspaceId));
 if(w?.role!=='owner'&&w?.owner_id!==orbitUserId){toast('Only the group creator can regenerate the invite code');return}
 if(!confirm('Regenerate this group invite code? The old code will stop working for new members. Current members will keep their access.'))return;
 const button=$('#dashboardRotateInvite');button.disabled=true;
 try{
  const response=await orbitAuthorizedFetch('/api/workspaces',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'rotate_invite',workspace_id:orbitWorkspaceId})});
  const data=await response.json();if(!response.ok)throw new Error(data.error||'Could not regenerate invite code');
  await orbitLoadWorkspaces();
  $('#dashboardGroupInviteCode').textContent=data.workspace.invite_code;
  $('#dashboardGroupManageMessage').textContent='Invite code regenerated. The previous code is no longer valid for new members.';
  toast('Invite code regenerated');
 }catch(e){$('#dashboardGroupManageMessage').textContent=e.message||'Could not regenerate invite code'}
 finally{button.disabled=false}
});
$('#workspaceDetailInvite').addEventListener('click',()=>{const w=orbitWorkspaces.find(x=>Number(x.id)===Number(orbitWorkspaceId));if(w?.invite_code){orbitOpenWorkspaceDialog(false);$('#createWorkspaceForm').style.display='none';$('#joinWorkspaceForm').style.display='none';$('#workspaceInviteValue').textContent=w.invite_code;$('#workspaceInviteResult').classList.add('visible');$('#workspaceDialogMessage').textContent='Share this code only with people you want to invite to '+w.name+'.'}else toast('Invite code unavailable. Refresh the workspace list.')});
$('#workspaceDetailExit').addEventListener('click',()=>{const w=orbitWorkspaces.find(x=>Number(x.id)===Number(orbitWorkspaceId));if(w)orbitExitWorkspace(w.id,w.name)});
$('#createGroupWorkspace').addEventListener('click',()=>orbitOpenWorkspaceDialog(false));
$('#joinGroupWorkspace').addEventListener('click',()=>orbitOpenWorkspaceDialog(true));
$('#closeWorkspaceDialog').addEventListener('click',orbitCloseWorkspaceDialog);
$('#workspaceDialog').addEventListener('click',e=>{if(e.target===$('#workspaceDialog'))orbitCloseWorkspaceDialog()});
$('#createWorkspaceForm').addEventListener('submit',orbitCreateWorkspace);
$('#joinWorkspaceForm').addEventListener('submit',orbitJoinWorkspace);
$('#copyWorkspaceInvite').addEventListener('click',async()=>{const code=$('#workspaceInviteValue').textContent;if(!code)return;try{await navigator.clipboard.writeText(code);$('#workspaceDialogMessage').textContent='Invite code copied. Share it only with people you want in this group.'}catch(e){$('#workspaceDialogMessage').textContent='Copy this code manually and share it only with your group: '+code}});
$('#demoToggle').addEventListener('click',()=>orbitDemoMode?orbitExitDemo():orbitEnterDemo());
$('#authDemoButton').addEventListener('click',orbitEnterDemo);
$('#demoExitFloating').addEventListener('click',orbitExitDemo);
$('#barNotify').addEventListener('click',()=>toast('You’re all caught up on notifications'));
$('#progressMore').addEventListener('click',()=>toast('Progress updates as you complete tasks'));
$('#deadlineMore').addEventListener('click',()=>{dashboardFilter='';$('#globalSearch').value='';renderDashboard();toast('Showing your next deadlines')});
$('#meetingMore').addEventListener('click',()=>go('plan'));
$('#allDeadlines').addEventListener('click',()=>{go('home');$('#scroll').scrollTop=0});
$('#focusCurrent').addEventListener('click',()=>{const t=tasks.find(t=>t.status==='active'&&t.day===0)||tasks.find(t=>t.status!=='done'&&t.status!=='skipped'&&t.day===0);if(t)openFocus(t.id);else toast('Your task list is clear')});
$('#calendarOpenPlan').addEventListener('click',()=>go('plan'));
$('#calendarMonth').addEventListener('click',()=>go('plan'));
function refreshWorkspaceDateViews(){renderDashboard();renderBars();updateInsights()}
$('#calendarPrev').addEventListener('click',()=>{dashboardWeekOffset--;renderDashboard()});
$('#calendarNext').addEventListener('click',()=>{dashboardWeekOffset++;renderDashboard()});
$('#calendarFilter').addEventListener('click',()=>{const next=prompt('Filter tasks by title or category:',dashboardFilter);if(next!==null){dashboardFilter=next;$('#globalSearch').value=next;renderDashboard()}});
$('#calendarStatus').addEventListener('click',()=>{dashboardFilter='';$('#globalSearch').value='';renderDashboard();toast('Showing tasks of every status')});
$('#calendarCustomize').addEventListener('click',()=>toast('Calendar layout is set to weekly view'));
$('#calendarView').addEventListener('click',()=>go('plan'));
/* end dashboard handlers */

$('#agentBtn').addEventListener('click',()=>{ $('#agentOverlay').classList.add('open');$('#agentOverlay').setAttribute('aria-hidden','false');$('#agentInput').focus()});
$$('[data-close]').forEach(b=>b.addEventListener('click',()=>close(b.dataset.close)));
$('#agentOverlay').addEventListener('click',e=>{if(e.target===$('#agentOverlay'))close('agentOverlay')});
function v3gamSpokenText(s){return String(s||'').replace(/\b(?:left|right|up|down)?\s*arrow(?:\s+curving\s+(?:left|right|up|down))?\b/gi,' ').replace(/\bv\s?3\s?gam\b/gi,'Vegam').replace(/[\u2190-\u21ff\u25a0-\u25ff\u2600-\u27bf\u2b00-\u2bff\ufe0f]|\p{Extended_Pictographic}/gu,' ').replace(/\s{2,}/g,' ').trim();}
function speakV3GAM(text){
 if(!orbitVoiceTtsEnabled||!('speechSynthesis' in window)||!text)return;
 try{
  const clean=String(text).replace(/[✦↗✓◷]/g,'').trim();
  if(!clean)return;
  if(typeof window.v3gamNotifyTtsStart==='function')window.v3gamNotifyTtsStart(v3gamSpokenText(clean));
  window.speechSynthesis.cancel();
  const u=new SpeechSynthesisUtterance(v3gamSpokenText(clean));
  const voices=window.speechSynthesis.getVoices()||[];
  const langPrefix=orbitVoiceLang.slice(0,2).toLowerCase();
  const preferred=voices.find(v=>/natural|online|google/i.test(v.name)&&v.lang.toLowerCase().startsWith(langPrefix))
   ||voices.find(v=>/neerja|prabhat|swara|dhwani|india/i.test(v.name)&&v.lang.toLowerCase().startsWith(langPrefix))
   ||voices.find(v=>/natural|online|google/i.test(v.name)&&v.lang.toLowerCase().startsWith('en'))
   ||voices.find(v=>v.lang.toLowerCase().startsWith(langPrefix))
   ||voices[0];
  if(preferred){u.voice=preferred;u.lang=preferred.lang;}else{u.lang=orbitVoiceLang;}
  u.rate=1.02;u.pitch=1.0;
  u.onend=()=>{if(typeof window.v3gamNotifyTtsEnd==='function')window.v3gamNotifyTtsEnd();};
  u.onerror=()=>{if(typeof window.v3gamNotifyTtsEnd==='function')window.v3gamNotifyTtsEnd();};
  window.speechSynthesis.speak(u);
 }catch(_){if(typeof window.v3gamNotifyTtsEnd==='function')window.v3gamNotifyTtsEnd();}
}
if('speechSynthesis' in window){window.speechSynthesis.onvoiceschanged=()=>{window.speechSynthesis.getVoices();};}
function bubble(who,text){const el=document.createElement('div');el.className='bubble '+who;if(who==='ai'){const l=document.createElement('span');l.className='ailabel';l.textContent='✦ V3GAM';el.appendChild(l)}el.appendChild(document.createTextNode(text));$('#chatWindow').appendChild(el);el.scrollIntoView({behavior:'smooth',block:'nearest'});if(who==='ai')speakV3GAM(text);}
let pendingDiffChanges=[];
function preview(customChanges,customReply){
 state.preview=true;
 const card=$('#diffCard');
 if(Array.isArray(customChanges)&&customChanges.length){
  pendingDiffChanges=customChanges;
  const rowsHtml=customChanges.map(c=>`<div class="diffrow"><div class="before">${String(c.task||'Task').replace(/</g,'&lt;')}<small>${String(c.from||'Current').replace(/</g,'&lt;')}</small></div><div class="arrow">→</div><div class="after">${String(c.task||'Task').replace(/</g,'&lt;')}<small>${String(c.to||'Proposed').replace(/</g,'&lt;')}</small></div></div>`).join('');
  card.innerHTML=`<div class="difftitle"><span>WHAT-IF PREVIEW</span><span style="color:var(--green)">${customChanges.length} proposed change(s)</span></div>`+rowsHtml;
 }else{
  pendingDiffChanges=[];
 }
 card.style.display='block';$('#applyDiffBtn').style.display='flex';
 bubble('ai',customReply||'Here’s a what-if: I can move the evening tasks to tomorrow and keep your current focus block untouched. Review the changes below before I apply them.');
}
$('#examplePrompt').addEventListener('click',()=>{bubble('user','Push everything after 6pm to tomorrow.');preview()});
if($('#replanCheckPrompt'))$('#replanCheckPrompt').addEventListener('click',async()=>{
 bubble('user','Check my overdue tasks and suggest a plan.');
 if(orbitDemoMode){preview();return;}
 try{
  const response=await orbitAuthorizedFetch('/api/assistant',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:'Check overdue tasks',proactive_check:true,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone||'Asia/Kolkata',workspace_id:orbitWorkspaceId})});
  const data=await response.json();
  if(data.action==='plan_change'&&Array.isArray(data.changes)&&data.changes.length){preview(data.changes,data.reply);}
  else{bubble('ai',data.reply||'Your schedule is all caught up!');}
 }catch(e){bubble('ai',e.message||'Could not check overdue tasks right now.');}
});
if($('#agentTtsToggle'))$('#agentTtsToggle').addEventListener('click',()=>{
 orbitVoiceTtsEnabled=!orbitVoiceTtsEnabled;
 const b=$('#agentTtsToggle');b.setAttribute('aria-pressed',String(orbitVoiceTtsEnabled));
 b.textContent=orbitVoiceTtsEnabled?'🔊 Voice: On':'🔇 Voice: Off';
 if(!orbitVoiceTtsEnabled&&'speechSynthesis' in window)window.speechSynthesis.cancel();
});
if($('#agentLangToggle'))$('#agentLangToggle').addEventListener('click',()=>{
 const order=['en-IN','hi-IN','gu-IN'];
 orbitVoiceLang=order[(order.indexOf(orbitVoiceLang)+1)%order.length];
 $('#agentLangToggle').textContent=orbitVoiceLang.toUpperCase();
 toast('Voice language set to '+orbitVoiceLang.toUpperCase());
});
if($('#agentElevenToggle'))$('#agentElevenToggle').addEventListener('click',()=>{
 orbitElevenLabsEnabled=!orbitElevenLabsEnabled;
 const b=$('#agentElevenToggle');b.setAttribute('aria-pressed',String(orbitElevenLabsEnabled));
 b.textContent=orbitElevenLabsEnabled?'11Labs: On':'11Labs: Off';
 orbitUpdateElevenLabsAvailability();
 toast(orbitElevenLabsEnabled?'ElevenLabs widget enabled (uses credits)':'ElevenLabs widget hidden — using free V3GAM Voice');
});
function assistantAddTask(raw){let title=raw.replace(/^(please\s+)?(orbit[,: ]*)?(can you\s+)?(add|create|schedule|plan|remind me to|put)\s+(me\s+)?(a\s+)?(new\s+)?(task\s+to\s+|task\s+for\s+|task\s+|to\s+)?/i,'').trim();title=title.replace(/\b(today|for today|tomorrow|for tomorrow)\b/ig,'').replace(/\b(for|in)\s+(30|45|60|90|120)\s*(minutes?|mins?|hours?|hrs?)\b/ig,'').replace(/\b(at|around)\s+\d{1,2}(:\d{2})?\s*(am|pm)?\b/ig,'').replace(/[.!?]+$/,'').trim();if(!title)title='New task';const dm=raw.match(/\b(30|45|60|90|120)\s*(minutes?|mins?|hours?|hrs?)\b/i);let duration=60;if(dm){duration=Number(dm[1]);if(/hours?|hrs?/i.test(dm[2]))duration*=60}let category='study';if(/gym|workout|exercise|walk|run|yoga/i.test(title))category='gym';else if(/lunch|dinner|breakfast|eat|meal/i.test(title))category='meal';else if(/lecture|class|attend/i.test(title))category='lecture';else if(/lab|project|report|assignment|code|build/i.test(title))category='lab';const tm=raw.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);let slot;if(tm){let h=Number(tm[1])%12;if(tm[3].toLowerCase()==='pm')h+=12;slot=String(h).padStart(2,'0')+':'+(tm[2]||'00')}else slot=taskSlot(/morning/i.test(raw)?'morning':/afternoon/i.test(raw)?'afternoon':/evening|tonight/i.test(raw)?'evening':'flexible',0);const day=/\btomorrow\b/i.test(raw)?1:0;const task={id:++state.id,title,category,duration,start:slot,status:'planned',day,detail:'Added by voice assistant'};tasks.push(task);renderTimeline();renderWeek();renderMonth();renderDashboard();bubble('ai','Added "'+task.title+'" to '+(day?'tomorrow':'today')+' at '+clock(slot)+' for '+duration+' minutes.');toast('Task added by voice ✦');return task}
function startAgentVoice(){const SR=window.SpeechRecognition||window.webkitSpeechRecognition;if(!SR){bubble('ai','Voice recognition is not supported in this browser. Try Chrome or Edge, allow microphone access, or type your command below.');return}try{if('speechSynthesis' in window)window.speechSynthesis.cancel();const rec=new SR();rec.lang=orbitVoiceLang||'en-IN';rec.interimResults=false;rec.maxAlternatives=1;$('#agentMic').classList.add('listening');$('#agentMic').textContent='●';$('#agentBtn').classList.add('listening');toast('Listening ('+rec.lang+')… speak now');rec.onresult=e=>{$('#agentInput').value=e.results[0][0].transcript;$('#agentMic').classList.remove('listening');$('#agentMic').textContent='🎙';$('#agentBtn').classList.remove('listening');sendMessage()};rec.onerror=e=>{$('#agentMic').classList.remove('listening');$('#agentMic').textContent='🎙';$('#agentBtn').classList.remove('listening');bubble('ai',e.error==='not-allowed'?'Microphone access is blocked. Allow it in browser settings, then try again.':'I couldn’t hear that clearly. Try again or type your request.')};rec.onend=()=>{$('#agentMic').classList.remove('listening');$('#agentMic').textContent='🎙';$('#agentBtn').classList.remove('listening')};rec.start()}catch(e){$('#agentMic').classList.remove('listening');$('#agentMic').textContent='🎙';$('#agentBtn').classList.remove('listening');bubble('ai','Could not start the microphone. Check browser permissions and try again.')}}
async function sendAssistantToBackend(message){
 const trimmedMsg=String(message||"").trim();
 if(pendingBackendProposal){
  if(/^(?:yes|yeah|yep|yup|sure|confirm|ok|okay|do it|go ahead)$/i.test(trimmedMsg)){
   const proposalToConfirm=pendingBackendProposal;
   pendingBackendProposal=null;
   try{
    const response=await orbitAuthorizedFetch("/api/assistant",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({message:"confirm",confirm:true,confirm_proposed:proposalToConfirm,proposed:proposalToConfirm,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone||"Asia/Kolkata",workspace_id:orbitWorkspaceId})});
    const data=await response.json();
    if(!response.ok)throw new Error(data.error||"Could not confirm action");
    if(data.task){
     const t=data.task,dt=t.starts_at?new Date(t.starts_at):null;
     const dueText=String(t.due_date||"").slice(0,10);
     let day=0;
     if(dueText.length===10&&dueText.charAt(4)==="-"&&dueText.charAt(7)==="-"){const dayDate=new Date(dueText+"T00:00:00");const todayDate=new Date();todayDate.setHours(0,0,0,0);dayDate.setHours(0,0,0,0);day=Math.round((dayDate-todayDate)/86400000);}
     const normCat=['study','lab','lecture','gym','meal','personal'].includes(String(t.category||"").toLowerCase())?String(t.category).toLowerCase():"personal";
     const local={id:Number(t.id)||++state.id,title:t.title,category:normCat,duration:Number(t.duration_minutes)||60,start:dt?String(dt.getHours()).padStart(2,"0")+":"+String(dt.getMinutes()).padStart(2,"0"):"11:00",status:t.status||"planned",day,detail:t.detail||"",serverId:t.id};
     const existingIndex=tasks.findIndex(x=>Number(x.serverId||x.id)===Number(t.id));
     if(existingIndex>=0)tasks[existingIndex]={...tasks[existingIndex],...local};else tasks.push(local);
     renderTimeline();renderWeek();renderMonth();renderDashboard();
     await orbitLoadTasks();
    }
    const rep=data.reply||"Confirmed.";
    bubble("ai",rep);toast(rep);
    return {ok:true,reply:rep,action:data.action||proposalToConfirm.action,confirmed:true,task:data.task};
   }catch(e){
    const errMsg=e.message||"Could not confirm action.";
    bubble("ai",errMsg);return {ok:false,reply:errMsg};
   }
  }
  if(/^(?:no|nope|nah|cancel|don't|do not|never mind|nevermind)$/i.test(trimmedMsg)){
   const oldProp=pendingBackendProposal;
   pendingBackendProposal=null;
   const cancelReply='Cancelled "'+(oldProp.title||"that action")+'" — no changes were made.';
   bubble("ai",cancelReply);toast(cancelReply);
   return {ok:true,reply:cancelReply,action:"cancelled"};
  }
  pendingBackendProposal=null;
 }
 const _ui=window.v3gamVoiceUi&&window.v3gamVoiceUi.tryText(message);if(_ui){bubble('ai',_ui.reply);toast(_ui.reply);return {ok:_ui.ok,reply:_ui.reply,action:_ui.command,...(_ui.pillTitle?{pillTitle:_ui.pillTitle}:{})}}if(orbitDemoMode){const dt=assistantAddTask(message);return {ok:true,reply:'Added "'+dt.title+'" to your demo schedule.',action:'add_task'}}try{if(!window.orbitSupabase){const m='Account services are still loading. Please try again.';bubble('ai',m);return {ok:false,reply:m}}const {data:{session}}=await window.orbitSupabase.auth.getSession();if(!session||!session.user){orbitAuthPanel.hidden=false;return {ok:false,reply:'Please sign in first.'}}const response=await orbitAuthorizedFetch('/api/assistant',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone||'Asia/Kolkata',workspace_id:orbitWorkspaceId})});const data=await response.json();if(!response.ok)throw new Error(data.error||'Assistant request failed');
 if(data.action==='confirm'&&data.proposed){
  pendingBackendProposal=data.proposed;
  const confirmReply=data.reply||('Confirm action on "'+(data.proposed.title||'task')+'"? Say yes to confirm, or no to cancel.');
  bubble('ai',confirmReply);toast(confirmReply);
  const pill=$('#v3gamLiveTranscriptPill'),tEl=$('#v3gamLivePillTitle'),bEl=$('#v3gamLivePillText');
  if(tEl)tEl.textContent='CONFIRM ACTION';
  if(bEl)bEl.textContent=confirmReply;
  if(pill)pill.classList.add('show');
  return {ok:true,reply:confirmReply,action:'confirm',proposed:data.proposed,pillTitle:'CONFIRM ACTION'};
 }
 if(data.task){
 const t=data.task,dt=t.starts_at?new Date(t.starts_at):null;try{window.v3gamVoiceUi&&window.v3gamVoiceUi.noteAdded&&window.v3gamVoiceUi.noteAdded(t.title)}catch(_){}
 const dueText=String(t.due_date||'').slice(0,10);
 let day=0;
 if(dueText.length===10&&dueText.charAt(4)==='-'&&dueText.charAt(7)==='-'){const dayDate=new Date(dueText+'T00:00:00');const todayDate=new Date();todayDate.setHours(0,0,0,0);dayDate.setHours(0,0,0,0);day=Math.round((dayDate-todayDate)/86400000);}
 const local={id:Number(t.id)||++state.id,title:t.title,category:['study','lab','lecture','gym','meal','personal'].includes(String(t.category||'').toLowerCase())?String(t.category).toLowerCase():'personal',duration:Number(t.duration_minutes)||60,start:dt?String(dt.getHours()).padStart(2,'0')+':'+String(dt.getMinutes()).padStart(2,'0'):'11:00',status:t.status||'planned',day,detail:t.detail||'',serverId:t.id};
 const existingIndex=tasks.findIndex(x=>Number(x.serverId||x.id)===Number(t.id));
 if(existingIndex>=0)tasks[existingIndex]={...tasks[existingIndex],...local};else tasks.push(local);
 renderTimeline();renderWeek();renderMonth();renderDashboard();
 await orbitLoadTasks();
}if(data.action==='switch_workspace'){await orbitLoadWorkspaces();await orbitSelectWorkspace(data.target_workspace_id===null||data.target_workspace_id===undefined?null:Number(data.target_workspace_id),data.workspace_name);bubble('ai',data.reply||'Switched workspace.');toast(data.reply||'Switched workspace ✦');return {ok:true,reply:data.reply||'Switched workspace.',action:'switch_workspace'}}if(data.action==='plan_change'){if(Array.isArray(data.changes)&&data.changes.length){preview(data.changes,data.reply);}else{bubble('ai',(data.reply||'Here is a proposed schedule change.')+' Please review before applying.');}return {ok:true,reply:data.reply||'Here is a proposed schedule change.',action:'plan_change'}}if(data.action==='ui_command'&&window.v3gamVoiceUi){const _r=window.v3gamVoiceUi.run(data.command,data.args||{});const _m=(_r.ok&&!['sign_out','fill_task_form','new_task_form','build_task_plan'].includes(data.command))?(data.reply||_r.reply):_r.reply;bubble('ai',_m);toast(_m);return {ok:_r.ok,reply:_m,action:'ui_command'}}if(data.action==='open_view'&&typeof data.view==='string'){orbitNavigateFromVoice(data.view);close('agentOverlay');}let finalReply=data.reply||'Done.';if((data.action==='clarify'||data.action==='help'||!data.action)&&/didn.?t (?:quite )?(?:catch|recogni[sz]e)|could not recogni[sz]e|i missed that/i.test(finalReply)&&window.v3gamVoiceUi&&window.v3gamVoiceUi.hint)finalReply=window.v3gamVoiceUi.hint();bubble('ai',finalReply);return {ok:data.action!=='clarify',reply:finalReply,action:data.action}}catch(e){const errMsg=e.message||'I did not recognise that command. Please say it again.';bubble('ai',errMsg);return {ok:false,reply:errMsg}}}
function sendMessage(){const text=$('#agentInput').value.trim();if(!text)return;$('#agentInput').value='';bubble('user',text);const _ui=window.v3gamVoiceUi&&window.v3gamVoiceUi.tryText(text);if(_ui){bubble('ai',_ui.reply);toast(_ui.reply);return}const q=text.toLowerCase();const bulkReschedule=q.includes('after 6')||q.includes('push everything')||q.includes('move everything')||((q.includes('tomorrow')||q.includes('next day'))&&(q.includes('everything')||q.includes('all tasks')||q.includes('all my tasks')));if(bulkReschedule&&orbitDemoMode){preview();return;}if(!orbitDemoMode&&orbitSessionActive){sendAssistantToBackend(text);return;}const routedIntent=['add ','create ','schedule ','remind me to','move ','reschedule ','shift ','change the time','change time'].some(term=>q.includes(term));if(bulkReschedule)preview();else if(routedIntent){sendAssistantToBackend(text)}else if(q.includes('snooze')){const t=tasks.find(x=>x.status==='active'&&x.day===0)||tasks.find(x=>x.day===0&&x.status==='planned');if(t){t.start=clock(mins(t.start)+10);t.status='planned';renderTimeline();renderWeek();bubble('ai','Snoozed "'+t.title+'" by 10 minutes.')}else bubble('ai','I could not find a task to snooze today.')}else if(q.includes('skip')){const t=tasks.find(x=>x.status==='active'&&x.day===0)||tasks.find(x=>x.day===0&&x.status==='planned');if(t){t.status='skipped';renderTimeline();renderWeek();renderMonth();bubble('ai','Skipped "'+t.title+'". You can reschedule it anytime.')}else bubble('ai','There are no pending tasks to skip today.')}else if(q.includes('done')||q.includes('complete')||q.includes('finished')){const t=tasks.find(x=>x.status==='active'&&x.day===0)||tasks.find(x=>x.day===0&&x.status==='planned');if(t){t.status='done';renderTimeline();renderWeek();renderMonth();renderDashboard();bubble('ai','Marked "'+t.title+'" complete. Nice work!')}else bubble('ai','You are all caught up on today’s tasks.')}else if(q.includes('habit')){close('agentOverlay');go('plan');$$('[data-plan]').forEach(b=>{b.classList.toggle('active',b.dataset.plan==='daily');b.setAttribute('aria-selected',b.dataset.plan==='daily'?'true':'false')});$('#weekPane').style.display='none';$('#monthPane').style.display='none';$('#dailyPane').style.display='block';renderHabitMatrix();bubble('ai','Opened Daily habits. Use Manage habits to customize your routine.')}else if(q.includes('week')||q.includes('month')||q.includes('daily view')||q.includes('plan view')){close('agentOverlay');go('plan');const view=q.includes('month')?'month':q.includes('week')?'week':'daily';$$('[data-plan]').forEach(b=>{b.classList.toggle('active',b.dataset.plan===view);b.setAttribute('aria-selected',b.dataset.plan===view?'true':'false')});$('#weekPane').style.display=view==='week'?'block':'none';$('#monthPane').style.display=view==='month'?'block':'none';$('#dailyPane').style.display=view==='daily'?'block':'none';if(view==='week')renderWeek();if(view==='month')renderMonth();if(view==='daily')renderHabitMatrix();bubble('ai','Opened your '+view+' plan view.')}else if(q.includes('after 6')||q.includes('move')||q.includes('reschedule'))preview();else bubble('ai','I can add tasks by voice, mark tasks done, snooze or skip, open daily/weekly/monthly plans, manage habits, or move evening tasks. Try "add today’s task: study ADA for 1 hour."')}
$('#sendAgent').addEventListener('click',sendMessage);$('#agentMic').addEventListener('click',startAgentVoice);$('#agentInput').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();sendMessage()}});
$('#applyDiffBtn').addEventListener('click',async()=>{
 const btn=$('#applyDiffBtn');btn.disabled=true;
 try{
  if(!orbitDemoMode&&orbitSessionActive){
   const todayStr=new Date().toLocaleDateString('en-CA');
   const tmrw=new Date();tmrw.setDate(tmrw.getDate()+1);const tmrwStr=tmrw.toLocaleDateString('en-CA');
   let updatedCount=0;
   if(pendingDiffChanges.length){
    for(const ch of pendingDiffChanges){
     const tid=Number(ch.task_id||tasks.find(x=>x.title.toLowerCase()===String(ch.task||'').toLowerCase())?.serverId||0);
     if(tid>0){
      const targetDate=/tomorrow/i.test(String(ch.to||''))?tmrwStr:todayStr;
      await orbitAuthorizedFetch('/api/tasks?id='+encodeURIComponent(tid)+(orbitWorkspaceId!==null?'&workspace_id='+encodeURIComponent(orbitWorkspaceId):''),{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({due_date:targetDate})});
      updatedCount++;
     }
    }
   }else{
    const movable=tasks.filter(t=>t.day===0&&mins(t.start)>=1080&&t.status!=='done'&&(t.serverId||t.id));
    for(const t of movable){
     const tid=Number(t.serverId||t.id);
     await orbitAuthorizedFetch('/api/tasks?id='+encodeURIComponent(tid)+(orbitWorkspaceId!==null?'&workspace_id='+encodeURIComponent(orbitWorkspaceId):''),{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({due_date:tmrwStr})});
     updatedCount++;
    }
   }
   await orbitLoadTasks();
   pendingDiffChanges=[];
   close('agentOverlay');$('#diffCard').style.display='none';$('#applyDiffBtn').style.display='none';
   bubble('ai','All set! Applied '+updatedCount+' schedule update(s) to your saved plan.');
   toast(updatedCount+' task(s) updated in your plan ✦');
   return;
  }
  const movable=tasks.filter(t=>t.day===0&&mins(t.start)>=1080&&t.status!=='done');movable.forEach(t=>t.day=1);close('agentOverlay');renderTimeline();renderWeek();renderMonth();$('#diffCard').style.display='none';$('#applyDiffBtn').style.display='none';bubble('ai','All set. Your evening tasks are now on tomorrow’s plan. Today has more room to breathe.');toast(movable.length+' tasks moved to tomorrow ✦');
 }catch(e){toast(e.message||'Could not apply schedule changes');}
 finally{btn.disabled=false;}
});
$('#focusVoice').addEventListener('click',()=>{const SR=window.SpeechRecognition||window.webkitSpeechRecognition;if(SR){try{const rec=new SR();rec.lang='en-US';rec.onresult=e=>{const s=e.results[0][0].transcript.toLowerCase();if(s.includes('done'))actionTask('done');else if(s.includes('snooze'))actionTask('snooze');else if(s.includes('skip'))actionTask('skip');else toast('Try “done”, “snooze”, or “skip”')};rec.onerror=()=>toast('Voice input is unavailable on this device');rec.start();toast('Listening for done, snooze, or skip…')}catch(e){toast('Try “done”, “snooze”, or “skip”')}}else if('speechSynthesis'in window){const u=new SpeechSynthesisUtterance('Say done, snooze ten minutes, or skip.');speechSynthesis.speak(u);toast('Voice hint played')}else toast('Try “done”, “snooze”, or “skip”')});
$('#focusOverlay').addEventListener('click',e=>{if(e.target===$('#focusOverlay'))close('focusOverlay')});
document.addEventListener('keydown',e=>{if(e.key==='Escape'){close('focusOverlay');close('agentOverlay')}});
const weekHead=$('.weekhead'),weekGrid=$('#weekGrid');let syncingWeek=false;[weekHead,weekGrid].forEach(el=>el.addEventListener('scroll',()=>{if(syncingWeek)return;syncingWeek=true;(el===weekHead?weekGrid:weekHead).scrollLeft=el.scrollLeft;syncingWeek=false},{passive:true}));
let orbitAuthMode='login', orbitAuthReady=false, orbitPendingEmail='';
const orbitAuthPanel=document.getElementById('orbitAuth'), orbitAuthMessage=document.getElementById('orbitAuthMessage');
function orbitAuthNotice(message,error=false){orbitAuthMessage.textContent=message;orbitAuthMessage.classList.toggle('auth-error',error);}
function orbitSetAuthMode(mode){
 orbitAuthMode=mode;orbitAuthNotice('');
 const signup=mode==='signup',reset=mode==='reset',verify=mode==='verify',recoveryOtp=mode==='recoveryOtp',update=mode==='update';
 const needsOtp=verify||recoveryOtp;
 document.getElementById('orbitUsernameWrap').hidden=!signup;
 document.getElementById('orbitUsername').required=signup;
 document.getElementById('orbitOtpWrap').hidden=!needsOtp;
 document.getElementById('orbitEmail').readOnly=needsOtp||update;
 document.getElementById('orbitPasswordWrap').hidden=reset||verify||recoveryOtp;
 document.getElementById('orbitEmailOtp').required=needsOtp;
 document.getElementById('orbitEmailOtp').value='';
 document.getElementById('orbitAuthTitle').textContent=signup?'Create your V3GAM account':verify?'Verify your email':recoveryOtp?'Verify password reset code':reset?'Reset your password':update?'Choose a new password':'Your day, in flow.';
 document.getElementById('orbitAuthSubtitle').textContent=signup?'Enter your email and password. We’ll send a one-time code to your inbox to finish creating your account.':verify?'Enter the one-time code sent to '+orbitPendingEmail+'.':recoveryOtp?'Enter the password-reset code sent to '+orbitPendingEmail+'.':reset?'Enter your email and we’ll send a password-reset code.':update?'Enter a new password for your V3GAM account.':'Sign in to keep your tasks and routines private, synced, and ready on every visit.';
 document.getElementById('orbitPassword').required=!(reset||verify||recoveryOtp);
 document.getElementById('orbitPassword').autocomplete=signup||update?'new-password':reset||verify||recoveryOtp?'off':'current-password';
 document.getElementById('orbitAuthSubmit').textContent=signup?'Send verification code':verify||recoveryOtp?'Verify code':reset?'Send reset code':update?'Update password':'Sign in';
 document.getElementById('orbitAuthSwitch').textContent=signup?'Already have an account? Sign in':needsOtp?'Use a different email':'New here? Create an account';
 document.getElementById('orbitAuthForgot').hidden=signup||needsOtp||reset||update;
}
document.getElementById('orbitAuthSwitch').addEventListener('click',()=>orbitSetAuthMode(orbitAuthMode==='signup'?'login':'signup'));
document.getElementById('orbitAuthForgot').addEventListener('click',()=>orbitSetAuthMode('reset'));
async function orbitCompleteSignedInBootstrap(session){
 if(!session||!session.user)return;
 orbitSessionActive=true;
 orbitDemoMode=false;
 window._orbitSignedInBootstrapped=true;
 orbitUserId=session.user.id||"";
 orbitUserEmail=session.user.email||"";
 if(window.v3gamAdaptiveLayer&&typeof window.v3gamAdaptiveLayer.setUser==="function"){
  window.v3gamAdaptiveLayer.setUser(orbitUserId||orbitUserEmail);
 }
 orbitUpdateElevenLabsAvailability();
 orbitUpdateGreeting(session.user);
 orbitLoadHabitScope();
 if(orbitAuthPanel)orbitAuthPanel.hidden=true;
 const signOutBtn=document.getElementById("orbitSignOut");
 if(signOutBtn)signOutBtn.hidden=false;
 const demoToggle=document.getElementById("demoToggle");
 if(demoToggle){demoToggle.textContent="▷ Demo";demoToggle.classList.remove("is-demo");}
 const demoExit=document.getElementById("demoExitFloating");
 if(demoExit){demoExit.hidden=true;demoExit.classList.remove("visible");}
 orbitAuthNotice("");
 orbitBootstrapInFlight=true;
 try{
  await orbitRestoreWorkspaceSelection();
  await orbitLoadTasks();
  await orbitLoadNotifications();
  orbitCheckUpcomingReminders();
  orbitStartReminderPolling();
 }catch(err){
  orbitAuthNotice((err&&err.message)||"Could not load your workspace data.",true);
 }finally{
  orbitBootstrapInFlight=false;
  go("home");
 }
}
window.addEventListener("load",()=>{
 const hash=location.hash||"",query=new URLSearchParams(location.search);
 if(hash.includes("type=recovery")||query.get("type")==="recovery"){
  orbitSetAuthMode("update");orbitAuthPanel.hidden=false;
  orbitAuthNotice("Recovery link recognized. Enter your new password.");return;
 }
 if(query.get("mode")==="signup"){
  orbitSetAuthMode("signup");orbitAuthPanel.hidden=false;
  orbitAuthPanel.setAttribute("data-entry-mode","signup");
 }
});
document.getElementById("orbitAuthForm").addEventListener("submit",async e=>{
 e.preventDefault();
 if(!window.orbitSupabase){orbitAuthNotice("Authentication setup is not complete yet. Please try again later.",true);return;}
 const email=document.getElementById("orbitEmail").value.trim(),password=document.getElementById("orbitPassword").value,username=document.getElementById("orbitUsername").value.trim();
 if(orbitAuthMode==="signup"&&(username.length<3||username.length>24||!Array.from(username).every(ch=>/[A-Za-z0-9_.-]/.test(ch)))){
  orbitAuthNotice("Choose a username with 3-24 letters, numbers, dots, underscores, or hyphens.",true);return;
 }
 const submit=document.getElementById("orbitAuthSubmit");submit.disabled=true;submit.textContent="Please wait…";orbitAuthNotice("");
 try{
  let result;
  if(orbitAuthMode==="signup"){
   orbitPendingEmail=email;orbitPendingPassword=password;
   result=await window.orbitSupabase.auth.signUp({email,password,options:{data:{app:"v3gam",username,display_name:username,name:username},emailRedirectTo:location.origin}});
  }else if(orbitAuthMode==="verify"){
   const token=document.getElementById("orbitEmailOtp").value.trim();
   result=await window.orbitSupabase.auth.verifyOtp({email:orbitPendingEmail||email,token,type:"signup"});
  }else if(orbitAuthMode==="reset"){
   orbitPendingEmail=email;
   result=await window.orbitSupabase.auth.resetPasswordForEmail(email,{redirectTo:location.origin});
  }else if(orbitAuthMode==="recoveryOtp"){
   const token=document.getElementById("orbitEmailOtp").value.trim();
   result=await window.orbitSupabase.auth.verifyOtp({email:orbitPendingEmail||email,token,type:"recovery"});
  }else if(orbitAuthMode==="update"){
   result=await window.orbitSupabase.auth.updateUser({password});
  }else{
   const response=await fetch("/api/login",{method:"POST",headers:{"Content-Type":"application/json","Accept":"application/json"},credentials:"same-origin",cache:"no-store",body:JSON.stringify({email,password})});
   const payload=await response.json().catch(()=>({}));
   if(!response.ok)throw Object.assign(new Error(payload.error||"Authentication failed. Please try again."),{status:response.status});
   if(!payload.session?.access_token||!payload.session?.refresh_token)throw new Error("Authentication returned an invalid session.");
   result=await window.orbitSupabase.auth.setSession({access_token:payload.session.access_token,refresh_token:payload.session.refresh_token});
  }
  if(result.error)throw result.error;
  if(orbitAuthMode==="signup"){
   orbitSetAuthMode("verify");document.getElementById("orbitEmail").value=orbitPendingEmail;
   orbitAuthNotice("Verification code sent. Check your inbox and enter the code to finish registration.");
  }else if(orbitAuthMode==="verify"){
   orbitPendingPassword="";orbitAuthNotice("Email verified! Your V3GAM account is ready.");
   if(result.data?.session){await orbitCompleteSignedInBootstrap(result.data.session);}
   else{orbitSetAuthMode("login");document.getElementById("orbitEmail").value=orbitPendingEmail;orbitAuthNotice("Email verified! Sign in with your new account.");}
  }else if(orbitAuthMode==="reset"){
   orbitSetAuthMode("recoveryOtp");document.getElementById("orbitEmail").value=orbitPendingEmail;document.getElementById("orbitEmail").readOnly=true;
   orbitAuthNotice("If an account exists for that email, a password-reset code has been sent. Enter the code from your email.");
  }else if(orbitAuthMode==="recoveryOtp"){
   orbitSetAuthMode("update");document.getElementById("orbitEmail").value=orbitPendingEmail;document.getElementById("orbitEmail").readOnly=true;
   orbitAuthNotice("Code verified. Enter your new password.");
  }else if(orbitAuthMode==="update"){
   orbitAuthNotice("Password updated. You can now sign in with your new password.");
   await window.orbitSupabase.auth.signOut();orbitSetAuthMode("login");document.getElementById("orbitEmail").value=orbitPendingEmail;
  }else if(result.data?.session){
   await orbitCompleteSignedInBootstrap(result.data.session);
  }else{
   orbitAuthNotice("Check your email for the verification link, then sign in.");
  }
 }catch(err){
  orbitAuthNotice(err.message||"Authentication failed. Please try again.",true);
 }finally{
  submit.disabled=false;
  submit.textContent=orbitAuthMode==="signup"?"Send verification code":orbitAuthMode==="verify"||orbitAuthMode==="recoveryOtp"?"Verify code":orbitAuthMode==="reset"?"Send reset code":orbitAuthMode==="update"?"Update password":"Sign in";
 }
});
(async function initV3GAMSupabaseAuth(){
 try{
  const response=await fetch("/api/auth-config",{cache:"no-store"}),config=await response.json();
  if(!response.ok||!config.url||!config.key)throw new Error(config.error||"Supabase settings are missing.");
  if(!window.supabase?.createClient)throw new Error("Could not load the secure authentication client. Refresh the page.");
  window.orbitSupabase=window.supabase.createClient(config.url,config.key,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,flowType:"pkce"}});
  const {data:{session},error}=await window.orbitSupabase.auth.getSession();
  if(error)throw error;
  if(session){
   await orbitCompleteSignedInBootstrap(session);
  }else{
   orbitSessionActive=false;window._orbitSignedInBootstrapped=false;orbitUserId="";orbitUserEmail="";orbitWorkspaceId=null;orbitLoadHabitScope();
   document.getElementById("orbitSignOut").hidden=true;
   if(!orbitDemoMode){orbitAuthPanel.hidden=false;tasks.splice(0,tasks.length);refreshTaskViews();}
  }
  orbitUpdateElevenLabsAvailability();
  window.orbitSupabase.auth.onAuthStateChange((event,session)=>{
   if(event==="SIGNED_IN"&&session){
    setTimeout(()=>{orbitCompleteSignedInBootstrap(session);},0);
   }
   if(event==="SIGNED_OUT"){
    orbitSessionActive=false;window._orbitSignedInBootstrapped=false;
    if(window.v3gamAdaptiveLayer&&typeof window.v3gamAdaptiveLayer.clearOnSignOut==="function"){
     window.v3gamAdaptiveLayer.clearOnSignOut();
    }
    orbitUpdateElevenLabsAvailability();orbitUserId="";orbitUserEmail="";orbitDisplayName="";
    if(orbitReminderInterval){clearInterval(orbitReminderInterval);orbitReminderInterval=null;}
    orbitWorkspaceId=null;orbitWorkspaces=[];$("#groupManagementDashboard").hidden=true;$("#dashboardGroupMembers").innerHTML="";$("#dashboardGroupInviteCode").textContent="";
    orbitLoadHabitScope();$("#workspaceName").textContent="V3GAM Pro";$("#workspaceSubtitle").textContent="Personal workspace";$("#groupWorkspaceItems").innerHTML="";
    document.getElementById("orbitSignOut").hidden=true;
    if(!orbitDemoMode){tasks.splice(0,tasks.length);orbitAuthPanel.hidden=false;refreshTaskViews();}
   }
   if(event==="PASSWORD_RECOVERY"){orbitSessionActive=true;orbitSetAuthMode("update");orbitAuthPanel.hidden=false;}
  });
 }catch(err){
  if(!orbitDemoMode){orbitAuthPanel.hidden=false;orbitAuthNotice(err.message||"Supabase is not configured. Set up your project to enable accounts.",true);}
 }
})();
document.getElementById('orbitSignOut').addEventListener('click',async()=>{
 try{window._orbitSignedInBootstrapped=false;await window.orbitSupabase?.auth.signOut();document.getElementById('orbitSignOut').hidden=true;orbitAuthPanel.hidden=false;orbitSetAuthMode('login');}
 catch(e){toast('Could not sign out. Please try again.')}
});
async function orbitAuthorizedFetch(url,options={}){
 const {data:{session}}=await window.orbitSupabase.auth.getSession();
 if(!session?.access_token){orbitAuthPanel.hidden=false;throw new Error('Please sign in again.');}
 const headers={...(options.headers||{}),Authorization:'Bearer '+session.access_token};
 return fetch(url,{...options,headers});
}
async function orbitLoadTasks(){
 if(orbitDemoMode||!orbitSessionActive)return;
 const requestedWorkspaceId=orbitWorkspaceId;
 try{
  const path='/api/tasks'+(requestedWorkspaceId!==null?'?workspace_id='+encodeURIComponent(requestedWorkspaceId):'');const r=await orbitAuthorizedFetch(path);const data=await r.json();if(!r.ok)throw new Error(data.error||'Could not load tasks');
  if(orbitDemoMode||!orbitSessionActive||orbitWorkspaceId!==requestedWorkspaceId)return;
  const today=new Date();today.setHours(0,0,0,0);
  const mapped=(data.tasks||[]).map(t=>{
   const d=t.due_date?new Date(String(t.due_date).slice(0,10)+'T00:00:00'):new Date(today);
   const day=Math.round((d-today)/86400000),dt=t.starts_at?new Date(t.starts_at):null;
   return {id:Number(t.id),serverId:t.id,workspaceId:t.workspace_id||null,title:t.title,category:t.category||'study',duration:Number(t.duration_minutes)||60,start:dt&&!Number.isNaN(dt.getTime())?String(dt.getHours()).padStart(2,'0')+':'+String(dt.getMinutes()).padStart(2,'0'):'11:00',status:t.status||'planned',day,detail:t.detail||''};
  });
  tasks.splice(0,tasks.length,...mapped);state.id=Math.max(state.id,...mapped.map(t=>t.id||0),0);
  renderTimeline();renderWeek();renderMonth();renderHabitMatrix();renderDashboard();
 }catch(e){if(!String(e.message||'').includes('sign in'))toast('Could not sync your tasks: '+e.message);if(orbitBootstrapInFlight)throw e;}
}
function orbitNavigateFromVoice(view){
 const v=String(view||'today').toLowerCase();
 if(v.includes('workspace')||v.includes('group')){go('workspace');return;}
 if(v.includes('add')){go('add');return;}
 if(v.includes('progress')||v.includes('insight')||v.includes('stats')){go('stats');return;}
 if(v.includes('today')&&!v.includes('plan')){go('home');return;}
 go('plan');
 const selected=v.includes('month')?'month':(v.includes('week')?'week':'daily');
 $$('[data-plan]').forEach(b=>{b.classList.toggle('active',b.dataset.plan===selected);b.setAttribute('aria-selected',b.dataset.plan===selected?'true':'false');});
 $('#weekPane').style.display=selected==='week'?'block':'none';
 $('#monthPane').style.display=selected==='month'?'block':'none';
 $('#dailyPane').style.display=selected==='daily'?'block':'none';
 if(selected==='week')renderWeek();
 if(selected==='month')renderMonth();
 if(selected==='daily')renderHabitMatrix();
}
window.v3gamTaskTools={
 resetDemoSeed(){
  orbitDemoMode=true;
  orbitWorkspaces.splice(0,orbitWorkspaces.length);
  orbitWorkspaceId=null;
  tasks.splice(0,tasks.length,...demoTasks.map(t=>({...t,serverId:undefined})));
  state.id=Math.max(20,...tasks.map(t=>Number(t.id)||0));
  state.pending=null;state.pendingDayOffset=0;
  habits=defaultHabits.map(h=>({...h}));
  habitChecks=Object.create(null);
  orbitSaveHabitScope();
  orbitRenderWorkspaceMenuItems();
  $("#workspaceName").textContent="V3GAM Pro";
  $("#workspaceSubtitle").textContent="Personal workspace";
  $("#dashboardTitle").textContent="Personal workspace";
  $("#orbitAuth").hidden=true;
  if($("#taskForm"))$("#taskForm").reset();
  if($("#parsedCard"))$("#parsedCard").classList.remove("show");
  refreshHabitViews();
  refreshTaskViews();
  go("home");
  return true;
 },
 setHabitCheckForOffset(dayOffsetFromToday,habitIndex,done){
  const d=new Date(date.getFullYear(),date.getMonth(),date.getDate());
  d.setDate(d.getDate()+Number(dayOffsetFromToday||0));
  if(habitIndex>=0&&habitIndex<habits.length){
   setHabitDone(d,Number(habitIndex),Boolean(done));
   refreshHabitViews();
   return true;
  }
  return false;
 },
 find(q){const n=String(q||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();if(!n)return[];const k=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();const list=tasks.filter(t=>t&&t.title&&t.status!=='skipped');const exact=list.filter(t=>k(t.title)===n);const pool=exact.length?exact:list.filter(t=>{const m=k(t.title);return m.includes(n)||(m.length>=3&&n.includes(m))});return pool.map(t=>{let when='';try{when=t.start?clock(t.start):''}catch(_){}return {id:t.id,title:t.title,when,start:t.start,duration:t.duration,category:t.category,day:t.day,status:t.status,exact:k(t.title)===n}})},
 getTaskSnapshot(){return getWorkspaceTaskSnapshot()},
 completeSignedInBootstrap(session){return orbitCompleteSignedInBootstrap(session)},
 sendAssistantToBackend(msg){return sendAssistantToBackend(msg)},
 getPendingBackendProposal(){return pendingBackendProposal},
 setTaskStatus(id,status){const t=tasks.find(x=>Number(x.id)===Number(id));if(!t)return false;t.status=status;refreshTaskViews();return true},
 listAll(){return getWorkspaceTaskSnapshot().allActive},
 listToday(){return getWorkspaceTaskSnapshot().todayAll},
 createDirect(spec){const localTask={id:++state.id,title:String(spec.title||'New task').trim(),category:spec.category||'study',duration:Number(spec.duration)||60,start:spec.start||'09:00',status:'planned',day:Number(spec.day)||0,detail:spec.detail||''};tasks.push(localTask);refreshTaskViews();return localTask},
 move(id,updates={}){const t=tasks.find(x=>Number(x.id)===Number(id));if(!t)return null;const prev={id:t.id,title:t.title,day:t.day,start:t.start,when:t.start?clock(t.start):''};if(updates.day!==undefined)t.day=Number(updates.day);if(updates.start)t.start=String(updates.start);if(updates.deltaMinutes){const m=Math.max(0,Math.min(1435,mins(t.start||'09:00')+Number(updates.deltaMinutes)));t.start=String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0');}refreshTaskViews();return {prev,current:{id:t.id,title:t.title,day:t.day,start:t.start,when:t.start?clock(t.start):''}}},
 getWorkspaces(){return orbitWorkspaces.map(w=>({id:w.id,name:w.name,role:w.role}))},
 createWorkspaceLocal(name){const w={id:Date.now()+Math.floor(Math.random()*1000),name:String(name||'Group').trim(),role:'owner',member_count:1,invite_code:'V3GAM'+Math.random().toString(36).slice(2,8).toUpperCase()};orbitWorkspaces.push(w);orbitRenderWorkspaceMenuItems();orbitSelectWorkspace(w.id,w.name,false);return w},
 removeWorkspaceLocal(name){const q=String(name||'').trim().toLowerCase();const idx=orbitWorkspaces.findIndex(w=>String(w.name||'').toLowerCase()===q);if(idx<0)return false;const removed=orbitWorkspaces.splice(idx,1)[0];orbitRenderWorkspaceMenuItems();if(String(orbitWorkspaceId)===String(removed.id))orbitSelectWorkspace(null,'Personal workspace',false);return true},
 async remove(id){const t=tasks.find(x=>x.id===id);if(!t)throw new Error('That task is no longer in your plan.');
  if(!(orbitDemoMode||!orbitSessionActive||!t.serverId)){const q='/api/tasks?id='+encodeURIComponent(t.serverId)+(orbitWorkspaceId!==null?'&workspace_id='+encodeURIComponent(orbitWorkspaceId):'');const r=await orbitAuthorizedFetch(q,{method:'DELETE'});let d={};try{d=await r.json()}catch(_){}if(!r.ok)throw new Error(d.error||'The server refused to delete it.')}
  const i=tasks.indexOf(t);if(i>=0)tasks.splice(i,1);refreshTaskViews();return true}
};
window.v3gamLiveAgent={
 isReady:()=>!!(orbitSessionActive||orbitDemoMode),
 getLang:()=>orbitVoiceLang||'en-IN',
 speak:(text)=>speakV3GAM(text),
 toast:(msg)=>toast(msg),
 runLiveCommand:async(text)=>{
  const msg=String(text||'').trim();if(!msg)return {ok:false,reply:'Empty command'};
  return await sendAssistantToBackend(msg);
 }
};
renderTimeline();renderWeek();renderMonth();renderHabitMatrix();renderBars();renderDashboard();

})();
