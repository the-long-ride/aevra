(()=>{
  const rawFetch=window.fetch.bind(window);
  const seen={oauth:new Set(),approvals:new Set()};
  let seeded=false,pendingCount=0,pollTimer;

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

  function pathOf(input){try{return new URL(typeof input==='string'?input:input?.url,location.href).pathname}catch{return''}}
  function actionLabel(path,method){
    if(path.includes('/cloudflare/setup'))return'Remote access saved';
    if(path.includes('/cloudflare/authenticate'))return'Cloudflare authentication updated';
    if(path.includes('/cloudflare/test'))return'Remote endpoint checked';
    if(path.includes('/oauth/requests/')&&path.endsWith('/approve'))return'Connection request approved';
    if(path.includes('/oauth/requests/')&&path.endsWith('/deny'))return'Connection request denied';
    if(path.includes('/approvals/')&&path.endsWith('/approve'))return'Operation approved';
    if(path.includes('/approvals/')&&path.endsWith('/deny'))return'Operation denied';
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
    button.querySelector('b').textContent=String(pendingCount);button.classList.toggle('has-pending',pendingCount>0);button.setAttribute('aria-label',`${pendingCount} pending requests. Open approvals.`);
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
    if(tunnel)tunnel.textContent=`Tunnel ${cf.hostname?(cf.reachable===false?'check':'configured'):'unconfigured'}`;
    document.dispatchEvent(new CustomEvent('aevra:cloudflare-status',{detail:cf}));return cf;
  }
  function startPolling(){clearInterval(pollTimer);refreshPending().catch(()=>{});pollTimer=setInterval(()=>refreshPending().catch(()=>{}),2500);}

  document.addEventListener('click',event=>{const copy=event.target.closest('[data-copy],#copy-connector-token');if(copy)setTimeout(()=>toast('Copied to clipboard','success',1800),0)},true);
  new MutationObserver(()=>ensureRequestButton()).observe(document.documentElement,{childList:true,subtree:true});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',startPolling,{once:true});else startPolling();
  window.aevraUi={toast,refreshPending,refreshCloudflare};
})();
