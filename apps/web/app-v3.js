(()=>{
  const h=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]??c));
  const nativeNotification=window.Notification;
  const seenApprovals=new Set(),seenOauth=new Set();
  let dashboardBusy=false,requestBusy=false,latestApprovals=[];
  const getJson=async path=>{const response=await fetch(path,{headers:{accept:'application/json'},cache:'no-store'});if(!response.ok)throw new Error(`HTTP ${response.status}`);return response.json();};
  const localTime=value=>{if(!value)return'—';const d=new Date(value);return Number.isNaN(d.getTime())?String(value):d.toLocaleString();};
  const duration=seconds=>{seconds=Math.max(0,Number(seconds)||0);const d=Math.floor(seconds/86400),h=Math.floor(seconds%86400/3600),m=Math.floor(seconds%3600/60),s=Math.floor(seconds%60);if(d)return`${d}d ${h}h`;if(h)return`${h}h ${m}m`;if(m)return`${m}m ${s}s`;return`${s}s`;};
  const activeDashboard=()=>document.querySelector('#page')?.dataset.uiV2==='dashboard';
  const toast=(message,kind='info',timeout=7000)=>window.aevraUi?.toast?.(message,kind,timeout);

  function suppressLegacyRequestNotifications(){
    if(nativeNotification){
      try{
        function AevraNotification(title,options){if(/^Aevra (?:connection|workspace access|approval) request$/i.test(String(title)))return{close(){}};return new nativeNotification(title,options);}
        Object.defineProperty(AevraNotification,'permission',{get:()=>nativeNotification.permission});AevraNotification.requestPermission=(...args)=>nativeNotification.requestPermission(...args);window.Notification=AevraNotification;
      }catch{}
    }
    new MutationObserver(records=>{for(const record of records)for(const node of record.addedNodes){if(!(node instanceof Element))continue;const text=node.matches?.('.toast')?node.querySelector('.toast-message')?.textContent:node.querySelector?.('.toast .toast-message')?.textContent;if(text&&/^Incoming (?:OAuth connection|workspace access|approval) request/i.test(text))node.closest?.('.toast')?.remove();}}).observe(document.documentElement,{childList:true,subtree:true});
  }

  function browserNotify(title,body){if(!nativeNotification||nativeNotification.permission!=='granted')return;try{new nativeNotification(title,{body,tag:`aevra-detail-${title}-${body.slice(0,80)}`});}catch{}}
  function presentationText(item){const p=item?.presentation??{};return[p.action,p.target,p.preview].filter(Boolean).join(' · ')||item?.operation?.family||'Approval request';}

  async function refreshDetailedRequests(){
    if(requestBusy)return;requestBusy=true;
    try{
      const [approvals,oauth]=await Promise.all([getJson('/api/approvals'),getJson('/api/oauth/requests')]);latestApprovals=approvals;const pending=approvals.filter(item=>item.state==='PENDING');
      for(const item of pending){const id=String(item.id);if(seenApprovals.has(id))continue;seenApprovals.add(id);const title=item.presentation?.title||'Aevra approval request',body=`${String(item.actor||'Remote AI')}: ${presentationText(item)}`;toast(`${title}: ${body}`,'info',7600);browserNotify(`Aevra: ${title}`,body);}
      for(const item of oauth){const id=String(item.id);if(seenOauth.has(id))continue;seenOauth.add(id);const client=item.clientName??item.clientId??'Remote AI',scopes=(item.requestedScopes??item.scopes??[]).join(', ')||'mcp';const body=`${client} wants to connect · scopes: ${scopes}`;toast(`OAuth connection request: ${body}`,'info',7600);browserNotify('Aevra: OAuth connection request',body);}
      const liveApprovals=new Set(pending.map(item=>String(item.id))),liveOauth=new Set(oauth.map(item=>String(item.id)));for(const id of [...seenApprovals])if(!liveApprovals.has(id))seenApprovals.delete(id);for(const id of [...seenOauth])if(!liveOauth.has(id))seenOauth.delete(id);decorateRequestDrawer(approvals);
    }catch{}finally{requestBusy=false;}
  }

  function notificationButtonText(){if(!nativeNotification)return'Browser notifications unavailable';if(nativeNotification.permission==='granted')return'Browser notifications enabled';if(nativeNotification.permission==='denied')return'Browser notifications blocked';return'Enable browser notifications';}
  function ensureNotificationButton(){
    const header=document.querySelector('#request-drawer aside>header');if(!header||header.querySelector('#enable-browser-notifications'))return;const button=document.createElement('button');button.type='button';button.id='enable-browser-notifications';button.className='request-notification-button';button.textContent=notificationButtonText();button.disabled=!nativeNotification||nativeNotification.permission==='granted'||nativeNotification.permission==='denied';
    button.addEventListener('click',async()=>{if(!nativeNotification)return;const permission=await nativeNotification.requestPermission();button.textContent=notificationButtonText();button.disabled=permission!=='default';toast(permission==='granted'?'Browser notifications enabled':'Browser notifications were not enabled',permission==='granted'?'success':'info',4200);});header.querySelector('[data-close-requests]')?.before(button);
  }

  function commandPermissionMatcher(item){return String(item?.payload?.permissionMatcher??item?.payload?.original?.permissionMatcher??item?.operation?.family??'');}
  function decorateRequestDrawer(approvals){
    ensureNotificationButton();const byId=new Map(approvals.map(item=>[String(item.id),item]));
    for(const card of document.querySelectorAll('#request-drawer .request-card')){
      const button=card.querySelector('[data-request-approve],[data-request-deny]');const id=button?.dataset.requestApprove??button?.dataset.requestDeny;if(!id)continue;const item=byId.get(String(id));if(!item)continue;const p=item.presentation??{},isCommand=item.operation?.capability==='commands.run',permissionMatcher=isCommand?commandPermissionMatcher(item):'';const heading=card.querySelector('.request-card-head b');if(heading&&p.title&&heading.textContent!==p.title)heading.textContent=p.title;
      let detail=card.querySelector('.request-detail');if(!detail){detail=document.createElement('div');detail.className='request-detail';card.querySelector('.request-actions')?.before(detail);}const markup=`<b>${h(p.action??item.operation?.family??'Operation')}</b><span>${h(p.target??'')}</span>${p.preview?`<code>${h(p.preview)}</code>`:''}${permissionMatcher?`<span class="request-saved-matcher"><strong>Saved matcher</strong><code>${h(permissionMatcher)}</code></span>`:''}`;if(detail.innerHTML!==markup)detail.innerHTML=markup;
      if(!isCommand)continue;const actions=card.querySelector('.request-actions');if(!actions)continue;const persistent=[...actions.querySelectorAll('[data-request-approve][data-scope="session"],[data-request-approve][data-scope="workspace"],[data-request-approve][data-scope="global"]')];
      if(item.risk==='CRITICAL'){for(const action of persistent)action.remove();continue;}
      const session=actions.querySelector('[data-request-approve][data-scope="session"]');if(session&&session.textContent!=='Allow this session')session.textContent='Allow this session';
      const workspace=actions.querySelector('[data-request-approve][data-scope="workspace"]');if(workspace&&workspace.textContent!=='Always in workspace')workspace.textContent='Always in workspace';
      let global=actions.querySelector('[data-request-approve][data-scope="global"]');if(!global){global=document.createElement('button');global.type='button';global.dataset.requestApprove=String(id);global.dataset.scope='global';global.setAttribute('data-scope','global');global.textContent='Always globally';actions.append(global);}else if(global.textContent!=='Always globally')global.textContent='Always globally';
    }
  }

  function card(title,id){const section=document.createElement('section');section.className='v2-card wide';section.id=id;section.innerHTML=`<div class="v2-card-head"><h2>${h(title)}</h2></div><div id="${id}-table"></div>`;return section;}
  function ensureActiveConnections(){const page=document.querySelector('#page');if(!page||page.querySelector('#dashboard-active-connections'))return;const section=card('Active connections','dashboard-active-connections');const tool=[...page.querySelectorAll('.v2-card')].find(node=>node.querySelector('h2')?.textContent?.trim()==='Tool activity');if(tool)tool.before(section);else page.append(section);}

  function guideButtons(){const slugs={ChatGPT:'connect-chatgpt',Claude:'connect-claude',Gemini:'connect-gemini'};for(const example of document.querySelectorAll('#page .client-example')){const name=example.querySelector('h3')?.textContent?.trim(),slug=slugs[name];if(!slug||example.querySelector('[data-v3-guide]'))continue;const button=document.createElement('button');button.type='button';button.dataset.v3Guide=slug;button.textContent='Open guide';example.append(button);}}
  function ensureSafeMatcherCopyAll(){const guide=document.querySelector('#page .safe-matcher-guide'),tabs=guide?.querySelector('.safe-platform-tabs');if(!guide||!tabs||tabs.querySelector('[data-copy-all-matchers]'))return;const button=document.createElement('button');button.type='button';button.dataset.copyAllMatchers='true';button.setAttribute('data-copy-all-matchers','true');button.className='safe-copy-all';button.textContent='Copy all';tabs.append(button);}
  function openGuide(slug){const guide=document.querySelector('nav [data-page="guide"]');guide?.click();let tries=0;const timer=setInterval(()=>{const chapter=document.querySelector(`[data-guide="${CSS.escape(slug)}"]`);if(chapter){clearInterval(timer);chapter.click();return;}if(++tries>40)clearInterval(timer);},50);}

  async function arrangeOnboarding(){
    const page=document.querySelector('#page'),onboarding=page?.querySelector('.onboarding-panel');if(!page||!onboarding)return;guideButtons();if(onboarding.dataset.v3Layout)return;onboarding.dataset.v3Layout='true';onboarding.open=true;
  }
  function makeDashboardCollapsible(){
    const page=document.querySelector('#page');if(!activeDashboard()||!page)return;const onboarding=page.querySelector(':scope > .onboarding-panel');if(onboarding){onboarding.classList.add('dashboard-section');onboarding.open=true;}
    const candidates=[...page.querySelectorAll(':scope > .dashboard-remote, :scope > .v2-card')];for(const node of candidates){if(node.parentElement?.matches('details.dashboard-section'))continue;const title=node.querySelector('.section-heading>span,.v2-card-head h2')?.textContent?.trim()||'Section',details=document.createElement('details'),summary=document.createElement('summary');details.className='dashboard-section';details.open=true;summary.className='dashboard-section-summary';summary.innerHTML=`<span>${h(title)}</span><span class="dashboard-section-chevron" aria-hidden="true">⌄</span>`;node.before(details);details.append(summary,node);node.classList.add('dashboard-section-body');}
  }

  function patchRuntimeStats(snapshot){
    const values={Version:snapshot.status?.version?`v${String(snapshot.status.version).replace(/^v/,'')}`:'—',Uptime:duration(snapshot.uptimeSeconds),'Remote sessions':snapshot.stats.sessions,'Workspace leases':snapshot.stats.workspaceLeases,'Pending requests':snapshot.pending.total,'Managed processes':snapshot.stats.processes,'Open changes':snapshot.stats.openChanges,'Tool calls':snapshot.stats.toolCalls,'Avg tool latency':snapshot.stats.avgToolLatencyMs==null?'—':`${snapshot.stats.avgToolLatencyMs} ms`,Connectors:snapshot.stats.connectors};for(const item of document.querySelectorAll('#page .runtime-grid>div')){const label=item.querySelector('span')?.textContent?.trim();if(label&&Object.hasOwn(values,label)){const strong=item.querySelector('strong');if(strong)strong.textContent=String(values[label]);}}
    const recent=[...document.querySelectorAll('#page .recent-grid>div')],recentValues={Requests:snapshot.pending.total,Sessions:snapshot.stats.sessions,Processes:snapshot.stats.processes,Changes:snapshot.stats.openChanges};for(const item of recent){const label=item.querySelector('span')?.textContent?.trim(),strong=item.querySelector('strong');if(label&&strong&&Object.hasOwn(recentValues,label))strong.textContent=String(recentValues[label]);}
  }

  function mountRuntimeTables(snapshot){
    const table=window.AevraDataTable?.mount;if(!table)return;ensureActiveConnections();const active=document.querySelector('#dashboard-active-connections-table');if(active&&!active.contains(document.activeElement))table(active,{id:'dashboard-active-connections-v3',rows:snapshot.activeConnections??[],pageSize:10,defaultSort:{key:'lastActivityAt',dir:'desc'},filters:[{key:'authType',label:'Auth'},{key:'status',label:'Status'}],columns:[{key:'client',label:'Client'},{key:'authType',label:'Auth'},{key:'workspace',label:'Workspace',render:r=>h(r.workspace??'—')},{key:'capabilities',label:'Capabilities',value:r=>(r.capabilities??[]).join(', '),render:r=>h((r.capabilities??[]).join(', ')||'—'),priority:'low'},{key:'lastActivityAt',label:'Last activity',render:r=>h(localTime(r.lastActivityAt))}],emptyText:'No active remote connections.'});
    const tools=document.querySelector('#dashboard-tool-table');if(tools&&!tools.contains(document.activeElement))table(tools,{id:'dashboard-tools',rows:snapshot.metrics??[],searchPlaceholder:'Search tools…',defaultSort:{key:'calls',dir:'desc'},columns:[{key:'tool',label:'Tool'},{key:'calls',label:'Calls'},{key:'avgMs',label:'Avg latency',render:r=>`${Number(r.avgMs||0)} ms`},{key:'totalMs',label:'Total time',render:r=>`${Number(r.totalMs||0)} ms`,priority:'low'}],emptyText:'No tool calls recorded in this runtime.'});
  }

  async function refreshDashboard(){if(!activeDashboard()||dashboardBusy)return;dashboardBusy=true;try{await arrangeOnboarding();ensureActiveConnections();makeDashboardCollapsible();guideButtons();ensureSafeMatcherCopyAll();const snapshot=await getJson('/api/dashboard/runtime');patchRuntimeStats(snapshot);mountRuntimeTables(snapshot);}catch{}finally{dashboardBusy=false;}}

  document.addEventListener('click',event=>{const copyAll=event.target.closest('[data-copy-all-matchers]');if(copyAll){const matchers=[...document.querySelectorAll('#page .safe-matcher-guide [data-copy-matcher]')].map(node=>node.dataset.copyMatcher).filter(Boolean);if(matchers.length)navigator.clipboard.writeText(matchers.join('\n')).then(()=>toast(`Copied ${matchers.length} matchers`,'success',3200)).catch(()=>{});return;}const guide=event.target.closest('[data-v3-guide]')?.dataset.v3Guide;if(guide){event.preventDefault();event.stopImmediatePropagation();openGuide(guide);}},true);
  new MutationObserver(()=>{if(activeDashboard()){arrangeOnboarding().catch(()=>{});ensureActiveConnections();makeDashboardCollapsible();guideButtons();}ensureSafeMatcherCopyAll();ensureNotificationButton();decorateRequestDrawer(latestApprovals);}).observe(document.documentElement,{childList:true,subtree:true});
  suppressLegacyRequestNotifications();setInterval(()=>refreshDashboard().catch(()=>{}),2000);setInterval(()=>refreshDetailedRequests().catch(()=>{}),2200);refreshDashboard().catch(()=>{});refreshDetailedRequests().catch(()=>{});
})();