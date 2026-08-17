(()=>{
  const rawFetch=window.fetch.bind(window);
  const seen={oauth:new Set(),approvals:new Set()};
  let seeded=false,pendingCount=0,pollTimer,onboardingCompleted=null,onboardingSyncing=false,currentVersion='';

  function ensureRuntimeStyles(){
    if(document.querySelector('#aevra-runtime-styles'))return;
    const style=document.createElement('style');style.id='aevra-runtime-styles';style.textContent=`
      .brand h1{display:flex;align-items:baseline;gap:7px}.app-version{color:var(--text-muted);font:400 10px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:0}
      .onboarding-collapsible{grid-column:1/-1;border:1px solid var(--border);border-radius:8px;background:var(--surface);padding:0;overflow:hidden}
      .onboarding-collapsible>summary{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:11px 13px;list-style:none;cursor:pointer;color:var(--text)}
      .onboarding-collapsible>summary::-webkit-details-marker{display:none}.onboarding-collapsible>summary:hover{background:var(--surface-soft)}
      .onboarding-summary-copy{display:grid;gap:2px}.onboarding-summary-copy b{font-size:12px;font-weight:400}.onboarding-summary-copy small{color:var(--text-muted);font-size:11px}
      .onboarding-summary-action{color:var(--text-muted);font-size:11px}.onboarding-collapsible[open] .onboarding-summary-action::before{content:'Hide setup'}.onboarding-collapsible:not([open]) .onboarding-summary-action::before{content:'Show setup'}
      .onboarding-collapsible-content{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;padding:0 9px 9px}.onboarding-collapsible-content>.wide{grid-column:1/-1}
      @media(max-width:900px){.onboarding-collapsible-content{grid-template-columns:1fr}.onboarding-collapsible-content>.wide{grid-column:auto}}
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
    const icon=document.createElement('span');icon.className='toast-icon';icon.textContent=kind==='error'?'!':'✓';
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
  function actionLabel(path,method){
    if(path.includes('/cloudflare/setup'))return'Remote access saved';
    if(path.includes('/cloudflare/authenticate'))return'Cloudflare authentication updated';
    if(path.includes('/cloudflare/test'))return'Remote endpoint checked';
    if(path.includes('/oauth/requests/')&&path.endsWith('/approve'))return'Connection request approved';
    if(path.includes('/oauth/requests/')&&path.endsWith('/deny'))return'Connection request denied';
    if(path.includes('/approvals/')&&path.endsWith('/approve'))return'Operation approved';
    if(path.includes('/approvals/')&&path.endsWith('/deny'))return'Operation denied';
    if(path==='/api/onboarding'&&method==='PATCH')return'Onboarding completed';
    if(method==='DELETE')return'Removed';
    if(method==='PATCH')return'Changes saved';
    if(method==='POST')return'Action completed';
    return'Updated';
  }
  async function errorMessage(response){
    try{const type=response.headers.get('content-type')||'';const value=type.includes('json')?await response.json():await response.text();return value?.error?.message||value?.error||value?.message||`HTTP ${response.status}`}catch{return`HTTP ${response.status}`}
  }

  window.fetch=async(input,init={})=>{
    const method=String(init?.method||'GET').toUpperCase(),path=pathOf(input),mutation=path.startsWith('/api/')&&!['GET','HEAD','OPTIONS'].includes(method);
    try{
      const response=await rawFetch(input,init);
      if(mutation){
        if(response.ok)toast(actionLabel(path,method),'success');else toast(await errorMessage(response.clone()),'error',5200);
        if(path.includes('/cloudflare/'))setTimeout(()=>refreshCloudflare().catch(()=>{}),100);
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

  function isGettingStarted(){return document.querySelector('#page .page-intro h2')?.textContent?.trim()==='Getting Started'}
  function collapseCompletedOnboarding(){
    if(onboardingCompleted!==true||!isGettingStarted())return;
    const page=document.querySelector('#page.setup-sections');if(!page||page.querySelector('.onboarding-collapsible'))return;
    const sections=[...page.querySelectorAll(':scope > .setup-section')];if(!sections.length)return;
    const finish=page.querySelector('#finish-onboarding');if(finish){finish.textContent='Onboarding completed';finish.disabled=true;}
    const details=document.createElement('details');details.className='onboarding-collapsible';
    const summary=document.createElement('summary');summary.innerHTML='<span class="onboarding-summary-copy"><b>Onboarding completed</b><small>Setup stays collapsed by default. Expand it whenever you need these controls again.</small></span><span class="onboarding-summary-action" aria-hidden="true"></span>';
    const content=document.createElement('div');content.className='onboarding-collapsible-content';for(const section of sections)content.append(section);
    details.append(summary,content);page.append(details);
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
    for(const item of items){const id=String(item.id);if(set.has(id))continue;set.add(id);if(!seeded)continue;
      if(kind==='oauth'){const client=item.clientName||item.clientId||'ChatGPT';toast(`Incoming connection request from ${client}`,'info',6500);browserNotify('Aevra connection request',`${client} is waiting for local approval.`);}
      else{const name=item.operation?.family||item.operation?.capability||'operation';toast(`Incoming approval request: ${name}`,'info',6500);browserNotify('Aevra approval request',`${name} is waiting for local approval.`);}
    }
  }
  async function getJson(path){const r=await rawFetch(path,{headers:{accept:'application/json'},cache:'no-store'});if(!r.ok)throw new Error(`HTTP ${r.status}`);return r.json()}
  async function refreshPending(){
    const [oauth,approvals]=await Promise.all([getJson('/api/oauth/requests'),getJson('/api/approvals')]);
    const pendingApprovals=approvals.filter(x=>x.state==='PENDING');announceNew(oauth,seen.oauth,'oauth');announceNew(pendingApprovals,seen.approvals,'approval');
    const liveOAuth=new Set(oauth.map(x=>String(x.id))),liveApprovals=new Set(pendingApprovals.map(x=>String(x.id)));for(const id of [...seen.oauth])if(!liveOAuth.has(id))seen.oauth.delete(id);for(const id of [...seen.approvals])if(!liveApprovals.has(id))seen.approvals.delete(id);
    pendingCount=oauth.length+pendingApprovals.length;seeded=true;ensureRequestButton();return{oauth,pendingApprovals};
  }
  async function refreshCloudflare(){
    const cf=await getJson('/api/cloudflare/status');
    const tunnel=[...document.querySelectorAll('header .health span')].find(x=>/^Tunnel\b/i.test(x.textContent||''));
    if(tunnel)tunnel.textContent=`Tunnel ${cf.hostname?'configured':'unconfigured'}`;
    document.dispatchEvent(new CustomEvent('aevra:cloudflare-status',{detail:cf}));return cf;
  }
  async function refreshAppStatus(){const status=await getJson('/api/status');ensureVersionBadge(status?.version);return status;}
  async function finishOnboarding(){
    const response=await window.fetch('/api/onboarding',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({completed:true,completedSections:['remote-access','connect-ai','workspace','try-aevra','explore']})});
    if(!response.ok)return;onboardingCompleted=true;collapseCompletedOnboarding();
  }
  function startPolling(){clearInterval(pollTimer);refreshPending().catch(()=>{});refreshAppStatus().catch(()=>{});pollTimer=setInterval(()=>refreshPending().catch(()=>{}),2500);}

  document.addEventListener('click',event=>{
    const finish=event.target.closest('#finish-onboarding');
    if(finish){event.preventDefault();event.stopImmediatePropagation();if(!finish.disabled){finish.disabled=true;finishOnboarding().catch(error=>{finish.disabled=false;toast(error instanceof Error?error.message:String(error),'error',5200);});}return;}
    const copy=event.target.closest('[data-copy],#copy-connector-token');if(copy)setTimeout(()=>toast('Copied to clipboard','success',1800),0);
  },true);
  ensureRuntimeStyles();
  new MutationObserver(()=>{ensureRequestButton();ensureVersionBadge();localizeVisibleDates();void syncOnboardingCollapse();}).observe(document.documentElement,{childList:true,subtree:true});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{startPolling();void syncOnboardingCollapse();},{once:true});else{startPolling();void syncOnboardingCollapse();}
  window.aevraUi={toast,refreshPending,refreshCloudflare,refreshAppStatus,localDateTimeInText,collapseCompletedOnboarding};
})();
