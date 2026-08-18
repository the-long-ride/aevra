const root = document.querySelector('#app');
const state = { page: null, guideSlug: 'quick-start', safePlatform: 'windows' };

async function api(path, init = {}) {
  const headers = { 'content-type': 'application/json', ...init.headers };
  const response = await fetch(path, { ...init, headers });
  const type = response.headers.get('content-type') || '';
  const value = type.includes('json') ? await response.json() : await response.text();
  if (!response.ok) throw new Error(value?.error?.message || value?.error || `HTTP ${response.status}`);
  return value;
}

const h = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const json = (value, fallback = {}) => {
  try { return JSON.parse(String(value || '')); } catch { return fallback; }
};
function localDateTime(value) {
  if (value == null || value === '') return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}
const card = (title, body = '') => `<section class="card"><h2>${h(title)}</h2>${body}</section>`;
const field = (label, control, help = '') => `<label class="field"><span>${h(label)}</span>${control}${help ? `<small>${h(help)}</small>` : ''}</label>`;
const mcpUrl = (cf) => cf?.hostname ? `https://${cf.hostname}/mcp` : 'Configure a public hostname first';

function healthState(key,status){
  if(key==='tunnel'){
    if(status?.tunnel==='unconfigured')return'off';
    if(status?.tunnelReachable===true)return'ok';
    if(status?.tunnelReachable===false)return'error';
    return status?.tunnel==='configured'?'pending':'off';
  }
  const value=String(status?.[key]??'').toLowerCase();
  if(value==='running'||value==='ready'||value==='connected')return'ok';
  if(value==='starting'||value==='checking'||value==='reconnecting')return'pending';
  if(value==='unavailable')return'off';
  return value?'error':'off';
}
function healthChip(label,key,status){
  const chipState=healthState(key,status),raw=key==='tunnel'?(status?.tunnelReachable===true?'reachable':status?.tunnelReachable===false?'unreachable':status?.tunnel??'unconfigured'):status?.[key]??'unavailable';
  return `<span class="health-chip" data-health="${key}" data-state="${chipState}" title="${h(`${label}: ${raw}`)}" aria-label="${h(`${label}: ${raw}`)}"><i class="health-dot" aria-hidden="true"></i><span>${label}</span></span>`;
}

function shell(status) {
  const nav = [
    ['getting-started','Getting Started'],['dashboard','Dashboard'],['workspaces','Workspaces'],['approvals','Approvals'],['permissions','Permissions'],['sessions','Sessions'],['connectors','Connectors'],['processes','Processes'],['changes','Changes'],['audit','Audit'],['settings','Settings'],['guide','Guide'],
  ];
  return `<header><div class="brand"><h1>Aevra</h1><p>Local MCP control plane</p></div><div class="health">${healthChip('Core','core',status)}${healthChip('Worker','worker',status)}${healthChip('MCP','mcp',status)}${healthChip('Tunnel','tunnel',status)}</div></header>${status.safeMode ? '<div class="banner danger">SAFE MODE: remote execution and administrative mutations are disabled.</div>' : ''}<div class="layout"><nav>${nav.map(([page,label]) => `<button data-page="${page}" class="${state.page === page ? 'active' : ''}">${label}</button>`).join('')}</nav><main id="page" class="card-grid"></main></div>`;
}

function pairingMarkup(items) {
  if (!items.length) return '<p class="muted">No OAuth pairing requests waiting for local approval.</p>';
  return items.map((item) => `<article class="pairing-request"><div class="row"><div><b>${h(item.clientName ?? item.clientId)}</b><p>${h(item.remoteIp ?? 'remote client')}</p></div><code>${h(item.pairingCode)}</code></div><p>Requested access: ${h((item.requestedScopes ?? item.scopes ?? []).join(', ') || 'mcp')}</p><p>Redirect: <code>${h(item.redirectUri ?? 'not provided')}</code></p><div class="actions"><button type="button" data-oauth-deny="${h(item.id)}">Deny</button><button type="button" class="primary" data-oauth-approve="${h(item.id)}">Allow</button></div></article>`).join('');
}

async function decideOauth(el, event, reload) {
  const approve=event.target.closest('[data-oauth-approve]');
  const deny=event.target.closest('[data-oauth-deny]');
  const id=approve?.dataset.oauthApprove ?? deny?.dataset.oauthDeny;
  if(!id)return false;
  if(approve)await api(`/api/oauth/requests/${id}/approve`,{method:'POST',body:'{}'});
  if(deny)await api(`/api/oauth/requests/${id}/deny`,{method:'POST',body:'{}'});
  await reload();return true;
}

