(()=>{
  const rawFetch=window.fetch.bind(window);
  const seen={oauth:new Set(),approvals:new Set()};
  let pendingCount=0,pollTimer,onboardingCompleted=null,onboardingSyncing=false,currentVersion='';
  const densePages=new Set(['workspaces','approvals','permissions','sessions','connectors','processes','changes','audit']);

  function ensureRuntimeStyles(){
    if(document.querySelector('#aevra-runtime-styles'))return;
    const style=document.createElement('style');style.id='aevra-runtime-styles';style.textContent=`
      header{position:sticky;top:0;z-index:120;background:rgba(10,10,10,.94);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px)}
      .brand h1{display:flex;align-items:baseline;gap:7px}.app-version{color:var(--text-muted);font:400 10px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:0}
      .onboarding-collapsible{grid-column:1/-1;border:1px solid var(--border);border-radius:8px;background:var(--surface);padding:0;overflow:hidden}
      .onboarding-collapsible>summary{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:11px 13px;list-style:none;cursor:pointer;color:var(--text)}
      .onboarding-collapsible>summary::-webkit-details-marker{display:none}.onboarding-collapsible>summary:hover{background:var(--surface-soft)}
      .onboarding-summary-copy{display:grid;gap:2px}.onboarding-summary-copy b{font-size:12px;font-weight:400}.onboarding-summary-copy small{color:var(--text-muted);font-size:11px}
      .onboarding-summary-action{color:var(--text-muted);font-size:11px}.onboarding-collapsible[open] .onboarding-summary-action::before{content:'Hide setup'}.onboarding-collapsible:not([open]) .onboarding-summary-action::before{content:'Show setup'}
      .onboarding-collapsible-content{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;padding:0 9px 9px}.onboarding-collapsible-content>.wide{grid-column:1/-1}

      .dense-page{grid-template-columns:1fr!important;gap:7px!important}.dense-page>.card{grid-column:1/-1;margin:0;padding:9px 10px}.dense-page>.card h2{margin-bottom:5px;font-size:13px}
      .dense-page .dense-list{display:grid;gap:0;border-top:1px solid var(--border)}
      .dense-page article.dense-row{display:grid;grid-template-columns:minmax(150px,1.25fr) minmax(130px,1fr) auto;gap:8px;align-items:center;min-height:38px;padding:5px 2px;border-top:1px solid var(--border);background:transparent}
      .dense-page article.dense-row:first-of-type{border-top:0}.dense-page article.dense-row>.row{display:contents}.dense-page article.dense-row>.row>div{min-width:0}.dense-page article.dense-row>.row>b{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dense-page article.dense-row>.row>.risk{justify-self:end}
      .dense-page article.dense-row>p{margin:0;min-width:0;color:var(--text-muted);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dense-page article.dense-row>code{margin:0;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .dense-page .dense-actions,.dense-page article.dense-row>.actions{justify-self:end;display:flex;gap:4px;flex-wrap:wrap}.dense-page article.dense-row>button,.dense-page .dense-actions button,.dense-page article.dense-row>.actions button{min-height:28px;padding:3px 8px;font-size:11px}
      .dense-page .risk,.dense-page .status{padding:3px 7px;font-size:10px}.dense-page .pairing-request{min-height:auto;padding:7px 8px}
      .dense-create,.dense-details,.dense-history{border:0!important;padding:0!important;margin:0!important}.dense-create>summary,.dense-details>summary,.dense-history>summary{display:flex;align-items:center;gap:6px;min-height:30px;padding:4px 1px;color:var(--text-secondary);font-size:11px;cursor:pointer;list-style:none}.dense-create>summary::-webkit-details-marker,.dense-details>summary::-webkit-details-marker,.dense-history>summary::-webkit-details-marker{display:none}.dense-create>summary::before,.dense-details>summary::before,.dense-history>summary::before{content:'›';color:var(--text-muted);font-size:15px;line-height:1}.dense-create[open]>summary::before,.dense-details[open]>summary::before,.dense-history[open]>summary::before{transform:rotate(90deg)}
      .dense-create>form,.dense-details>form{margin:4px 0 7px;padding:7px;border:1px solid var(--border);border-radius:7px;background:var(--surface-soft)}.dense-page form.dense-form{gap:5px}.dense-page form.dense-form input,.dense-page form.dense-form select{min-height:30px;padding:4px 7px;font-size:11px}
      .dense-history{margin-top:4px!important;border-top:1px solid var(--border)!important}.dense-history>summary{justify-content:space-between}.dense-history-list{display:grid;gap:0}.dense-history .dense-row{opacity:.82}
      .dense-page .warning-details{grid-column:1/-1}.dense-page .warning-details p{white-space:normal;margin:4px 0 0}
      .dense-page #audit-filter{min-height:30px;margin-bottom:5px}.dense-page #audit-rows{display:grid;gap:0}.dense-page #audit-rows article{grid-template-columns:minmax(170px,1.4fr) minmax(170px,1fr) auto}
      .dense-page .subrow{padding:4px 0;min-height:30px}.dense-page h3{margin:5px 0 3px;font-size:11px}.dense-page .card>p{margin:4px 0;font-size:11px}
      @media(max-width:900px){.onboarding-collapsible-content{grid-template-columns:1fr}.onboarding-collapsible-content>.wide{grid-column:auto}.dense-page article.dense-row{grid-template-columns:minmax(140px,1fr) minmax(120px,1fr) auto}.dense-page article.dense-row>.actions{grid-column:1/-1;justify-self:start}}
      @media(max-width:680px){header{top:0}.dense-page>.card{padding:8px}.dense-page article.dense-row{grid-template-columns:minmax(0,1fr) auto;gap:3px 8px;padding:7px 1px}.dense-page article.dense-row>.row{display:flex;grid-column:1/-1}.dense-page article.dense-row>p,.dense-page article.dense-row>code{grid-column:1/-1;white-space:normal;overflow-wrap:anywhere}.dense-page article.dense-row>.actions,.dense-page article.dense-row>.dense-actions{grid-column:1/-1;justify-self:start}.dense-page article.dense-row button{min-height:36px}.dense-page form.dense-form{grid-template-columns:1fr}.dense-page #audit-rows article{grid-template-columns:1fr}}
    `;document.head.append(style);
  }

  function ensureToastStack(){
    let stack=document.querySelector('#toast-stack');
    if(!stack){stack=document.createElement('div');stack.id='toast-stack';stack.className='toast-stack';stack.setAttribute('role','region');stack.setAttribute('aria-label','Notifications');stack.setAttribute('aria-live','polite');document.body.append(stack);}
    return stack;
  }

  function toast(message,kind='success',timeout=3200){
    const stack=ensureToastStack();
    const item=document.createElement('div');item.className=`toast ${kind}`;item.setAttribute('role',kind==='error'?'alert':'status');
    const icon=document.createElement('span');icon.className='toast-icon';icon.textContent=kind==='error'?'!':kind==='info'?'i':'✓';
    const text=document.createElement('span');text.className='toast-message';text.textContent=String(message||'Done');
    const close=document.createElement('button');close.type='button';close.className='toast-close';close.setAttribute('aria-label','Dismiss notification');close.textContent='×';
    close.addEventListener('click',()=>item.remove());item.append(icon,text,close);stack.append(item);
    requestAnimationFrame(()=>item.classList.add('visible'));
    setTimeout(()=>{item.classList.remove('visible');setTimeout(()=>item.remove(),180)},timeout);
    return item;
  }

  function localDateTimeInText(value){
    return String(value??'').replace(/\(built\s+(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)\s+UTC\)/gi,(original,stamp)=>{
      const date=new Date(`${stamp}Z`);return Number.isNaN(date.getTime())?original:`(built ${date.toLocaleString()})`;
    });
  }
  function localizeVisibleDates(){
    for(const node of document.querySelectorAll('.remote-provider p')){const current=node.textContent??'',next=localDateTimeInText(current);if(next!==current)node.textContent=next;}
  }

  function pathOf(input){try{return new URL(typeof input==='string'?input:input?.url,location.href).pathname}catch{return''}}
  function actorLabel(actor){return String(actor||'connector').replace(/^(?:connector|oauth):/,'')||'connector';}
  function actionLabel(path,method){
    if(path.includes('/cloudflare/setup'))return'Remote access saved';
    if(path.includes('/cloudflare/authenticate'))return'Cloudflare authentication updated';
    if(path.includes('/oauth/requests/')&&path.endsWith('/approve'))return'Connection request approved';
    if(path.includes('/oauth/requests/')&&path.endsWith('/deny'))return'Connection request denied';
    if(path.includes('/approvals/')&&path.endsWith('/approve'))return'Request approved';
    if(path.includes('/approvals/')&&path.endsWith('/deny'))return'Request denied';
    if(path==='/api/onboarding'&&method==='PATCH')return'Onboarding completed';
    if(method==='DELETE')return'Removed';
    if(method==='PATCH')return'Changes saved';
    if(method==='POST')return'Action completed';
    return'Updated';
  }
  async function errorMessage(response){
    try{const type=response.headers.get('content-type')||'';const value=type.includes('json')?await response.json():await response.text();return value?.error?.message||value?.error||value?.message||`HTTP ${response.status}`}catch{return`HTTP ${response.status}`}
  }
  async function mutationToast(response,path,method){
    if(response.ok&&method==='DELETE'&&/^\/api\/permissions\/[^/]+$/.test(path)){
      try{const value=await response.clone().json(),removed=value?.removed,actor=removed?.actor;toast(`Permission removed from ${actorLabel(actor)}`,'success');return;}catch{toast('Permission removed','success');return;}
    }
    if(path.includes('/cloudflare/test')){
      if(!response.ok){toast(await errorMessage(response.clone()),'error',5200);return;}
      try{
        const value=await response.clone().json();
        if(value?.reachable){toast(`Endpoint reachable${value.status?` (HTTP ${value.status})`:''}`,'success');return;}
        toast(value?.message?`Endpoint unreachable: ${value.message}`:'Endpoint unreachable','error',5200);return;
      }catch{toast('Endpoint test completed','success');return;}
    }
    if(response.ok)toast(actionLabel(path,method),'success');else toast(await errorMessage(response.clone()),'error',5200);
  }

  window.fetch=async(input,init={})=>{
    const method=String(init?.method||'GET').toUpperCase(),path=pathOf(input),mutation=path.startsWith('/api/')&&!['GET','HEAD','OPTIONS'].includes(method);
    try{
      const response=await rawFetch(input,init);
      if(mutation){
        await mutationToast(response,path,method);
        if(path.includes('/cloudflare/'))setTimeout(()=>{refreshCloudflare().catch(()=>{});refreshAppStatus().catch(()=>{});},100);
        if(path.includes('/oauth/requests/')||path.includes('/approvals/'))setTimeout(()=>refreshPending().catch(()=>{}),100);
        if(path==='/api/onboarding'&&response.ok){onboardingCompleted=true;setTimeout(()=>collapseCompletedOnboarding(),0);}
      }
      return response;
    }catch(error){if(mutation)toast(error instanceof Error?error.message:String(error),'error',5200);throw error;}
  };

  const originalAlert=window.alert.bind(window);
  window.alert=(message)=>{try{toast(message,'success')}catch{originalAlert(message)}};

  function ensureRequestButton(){
    const health=document.querySelector('header .health');if(!health)return;
    let button=health.querySelector('#pending-requests');
    if(!button){button=document.createElement('button');button.type='button';button.id='pending-requests';button.className='request-pill';button.innerHTML='<span>Requests</span><b>0</b>';button.addEventListener('click',()=>document.querySelector('nav [data-page="approvals"]')?.click());health.prepend(button);}
    const count=button.querySelector('b'),next=String(pendingCount);if(count&&count.textContent!==next)count.textContent=next;
    button.classList.toggle('has-pending',pendingCount>0);const label=`${pendingCount} pending requests. Open approvals.`;if(button.getAttribute('aria-label')!==label)button.setAttribute('aria-label',label);
  }

  function ensureVersionBadge(version=currentVersion){
    if(!version)return;currentVersion=String(version);
    const title=document.querySelector('header .brand h1');if(!title)return;
    let badge=title.querySelector('.app-version');if(!badge){badge=document.createElement('span');badge.className='app-version';title.append(badge);}
    const text=currentVersion.startsWith('v')?currentVersion:`v${currentVersion}`;if(badge.textContent!==text)badge.textContent=text;
  }

  function statusState(key,status){
    if(key==='tunnel'){
      if(status?.tunnel==='unconfigured')return'off';
      if(status?.tunnelReachable===true)return'ok';
      if(status?.tunnelReachable===false)return'error';
      return status?.tunnel==='configured'?'pending':'off';
    }
    const value=String(status?.[key]??'').toLowerCase();
    if(['running','ready','connected'].includes(value))return'ok';
    if(['starting','checking','reconnecting'].includes(value))return'pending';
    if(value==='unavailable')return'error';
    return value?'error':'error';
  }
  function updateHealth(status){
    for(const chip of document.querySelectorAll('[data-health]')){
      const key=chip.dataset.health,state=statusState(key,status);chip.dataset.state=state;
      const label=chip.querySelector(':scope > span')?.textContent??key;
      const detail=key==='tunnel'?(status?.tunnelReachable===true?'reachable':status?.tunnelReachable===false?'unreachable':status?.tunnel??'unconfigured'):status?.[key]??'unavailable';
      const text=`${label}: ${detail}`;chip.title=text;chip.setAttribute('aria-label',text);
    }
  }

  function currentPage(){return document.querySelector('nav [data-page].active')?.dataset.page||'';}
  function wrapForm(form,label){
    if(!form||form.closest('.dense-create,.dense-details'))return;
    const details=document.createElement('details');details.className=form.closest('article')?'dense-details':'dense-create';
    const summary=document.createElement('summary');summary.textContent=label;form.before(details);details.append(summary,form);form.classList.add('dense-form');
  }
  function compactApprovalHistory(page){
    if(currentPage()!=='approvals')return;
    const operationCard=[...page.querySelectorAll(':scope > .card')].find(card=>card.querySelector(':scope > h2')?.textContent?.trim()==='Operation approvals');
    if(!operationCard||operationCard.querySelector(':scope > .dense-history'))return;
    const rows=[...operationCard.querySelectorAll(':scope > article')];
    const history=rows.filter(row=>!row.querySelector('[data-approve],[data-deny]'));
    if(!history.length)return;
    const details=document.createElement('details');details.className='dense-history';
    const summary=document.createElement('summary');summary.innerHTML=`<span>History</span><span>${history.length}</span>`;
    const list=document.createElement('div');list.className='dense-history-list';for(const row of history)list.append(row);details.append(summary,list);operationCard.append(details);
  }
  function enhanceDensePages(){
    const page=document.querySelector('#page');if(!page)return;
    const name=currentPage();const dense=densePages.has(name);page.classList.toggle('dense-page',dense);if(!dense)return;
    for(const card of page.querySelectorAll(':scope > .card')){
      card.classList.add('dense-card');
      const rows=[...card.querySelectorAll(':scope > article')];if(rows.length)card.classList.add('dense-list');
      for(const row of rows){row.classList.add('dense-row');for(const actions of row.querySelectorAll(':scope > .actions'))actions.classList.add('dense-actions');}
    }
    for(const form of page.querySelectorAll('form'))form.classList.add('dense-form');
    wrapForm(page.querySelector('#workspace-form'),'Add workspace');
    wrapForm(page.querySelector('#permission-form'),'Create permission rule');
    wrapForm(page.querySelector('#new-connector'),'Create Bearer connector');
    for(const form of page.querySelectorAll('article form[data-switch-session]'))wrapForm(form,'Switch workspace');
    for(const form of page.querySelectorAll('article form[data-rename-change]'))wrapForm(form,'Rename change set');
    for(const form of page.querySelectorAll('article form[data-mount-form]'))wrapForm(form,'Add external mount');
    for(const form of page.querySelectorAll('article form[data-admission-form]'))wrapForm(form,'Actor admission');
    for(const warning of page.querySelectorAll('article > p.warning')){
      if(warning.closest('.warning-details'))continue;const details=document.createElement('details');details.className='dense-details warning-details';const summary=document.createElement('summary');summary.textContent='Ownership warning';warning.before(details);details.append(summary,warning);
    }
    compactApprovalHistory(page);
  }

  function isGettingStarted(){return document.querySelector('#page .page-intro h2')?.textContent?.trim()==='Getting Started';}
  function collapseCompletedOnboarding(){
    if(onboardingCompleted!==true||!isGettingStarted())return;
    const page=document.querySelector('#page.setup-sections');if(!page||page.querySelector('.onboarding-collapsible'))return;
    const sections=[...page.querySelectorAll(':scope > .setup-section:not([data-onboarding-persistent])')];if(!sections.length)return;
    const persistent=page.querySelector(':scope > [data-onboarding-persistent]');
    const finish=page.querySelector('#finish-onboarding');if(finish){finish.textContent='Onboarding completed';finish.disabled=true;}
    const details=document.createElement('details');details.className='onboarding-collapsible';
    const summary=document.createElement('summary');summary.innerHTML='<span class="onboarding-summary-copy"><b>Getting Started · Completed</b><small>Remote Access stays visible. Expand these completed setup examples whenever you need them.</small></span><span class="onboarding-summary-action" aria-hidden="true"></span>';
    const content=document.createElement('div');content.className='onboarding-collapsible-content';for(const section of sections)content.append(section);
    details.append(summary,content);if(persistent)persistent.after(details);else page.append(details);
  }
  async function syncOnboardingCollapse(){
    if(!isGettingStarted()||onboardingSyncing)return;
    if(onboardingCompleted===true){collapseCompletedOnboarding();return;}
    if(onboardingCompleted===false)return;
    onboardingSyncing=true;try{const value=await getJson('/api/onboarding');onboardingCompleted=value?.completed===true;collapseCompletedOnboarding();}finally{onboardingSyncing=false;}
  }

  function browserNotify(title,body){
    if(!('Notification'in window)||Notification.permission!=='granted')return;
    try{new Notification(title,{body,tag:`aevra-${title}-${body}`})}catch{}
  }
  function announceNew(items,set,kind){
    for(const item of items){const id=String(item.id);if(set.has(id))continue;set.add(id);
      if(kind==='oauth'){
        const client=item.clientName||item.clientId||'AI client';toast(`Incoming connection request from ${client}`,'info',6500);browserNotify('Aevra connection request',`${client} is waiting for local approval.`);continue;
      }
      const admission=item.operation?.family==='workspace:select';
      if(admission){toast(`Incoming workspace access request from ${item.actor||'AI client'}`,'info',6500);browserNotify('Aevra workspace access request',`${item.actor||'An AI client'} is waiting for local approval.`);continue;}
      const name=item.operation?.family||item.operation?.capability||'operation';toast(`Incoming approval request: ${name}`,'info',6500);browserNotify('Aevra approval request',`${name} is waiting for local approval.`);
    }
  }
  async function getJson(path){const r=await rawFetch(path,{headers:{accept:'application/json'},cache:'no-store'});if(!r.ok)throw new Error(`HTTP ${r.status}`);return r.json();}
  async function refreshPending(){
    const [oauth,approvals]=await Promise.all([getJson('/api/oauth/requests'),getJson('/api/approvals')]);
    const pendingApprovals=approvals.filter(x=>x.state==='PENDING');announceNew(oauth,seen.oauth,'oauth');announceNew(pendingApprovals,seen.approvals,'approval');
    const liveOAuth=new Set(oauth.map(x=>String(x.id))),liveApprovals=new Set(pendingApprovals.map(x=>String(x.id)));for(const id of [...seen.oauth])if(!liveOAuth.has(id))seen.oauth.delete(id);for(const id of [...seen.approvals])if(!liveApprovals.has(id))seen.approvals.delete(id);
    pendingCount=oauth.length+pendingApprovals.length;ensureRequestButton();return{oauth,pendingApprovals};
  }
  async function refreshCloudflare(){const cf=await getJson('/api/cloudflare/status');document.dispatchEvent(new CustomEvent('aevra:cloudflare-status',{detail:cf}));return cf;}
  async function refreshAppStatus(){const status=await getJson('/api/status');ensureVersionBadge(status?.version);updateHealth(status);return status;}
  async function finishOnboarding(){
    const response=await window.fetch('/api/onboarding',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({completed:true,completedSections:['remote-access','connect-ai','workspace','try-aevra','explore']})});
    if(!response.ok)return;onboardingCompleted=true;collapseCompletedOnboarding();
  }
  function poll(){refreshPending().catch(()=>{});refreshAppStatus().catch(()=>{});}
  function startPolling(){clearInterval(pollTimer);poll();pollTimer=setInterval(poll,2500);}

  document.addEventListener('click',event=>{
    const finish=event.target.closest('#finish-onboarding');
    if(finish){event.preventDefault();event.stopImmediatePropagation();if(!finish.disabled){finish.disabled=true;finishOnboarding().catch(error=>{finish.disabled=false;toast(error instanceof Error?error.message:String(error),'error',5200);});}return;}
    const copy=event.target.closest('[data-copy],#copy-connector-token');if(copy)setTimeout(()=>toast('Copied to clipboard','success',1800),0);
  },true);
  ensureRuntimeStyles();
  new MutationObserver(()=>{ensureRequestButton();ensureVersionBadge();localizeVisibleDates();enhanceDensePages();void syncOnboardingCollapse();}).observe(document.documentElement,{childList:true,subtree:true});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{startPolling();enhanceDensePages();void syncOnboardingCollapse();},{once:true});else{startPolling();enhanceDensePages();void syncOnboardingCollapse();}
  window.aevraUi={toast,refreshPending,refreshCloudflare,refreshAppStatus,updateHealth,localDateTimeInText,collapseCompletedOnboarding,enhanceDensePages};
})();