function remoteAccessMarkup(cf, id='setup') {
  const canonical=mcpUrl(cf);
  const providerDetail=cf.found?h(cf.version??'Detected'):'Not detected on PATH';
  const authMessage=h(cf.authenticationMessage??'Aevra checks existing Cloudflare credentials before starting a new login.');
  return `<div class="remote-access">
    <div class="remote-access-head">
      <div class="remote-provider"><div><b>cloudflared</b><p>${providerDetail} · ${authMessage}</p></div><span class="status ${cf.authenticated?'success':cf.found?'warning':'muted'}">${cf.authenticated?'Authenticated':cf.found?'Login needed':'Unavailable'}</span></div>
      <button type="button" id="${id}-authenticate" ${cf.found?'':'disabled'}>${cf.authenticated?'Check authentication':'Authenticate with Cloudflare'}</button>
    </div>
    <div class="endpoint remote-endpoint"><span>Canonical MCP endpoint</span><code>${h(canonical)}</code>${cf.hostname?`<button type="button" data-copy="${h(canonical)}">Copy</button>`:''}</div>
    <form id="${id}-cloudflare" class="remote-config">
      <div class="remote-config-grid">
        ${field('Public MCP hostname', `<input name="hostname" value="${h(cf.hostname??'')}" placeholder="aevra-mcp.example.com" required>`, 'Hostname or hostname-only https URL.')}
        ${field('Tunnel ID', `<input name="tunnelId" value="${h(cf.tunnelId??'')}" placeholder="Leave blank to create an Aevra tunnel">`, 'Reuse an existing tunnel when you already have one.')}
        ${field('Tunnel ownership', `<select name="ownership"><option value="managed">Managed by Aevra</option><option value="external" ${cf.ownership==='external'?'selected':''}>External process</option></select>`)}
      </div>
      <input type="hidden" name="authMode" value="connector">
      <div class="remote-actions"><p id="${id}-result" class="inline-result"></p><div class="actions"><button type="button" id="${id}-test">Test endpoint</button><button type="submit" class="primary">Save remote access</button></div></div>
    </form>
    <details><summary>Advanced: Cloudflare Access</summary><p>Cloudflare Access is optional. Aevra OAuth is the normal authentication layer. Configure Access verifier values from Settings only when you intentionally add that extra gate.</p></details>
  </div>`;
}

function wireRemoteAccess(el, cf, id, reload) {
  el.querySelector(`#${id}-authenticate`)?.addEventListener('click',async()=>{const out=el.querySelector(`#${id}-result`);out.textContent=cf.authenticated?'Checking existing Cloudflare credentials...':'Starting Cloudflare authentication...';try{const r=await api('/api/cloudflare/authenticate',{method:'POST',body:'{}'});out.textContent=r.message||'Cloudflare authentication completed.';}catch(error){out.textContent=error.message;}});
  el.querySelector(`#${id}-cloudflare`)?.addEventListener('submit',async(event)=>{event.preventDefault();const value=Object.fromEntries(new FormData(event.target));const out=el.querySelector(`#${id}-result`);try{const r=await api('/api/cloudflare/setup',{method:'POST',body:JSON.stringify(value)});out.textContent=`Configured https://${r.result.hostname}`;await reload();}catch(error){out.textContent=error.message;}});
  el.querySelector(`#${id}-test`)?.addEventListener('click',async()=>{const out=el.querySelector(`#${id}-result`);try{const r=await api('/api/cloudflare/test',{method:'POST',body:'{}'});out.textContent=r.reachable?`Endpoint reachable${r.status?` (HTTP ${r.status})`:''}`:`Not reachable: ${r.message}`;}catch(error){out.textContent=error.message;}});
  for(const button of el.querySelectorAll('[data-copy]'))button.addEventListener('click',()=>navigator.clipboard.writeText(button.dataset.copy));
}

async function gettingStarted(el, status) {
  const [onboarding,cf,workspaces]=await Promise.all([api('/api/onboarding'),api('/api/cloudflare/status'),api('/api/workspaces')]);
  const endpoint=mcpUrl(cf);
  const providerExamples=[
    ['ChatGPT','connect-chatgpt','Create a custom MCP app, paste the endpoint, choose OAuth, then approve the request in Approvals.'],
    ['Claude','connect-claude','Add a remote MCP server, use the endpoint with OAuth, then approve the local request in Approvals.'],
    ['Gemini','connect-gemini','Add the MCP server endpoint, authenticate with OAuth, then approve the local request in Approvals.'],
  ];
  el.classList.add('setup-sections');
  el.innerHTML=`<section class="page-intro"><div><h2>Getting Started</h2><p>Set up remote access and your first AI connection without leaving the dashboard.</p></div><button type="button" data-page-jump="guide">Open Guide</button></section>
    <section class="setup-section wide" data-onboarding-persistent><div class="section-heading"><span>Remote Access</span><strong>${cf.hostname?'Configured':'Setup needed'}</strong></div>${remoteAccessMarkup(cf,'onboard')}</section>
    <section class="setup-section wide"><div class="section-heading"><span>Connect an AI</span><strong>Example guides</strong></div><p class="section-note">These are example setup guides. Provider labels and screens can change; use the full local guide if your client UI differs.</p><div class="endpoint shared-endpoint"><span>Canonical MCP endpoint</span><code>${h(endpoint)}</code>${cf.hostname?`<button type="button" data-copy="${h(endpoint)}">Copy</button>`:''}</div><div class="client-grid">${providerExamples.map(([name,slug,description])=>`<article class="client-example"><div><h3>${name}</h3><p>${description}</p></div><p>Authentication: <b>OAuth</b></p><button type="button" data-guide-jump="${slug}">Read ${name} guide</button></article>`).join('')}</div></section>
    <section class="setup-section"><div class="section-heading"><span>Workspace</span><strong>${workspaces.length?`${workspaces.length} registered`:'Register one'}</strong></div><form id="onboard-workspace" class="stack-form">${field('Name','<input name="name" required placeholder="My project">')}${field('Local root','<input name="hostRoot" required placeholder="Absolute path to your project">')}<button class="primary">Register workspace</button></form></section>
    <section class="setup-section"><div class="section-heading"><span>Try Aevra</span><strong>Start safe</strong></div><p>Connect the AI, select a workspace, then begin with status and read-only file operations. Increase permissions only when needed.</p><div class="actions"><button type="button" data-page-jump="workspaces">Workspaces</button><button type="button" data-page-jump="approvals">Approvals</button></div></section>
    <section class="setup-section wide"><div class="section-heading"><span>Explore</span><strong>${onboarding.completed?'Completed':'Finish when ready'}</strong></div><div class="explore-grid">${[['Dashboard','gateway health'],['Changes','recovery history'],['Processes','managed commands'],['Audit','security events'],['Settings','advanced controls'],['Guide','offline manual']].map(([name,desc])=>`<button type="button" data-page-jump="${name.toLowerCase()}"><b>${name}</b><span>${desc}</span></button>`).join('')}</div><div class="actions"><button type="button" class="primary" id="finish-onboarding">${onboarding.completed?'Onboarding completed':'Finish onboarding'}</button></div></section>`;
  const reload=()=>gettingStarted(el,status);
  wireRemoteAccess(el,cf,'onboard',reload);
  el.onclick=async(event)=>{const page=event.target.closest('[data-page-jump]')?.dataset.pageJump;const guideSlug=event.target.closest('[data-guide-jump]')?.dataset.guideJump;if(page){state.page=page;render();return;}if(guideSlug){state.guideSlug=guideSlug;state.page='guide';render();return;}const copy=event.target.closest('[data-copy]')?.dataset.copy;if(copy)await navigator.clipboard.writeText(copy);};
  el.querySelector('#onboard-workspace')?.addEventListener('submit',async(event)=>{event.preventDefault();await api('/api/workspaces',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(event.target)))});await reload();});
  el.querySelector('#finish-onboarding')?.addEventListener('click',async()=>{await api('/api/onboarding',{method:'PATCH',body:JSON.stringify({completed:true,completedSections:['remote-access','connect-ai','workspace','try-aevra','explore']})});await reload();});
}

function markdownToHtml(source) {
  const lines=String(source??'').split(/\r?\n/);let html='',inCode=false,inList=false;
  const closeList=()=>{if(inList){html+='</ul>';inList=false;}};
  for(const raw of lines){if(raw.startsWith('```')){closeList();inCode=!inCode;html+=inCode?'<pre><code>':'</code></pre>';continue;}if(inCode){html+=`${h(raw)}\n`;continue;}if(!raw.trim()){closeList();continue;}const heading=raw.match(/^(#{1,3})\s+(.+)$/);if(heading){closeList();const level=heading[1].length+1;html+=`<h${level}>${h(heading[2])}</h${level}>`;continue;}const item=raw.match(/^[-*]\s+(.+)$/);if(item){if(!inList){html+='<ul>';inList=true;}html+=`<li>${h(item[1])}</li>`;continue;}closeList();html+=`<p>${h(raw)}</p>`;}closeList();return html;
}

function safeMatcherGuide(text){
  const catalog=Array.isArray(window.AevraSafeCommandMatchers)?window.AevraSafeCommandMatchers:[],platforms=[['windows','Windows'],['linux','Linux'],['macos','macOS']],current=platforms.some(([id])=>id===state.safePlatform)?state.safePlatform:'windows',entries=catalog.filter(item=>(item.platforms||[]).includes(current));
  const tabs=platforms.map(([id,label])=>`<button type="button" data-safe-platform="${id}" class="${id===current?'active':''}">${label}</button>`).join('');
  const rows=entries.map(item=>`<tr><td><code>${h(item.matcher)}</code></td><td><code>${h(item.example)}</code></td><td>${h(item.purpose)}</td><td>${h(item.riskNote)}</td><td><button type="button" data-copy-matcher="${h(item.matcher)}">Copy</button></td></tr>`).join('');
  return `${markdownToHtml(text)}<section class="safe-matcher-guide"><div class="safe-platform-tabs" role="tablist" aria-label="Command matcher platform">${tabs}</div><div class="safe-matcher-table"><table><thead><tr><th>Matcher</th><th>Example</th><th>Purpose</th><th>Risk note</th><th></th></tr></thead><tbody>${rows||'<tr><td colspan="5">No recommendations for this platform.</td></tr>'}</tbody></table></div></section>`;
}

async function guide(el) {
  const chapters=await api('/api/guide');const chapter=chapters.find(x=>x.slug===state.guideSlug)??chapters[0];state.guideSlug=chapter.slug;
  const response=await fetch(`/manual/${chapter.file}`);if(!response.ok)throw new Error(`Guide chapter unavailable: HTTP ${response.status}`);const text=await response.text(),content=chapter.slug==='safe-command-matchers'?safeMatcherGuide(text):markdownToHtml(text);
  el.innerHTML=`<section class="guide-layout"><aside>${chapters.map(x=>`<button type="button" data-guide="${h(x.slug)}" class="${x.slug===chapter.slug?'active':''}">${h(x.title)}</button>`).join('')}</aside><article class="manual-content">${content}</article></section>`;
  el.onclick=async(event)=>{const slug=event.target.closest('[data-guide]')?.dataset.guide;if(slug){state.guideSlug=slug;guide(el);return;}const platform=event.target.closest('[data-safe-platform]')?.dataset.safePlatform;if(platform){state.safePlatform=platform;guide(el);return;}const matcher=event.target.closest('[data-copy-matcher]')?.dataset.copyMatcher;if(matcher)await navigator.clipboard.writeText(matcher);};
}

async function dashboard(el, status) {
  const metrics = await api('/api/metrics');
  const [approvals, sessions, processes, changes] = await Promise.all([api('/api/approvals'), api('/api/sessions'), api('/api/processes'), api('/api/changes')]);
  el.innerHTML = card('Tool usage', metrics.map((entry) => `<article><b>${h(entry.tool)}</b> ${entry.calls} calls · ${entry.avgMs}ms avg</article>`).join('') || '<p>No tool calls recorded yet.</p>') + card('Gateway status', `<div class="grid"><div><b>Core</b><strong>${h(status.core)}</strong></div><div><b>Worker</b><strong>${h(status.worker)}</strong></div><div><b>Tunnel</b><strong>${h(status.tunnel)}</strong></div><div><b>Pending</b><strong>${approvals.filter((x) => x.state === 'PENDING').length}</strong></div></div>`) + card('Activity', `<p>${sessions.length} remote sessions · ${processes.length} managed processes · ${changes.length} change sets</p>`);
}

async function workspaces(el) {
  const items = await api('/api/workspaces');
  const expanded = await Promise.all(items.map(async (workspace) => ({ ...workspace, mounts: await api(`/api/workspaces/${workspace.id}/mounts`) })));
  el.innerHTML = card('Register workspace', `<form id="workspace-form"><input name="name" placeholder="Name" required><input name="description" placeholder="Description"><input name="hostRoot" placeholder="Local host path" required><button>Add workspace</button></form>`) + card('Workspaces', expanded.map((workspace) => `<article><div class="row"><div><b>${h(workspace.name)}</b><code>${h(workspace.hostRoot ?? '')}</code></div><button data-delete-workspace="${workspace.id}">Remove</button></div><p>${h(workspace.description)}</p><h3>External mounts</h3>${workspace.mounts.map((mount) => `<div class="subrow"><code>${h(mount.logicalPath)}</code><span>${h((mount.capabilities ?? []).join(', '))}</span><button data-delete-mount="${mount.id}">Remove</button></div>`).join('') || '<p>No external mounts.</p>'}<form data-mount-form="${workspace.id}"><input name="logicalPath" placeholder="/external/shared-sdk" required><input name="hostRoot" placeholder="Local mount root" required><label><input type="checkbox" name="read" checked> Read/search</label><label><input type="checkbox" name="write"> Write</label><label><input type="checkbox" name="command"> Commands</label><input name="sensitivityPolicyId" placeholder="Sensitivity policy (optional)"><button>Add mount</button></form><h3>Actor admission</h3><form data-admission-form="${workspace.id}"><input name="actor" placeholder="actor@example.com" required><select name="profileId"><option value="read-only">Read Only</option><option value="developer" selected>Developer</option><option value="full-workspace">Full Workspace</option></select><select name="admission"><option value="auto">Auto-admit</option><option value="ask">Ask every time</option></select><button>Save admission</button></form></article>`).join('') || '<p>No workspaces registered.</p>');
  el.querySelector('#workspace-form')?.addEventListener('submit', async (event) => {event.preventDefault();await api('/api/workspaces', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(event.target))) });workspaces(el);});
  for (const form of el.querySelectorAll('[data-mount-form]')) form.addEventListener('submit', async (event) => {event.preventDefault();const data = Object.fromEntries(new FormData(event.target));const capabilities = ['files.read', 'files.search'];if (data.write) capabilities.push('files.write');if (data.command) capabilities.push('commands.run');await api(`/api/workspaces/${form.dataset.mountForm}/mounts`, { method: 'POST', body: JSON.stringify({ logicalPath: data.logicalPath, hostRoot: data.hostRoot, sensitivityPolicyId: data.sensitivityPolicyId || undefined, capabilities }) });workspaces(el);});
  for (const form of el.querySelectorAll('[data-admission-form]')) form.addEventListener('submit', async (event) => {event.preventDefault();await api(`/api/workspaces/${form.dataset.admissionForm}/admission`, { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(event.target))) });alert('Admission mapping saved.');});
  el.onclick = async (event) => {const workspaceId = event.target.closest('[data-delete-workspace]')?.dataset.deleteWorkspace;const mountId = event.target.closest('[data-delete-mount]')?.dataset.deleteMount;if (workspaceId) await api(`/api/workspaces/${workspaceId}`, { method: 'DELETE' });if (mountId) await api(`/api/mounts/${mountId}`, { method: 'DELETE' });if (workspaceId || mountId) workspaces(el);};
}

async function approvals(el) {
  const [items,pairings,workspaces]=await Promise.all([api('/api/approvals'),api('/api/oauth/requests'),api('/api/workspaces')]);
  const names=new Map(workspaces.map(workspace=>[workspace.id,workspace.name]));
  const operationMarkup=items.map((item)=>{
    const admission=item.operation?.family==='workspace:select';
    const title=admission?'Workspace access':item.operation?.family ?? item.id;
    const context=admission?`${h(item.actor)} requests access to ${h(names.get(item.workspaceId)??item.workspaceId)}`:`${h(item.workspaceId)} / ${h(item.state)}`;
    const actions=item.state!=='PENDING'?'':admission?`<div class="actions admission-actions"><button data-deny="${item.id}">Deny</button><button class="primary" data-approve="${item.id}" data-scope="once">Allow</button></div>`:`<div class="actions"><button data-deny="${item.id}">Deny</button><button class="primary" data-approve="${item.id}" data-scope="once">Run once</button><button data-approve="${item.id}" data-scope="session">Allow session</button>${item.risk === 'CRITICAL' ? '' : `<button data-approve="${item.id}" data-scope="workspace">Always workspace</button><button data-approve="${item.id}" data-scope="global">Always all</button>`}</div>`;
    return `<article class="${admission?'admission-request':''}"><div class="row"><b>${h(title)}</b><span class="risk ${String(item.risk).toLowerCase()}">${h(item.risk)}</span></div><p>${context}</p><p class="muted">${h(item.state)}</p>${actions}</article>`;
  }).join('');
  el.innerHTML=card('OAuth pairing',pairingMarkup(pairings))+card('Operation approvals',operationMarkup || '<p>No operation approvals waiting.</p>');
  el.onclick = async (event) => {if(await decideOauth(el,event,()=>approvals(el)))return;const approve = event.target.closest('[data-approve]');const deny = event.target.closest('[data-deny]');if (approve) await api(`/api/approvals/${approve.dataset.approve}/approve`, { method: 'POST', body: JSON.stringify({ scope: approve.dataset.scope }) });if (deny) await api(`/api/approvals/${deny.dataset.deny}/deny`, { method: 'POST', body: '{}' });if (approve || deny) approvals(el);};
}

async function permissions(el) {
  const [items, workspaces] = await Promise.all([api('/api/permissions'), api('/api/workspaces')]);
  const capabilities = ['files.read', 'files.search', 'git.read', 'files.write', 'files.delete', 'commands.run', 'git.commit', 'git.push', 'network'];
  el.innerHTML = card('Create permission rule', `<form id="permission-form"><select name="effect"><option value="allow">Allow</option><option value="deny">Deny</option></select><select name="capability">${capabilities.map((x) => `<option>${x}</option>`).join('')}</select><select name="scope"><option value="session">Session</option><option value="workspace" selected>Workspace</option><option value="global">Global</option></select><select name="workspaceId"><option value="">No workspace / global</option>${workspaces.map((w) => `<option value="${w.id}">${h(w.name)}</option>`).join('')}</select><input name="actor" placeholder="Actor (optional)"><input name="matcher" placeholder="Matcher, e.g. npm:test" required><button>Create rule</button></form><p>Critical operations cannot receive persistent always-allow rules.</p>`) + card('Permission rules', items.map((item) => `<article><div class="row"><b>${h(item.effect)} ${h(item.capability)}</b><code>${h(item.matcher)}</code></div><p>${h(item.scope)} ${item.workspace_id ? `· ${h(item.workspace_id)}` : ''}</p><button data-remove="${item.id}">Revoke</button></article>`).join('') || '<p>No remembered rules.</p>');
  el.querySelector('#permission-form')?.addEventListener('submit', async (event) => {event.preventDefault();const value = Object.fromEntries(new FormData(event.target));if (!value.workspaceId) delete value.workspaceId;if (!value.actor) delete value.actor;await api('/api/permissions', { method: 'POST', body: JSON.stringify(value) });permissions(el);});
  el.onclick = async (event) => {const id = event.target.closest('[data-remove]')?.dataset.remove;if (id) { await api(`/api/permissions/${id}`, { method: 'DELETE' }); permissions(el); }};
}

async function sessions(el) {
  const [remote, local, workspaces] = await Promise.all([api('/api/sessions'), api('/api/admin-sessions'), api('/api/workspaces')]);
  el.innerHTML = card('Remote MCP sessions', remote.map((session) => `<article><b>${h(session.actor)}</b><code>${h(session.id)}</code><p>${h(session.activeLeaseId ? 'workspace active' : 'no workspace')}</p><form data-switch-session="${session.id}"><select name="workspaceId">${workspaces.map((w) => `<option value="${w.id}">${h(w.name)}</option>`).join('')}</select><input type="number" name="timeoutMs" min="0" value="60000" title="Graceful drain timeout in milliseconds"><button>Switch workspace</button></form><button data-revoke-session="${session.id}">Revoke</button></article>`).join('') || '<p>No active remote sessions.</p>') + card('Local admin sessions', local.map((session) => `<article><code>${h(String(session.idHash).slice(0, 16))}…</code><p>Last used ${h(localDateTime(session.lastUsedAt))}</p><button data-revoke-admin="${session.idHash}">Revoke</button></article>`).join(''));
  for (const form of el.querySelectorAll('[data-switch-session]')) form.addEventListener('submit', async (event) => {event.preventDefault(); const value = Object.fromEntries(new FormData(event.target));await api(`/api/sessions/${form.dataset.switchSession}/workspace`, { method: 'POST', body: JSON.stringify({ workspaceId: value.workspaceId, timeoutMs: Number(value.timeoutMs) }) }); sessions(el);});
  el.onclick = async (event) => {const sessionId = event.target.closest('[data-revoke-session]')?.dataset.revokeSession;const adminId = event.target.closest('[data-revoke-admin]')?.dataset.revokeAdmin;if (sessionId) await api(`/api/sessions/${sessionId}/revoke`, { method: 'POST', body: '{}' });if (adminId) await api(`/api/admin-sessions/${adminId}/revoke`, { method: 'POST', body: '{}' });if (sessionId || adminId) sessions(el);};
}

async function connectors(el) {
  const [items,health]=await Promise.all([api('/api/connectors'),api('/api/status')]);
  const failedAttempts=Number(health?.connectorFailedAttempts??0);
  el.innerHTML=(failedAttempts>0?card('Failed connector attempts',`<p class="banner danger">${failedAttempts} failed Bearer connector admission attempt(s). Rotate credentials if a token may be stale or exposed.</p>`):'')+card('Advanced Bearer connector',`<form id="new-connector">${field('Connector name','<input name="name" placeholder="CLI client" required>')}<button class="primary">Create Bearer token</button></form><p>OAuth is preferred for ChatGPT. Use a connector when a client supports a fixed <code>Authorization: Bearer &lt;token&gt;</code> credential.</p><div id="connector-secret"></div>`)+card('Connectors',items.map(connector=>`<article><b>${h(connector.name)}</b><p>Created ${h(localDateTime(connector.createdAt))}${connector.lastUsedAt?` / last used ${h(localDateTime(connector.lastUsedAt))}`:''}</p><button data-revoke-connector="${h(connector.id)}">Revoke</button></article>`).join('')||'<p>No static Bearer connectors.</p>');
  el.querySelector('#new-connector')?.addEventListener('submit',async(event)=>{event.preventDefault();const name=String(Object.fromEntries(new FormData(event.target)).name??'').trim();if(!name)return;const created=await api('/api/connectors',{method:'POST',body:JSON.stringify({name})});el.querySelector('#connector-secret').innerHTML=`<div class="secret-result"><b>Copy this token now. It is shown once.</b><code>${h(created.token)}</code><button type="button" id="copy-connector-token">Copy token</button></div>`;el.querySelector('#copy-connector-token')?.addEventListener('click',()=>navigator.clipboard.writeText(created.token));});
  el.onclick=async(event)=>{const id=event.target.closest('[data-revoke-connector]')?.dataset.revokeConnector;if(id&&confirm('Revoke this connector?')){await api(`/api/connectors/${id}`,{method:'DELETE'});connectors(el);}};
}

async function processes(el) {
  const items = await api('/api/processes');
  el.innerHTML = card('Managed processes', items.map((processInfo) => `<article><div class="row"><b>${h(processInfo.id)}</b><span>${h(processInfo.ownership)}</span></div><p>${h(processInfo.workspace_id)} · ${h(processInfo.lifecycle)}</p>${processInfo.ownership === 'detached-uncertain' ? '<p class="warning">Ownership could not be proven after restart. Aevra will not signal this PID automatically; inspect it locally and Forget the record if it is no longer owned.</p>' : ''}<button data-process="${processInfo.id}" data-action="stop" ${processInfo.ownership === 'detached-uncertain' ? 'disabled' : ''}>Stop</button><button data-process="${processInfo.id}" data-action="restart" ${processInfo.ownership === 'detached-uncertain' ? 'disabled' : ''}>Restart</button><button data-process="${processInfo.id}" data-action="forget">Forget</button></article>`).join('') || '<p>No managed processes.</p>');
  el.onclick = async (event) => { const button = event.target.closest('[data-process]'); if (button) { await api(`/api/processes/${button.dataset.process}/${button.dataset.action}`, { method: 'POST', body: '{}' }); processes(el); } };
}

async function changes(el) {
  const items = await api('/api/changes');
  el.innerHTML = card('Change sets', items.map((change) => `<article><div class="row"><b>${h(change.name ?? change.id)}</b><span>${h(change.state)}</span></div><p>${h(change.workspace_id)}</p><form data-rename-change="${change.id}"><input name="name" value="${h(change.name ?? '')}" placeholder="Change-set name"><button>Rename</button></form>${change.state === 'OPEN' ? `<button data-change="${change.id}" data-action="commit">Keep / Commit</button><button data-change="${change.id}" data-action="rollback">Rollback</button>` : ''}</article>`).join('') || '<p>No change sets.</p>');
  for (const form of el.querySelectorAll('[data-rename-change]')) form.addEventListener('submit', async (event) => { event.preventDefault(); const value = Object.fromEntries(new FormData(event.target)); await api(`/api/changes/${form.dataset.renameChange}`, { method: 'PATCH', body: JSON.stringify(value) }); changes(el); });
  el.onclick = async (event) => { const button = event.target.closest('[data-change]'); if (!button) return; if (button.dataset.action === 'rollback' && !confirm('Rollback this change set? Conflicts will not overwrite newer work.')) return; await api(`/api/changes/${button.dataset.change}/${button.dataset.action}`, { method: 'POST', body: '{}' }); changes(el); };
}

async function audit(el) {
  const verify = await api('/api/audit/verify');
  const events = await api('/api/audit/export?format=json');
  el.innerHTML = card('Audit integrity', `<p>Hash chain: <b>${verify.valid ? 'valid' : `broken at ${h(verify.brokenEventId)}`}</b></p><a href="/api/audit/export?format=json" target="_blank">Export JSON</a> · <a href="/api/audit/export?format=jsonl" target="_blank">Export JSONL</a>`) + card('Recent events', `<input id="audit-filter" placeholder="Filter by actor or operation"><div id="audit-rows">${events.slice(-50).reverse().map((e) => `<article data-audit="${h(e.event.actor ?? '')} ${h(e.event.operation)}"><b>${h(e.event.operation)}</b>${e.event.actor ? ` · ${h(e.event.actor)}` : ''}${e.event.target ? ` · ${h(e.event.target)}` : ''}<p>${h(localDateTime(e.createdAt))}</p></article>`).join('') || '<p>No events.</p>'}</div>`);
  el.querySelector('#audit-filter').addEventListener('input', (event) => { const q = String(event.target.value ?? '').toLowerCase(); for (const row of el.querySelectorAll('[data-audit]')) row.style.display = row.dataset.audit.toLowerCase().includes(q) ? '' : 'none'; });
}

async function settings(el) {
  const [adminSettings,cf,commandFamilies,networkRules,execution,profiles,secretRefs]=await Promise.all([api('/api/settings'),api('/api/cloudflare/status'),api('/api/policy/command-families'),api('/api/policy/network-rules'),api('/api/execution-settings'),api('/api/environment-profiles'),api('/api/secret-references')]);
  const accessMode=cf.authMode==='access';
  el.innerHTML=card('Remote Access',`${remoteAccessMarkup(cf,'settings')}<details class="advanced-access"><summary>Cloudflare Access verifier</summary><form id="access-settings" class="form-grid">${field('Mode',`<select name="authMode"><option value="connector" ${!accessMode?'selected':''}>Aevra OAuth only</option><option value="access" ${accessMode?'selected':''}>Cloudflare Access plus Aevra</option></select>`)}${field('Access issuer',`<input name="issuer" value="${h(cf.issuer??'')}" placeholder="https://team.cloudflareaccess.com">`)}${field('Audience',`<input name="audience" value="${h(cf.audience??'')}" placeholder="AUD tag">`)}<button type="submit">Save Access mode</button></form></details>`).replace('class="card"','class="card remote-card"')+
    card('Execution',`<form id="execution">${field('Sandbox backend',`<select name="sandboxBackend"><option value="auto">Auto</option><option value="docker" ${execution.sandboxBackend==='docker'?'selected':''}>Docker</option><option value="podman" ${execution.sandboxBackend==='podman'?'selected':''}>Podman</option></select>`)}${field('Cache policy',`<select name="cachePolicy"><option value="workspace">Workspace cache</option><option value="shared" ${execution.cachePolicy==='shared'?'selected':''}>Shared Aevra cache</option><option value="disabled" ${execution.cachePolicy==='disabled'?'selected':''}>Disabled</option></select>`)}${field('Workspace drain timeout',`<input type="number" name="workspaceDrainMs" value="${h(execution.workspaceDrainMs??60000)}" min="0">`,'Milliseconds')}<button class="primary">Save execution settings</button></form>`)+
    card('Command-family overrides',`<form id="command-family">${field('Family','<input name="family" placeholder="my-codegen" required>')}${field('Effect','<select name="effect"><option>READ_ONLY</option><option>BUILD_OUTPUT</option><option>SOURCE_MUTATION</option><option>REPOSITORY_STATE</option><option>UNKNOWN</option></select>')}<button>Set override</button></form><pre>${h(JSON.stringify(commandFamilies,null,2))}</pre>`)+
    card('Network rules',`<form id="network-rule">${field('Effect','<select name="effect"><option value="allow">Allow</option><option value="deny">Deny</option></select>')}${field('Protocol','<input name="protocol" value="https" required>')}${field('Host','<input name="host" placeholder="api.example.com" required>')}${field('Port','<input type="number" name="port" value="443" required>')}${field('Workspace ID','<input name="workspaceId" placeholder="Blank for global">')}<button>Add rule</button></form>${networkRules.map(rule=>`<div class="subrow"><code>${h(rule.protocol)}://${h(rule.host)}:${h(rule.port)}</code><span>${h(rule.effect)} ${h(rule.workspaceId??'global')}</span><button data-network-rule="${rule.id}">Remove</button></div>`).join('')||'<p>No network rules.</p>'}`)+
    card('Environment profiles',`<form id="environment">${field('Name','<input name="name" placeholder="Development" required>')}${field('Variables','<textarea name="vars" placeholder=\'{"NODE_ENV":"development"}\'></textarea>')}${field('Secret references','<textarea name="secretRefs" placeholder=\'{"NUGET_TOKEN":"nuget-token"}\'></textarea>')}<button>Create profile</button></form><pre>${h(JSON.stringify(profiles,null,2))}</pre>`)+
    card('Secret references',`<form id="secret">${field('Reference','<input name="ref" placeholder="nuget-token" required>')}${field('Secret value','<input type="password" name="value" autocomplete="new-password" required>')}<button>Store securely</button></form>${secretRefs.map(ref=>`<div class="subrow"><code>${h(ref.ref??ref.key??ref)}</code><span>configured</span><button data-secret-ref="${encodeURIComponent(ref.ref??ref.key??ref)}">Delete</button></div>`).join('')||'<p>No secret references.</p>'}`)+
    card('Configuration',`<p><a href="/api/config/export" target="_blank">Export local config</a> / <a href="/api/config/export?portable=1" target="_blank">Export portable config</a></p><pre>${h(JSON.stringify(adminSettings,null,2))}</pre>`);
  wireRemoteAccess(el,cf,'settings',()=>settings(el));
  el.querySelector('#access-settings')?.addEventListener('submit',async(event)=>{event.preventDefault();const value=Object.fromEntries(new FormData(event.target));const current=await api('/api/cloudflare/status');if(!current.hostname)throw new Error('Configure the public hostname first');await api('/api/cloudflare/setup',{method:'POST',body:JSON.stringify({...value,hostname:current.hostname,tunnelId:current.tunnelId,ownership:current.ownership})});settings(el);});
  el.querySelector('#execution')?.addEventListener('submit',async(event)=>{event.preventDefault();const value=Object.fromEntries(new FormData(event.target));value.workspaceDrainMs=Number(value.workspaceDrainMs);await api('/api/execution-settings',{method:'PATCH',body:JSON.stringify(value)});settings(el);});
  el.querySelector('#command-family')?.addEventListener('submit',async(event)=>{event.preventDefault();const value=Object.fromEntries(new FormData(event.target));await api('/api/policy/command-families',{method:'PATCH',body:JSON.stringify({...commandFamilies,[value.family]:value.effect})});settings(el);});
  el.querySelector('#network-rule')?.addEventListener('submit',async(event)=>{event.preventDefault();const value=Object.fromEntries(new FormData(event.target));value.port=Number(value.port);if(!value.workspaceId)delete value.workspaceId;await api('/api/policy/network-rules',{method:'POST',body:JSON.stringify(value)});settings(el);});
  el.querySelector('#environment')?.addEventListener('submit',async(event)=>{event.preventDefault();const value=Object.fromEntries(new FormData(event.target));await api('/api/environment-profiles',{method:'POST',body:JSON.stringify({name:value.name,vars:json(value.vars,{}),secretRefs:json(value.secretRefs,{})})});settings(el);});
  el.querySelector('#secret')?.addEventListener('submit',async(event)=>{event.preventDefault();await api('/api/secret-references',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(event.target)))});event.target.reset();settings(el);});
  el.onclick=async(event)=>{const networkRule=event.target.closest('[data-network-rule]')?.dataset.networkRule;const secretRef=event.target.closest('[data-secret-ref]')?.dataset.secretRef;const copy=event.target.closest('[data-copy]')?.dataset.copy;if(copy)await navigator.clipboard.writeText(copy);if(networkRule){await api(`/api/policy/network-rules/${networkRule}`,{method:'DELETE'});settings(el);}if(secretRef){await api(`/api/secret-references/${secretRef}`,{method:'DELETE'});settings(el);}};
}

const pages = { 'getting-started': gettingStarted, dashboard, workspaces, approvals, permissions, sessions, connectors, processes, changes, audit, settings, guide };
async function render() {
  try {
    const [status,onboarding]=await Promise.all([api('/api/status'),api('/api/onboarding')]);
    if(state.page===null)state.page=onboarding.completed ? 'dashboard' : 'getting-started';
    root.innerHTML=shell(status);
    root.querySelector('nav').onclick=(event)=>{const page=event.target.closest('[data-page]')?.dataset.page;if(page){state.page=page;render();}};
    await pages[state.page](root.querySelector('#page'),status);
  } catch(error) {
    root.innerHTML=`<h1>Aevra</h1><div class="banner danger">${h(error.message)}</div><p>Run <code>aevra ui</code> to open an authenticated local admin session.</p>`;
  }
}
render();
