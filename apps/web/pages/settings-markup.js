import { escapeHtml } from '../core/dom.js';
import { remoteAccessMarkup } from '../components/remote-access.js';

function simpleTable(headers, rows) {
  return `<div class="table-scroll"><table class="simple-table"><thead><tr>${headers
    .map((header) => `<th>${escapeHtml(header)}</th>`)
    .join('')}</tr></thead><tbody>${rows || `<tr><td colspan="${headers.length}">No records</td></tr>`}</tbody></table></div>`;
}

function commandRows(commandFamilies) {
  return Object.entries(commandFamilies)
    .map(
      ([family, effect]) => `<tr>
        <td><code>${escapeHtml(family)}</code></td>
        <td>${escapeHtml(effect)}</td>
        <td><button type="button" data-command-remove="${escapeHtml(family)}">Remove</button></td>
      </tr>`,
    )
    .join('');
}

function networkRows(rules, workspaceNames) {
  return rules
    .map(
      (rule) => `<tr>
        <td><span class="badge ${rule.effect === 'allow' ? 'good' : ''}">${escapeHtml(rule.effect)}</span></td>
        <td><code>${escapeHtml(rule.protocol)}://${escapeHtml(rule.host)}:${escapeHtml(rule.port)}</code></td>
        <td>${escapeHtml(workspaceNames.get(rule.workspaceId) ?? rule.workspaceId ?? 'Global')}</td>
        <td><button type="button" data-network-remove="${escapeHtml(rule.id)}">Remove</button></td>
      </tr>`,
    )
    .join('');
}

function profileRows(profiles) {
  return profiles
    .map(
      (profile) => `<tr>
        <td>${escapeHtml(profile.name ?? profile.id)}</td>
        <td><code>${escapeHtml(typeof profile.vars === 'object' ? JSON.stringify(profile.vars) : profile.vars_json ?? profile.vars ?? '{}')}</code></td>
        <td><code>${escapeHtml(typeof profile.secretRefs === 'object' ? JSON.stringify(profile.secretRefs) : profile.secret_refs_json ?? profile.secretRefs ?? '{}')}</code></td>
      </tr>`,
    )
    .join('');
}

function secretRows(secretRefs) {
  return secretRefs
    .map((value) => {
      const ref = value?.ref ?? value?.key ?? value;
      return `<tr>
        <td><code>${escapeHtml(ref)}</code></td>
        <td><span class="badge good">Configured</span></td>
        <td><button type="button" data-secret-remove="${encodeURIComponent(ref)}">Delete</button></td>
      </tr>`;
    })
    .join('');
}

export function settingsMarkup(data) {
  const {
    adminSettings,
    cloudflare,
    commandFamilies,
    networkRules,
    execution,
    profiles,
    secretRefs,
    workspaces,
  } = data;
  const workspaceNames = new Map(workspaces.map((item) => [item.id, item.name]));
  const accessMode = cloudflare.authMode === 'access';
  const nativeExecution = execution.sandboxBackend === 'native';
  return `<section class="page-head"><div><h2>Settings</h2><p>Execution, remote access, network, environment, and secure local configuration.</p></div></section>
    <section class="panel remote-card">
      <div class="panel-head"><h3>Remote Access</h3></div>
      ${remoteAccessMarkup(cloudflare, 'settings')}
      <details class="advanced-access">
        <summary>Cloudflare Access verifier</summary>
        <form id="access-settings" class="form-row">
          <label class="field"><span>Mode</span><select name="authMode"><option value="connector" ${!accessMode ? 'selected' : ''}>Aevra OAuth only</option><option value="access" ${accessMode ? 'selected' : ''}>Cloudflare Access plus Aevra</option></select></label>
          <label class="field"><span>Access issuer</span><input name="issuer" value="${escapeHtml(cloudflare.issuer ?? '')}" placeholder="https://team.cloudflareaccess.com"></label>
          <label class="field"><span>Audience</span><input name="audience" value="${escapeHtml(cloudflare.audience ?? '')}" placeholder="AUD tag"></label>
          <button>Save Access mode</button>
        </form>
      </details>
    </section>
    <div class="settings-grid">
      <section class="panel execution-panel">
        <div class="panel-head"><h3>Execution</h3></div>
        <form id="execution-settings" class="stack-form">
          <label class="field"><span>Sandbox backend</span><select name="sandboxBackend"><option value="auto" ${execution.sandboxBackend === 'auto' ? 'selected' : ''}>Auto</option><option value="docker" ${execution.sandboxBackend === 'docker' ? 'selected' : ''}>Docker</option><option value="podman" ${execution.sandboxBackend === 'podman' ? 'selected' : ''}>Podman</option><option value="native" ${nativeExecution ? 'selected' : ''}>Native host</option></select></label>
          <p class="execution-warning" data-native-warning ${nativeExecution ? '' : 'hidden'}>Direct computer access — no container isolation. Commands run on this machine and still pass through Aevra permissions and approvals.</p>
          <label class="field"><span>Cache policy</span><select name="cachePolicy"><option value="workspace" ${execution.cachePolicy === 'workspace' ? 'selected' : ''}>Workspace</option><option value="shared" ${execution.cachePolicy === 'shared' ? 'selected' : ''}>Shared</option><option value="disabled" ${execution.cachePolicy === 'disabled' ? 'selected' : ''}>Disabled</option></select></label>
          <label class="field"><span>Drain timeout (ms)</span><input type="number" name="workspaceDrainMs" min="0" value="${escapeHtml(execution.workspaceDrainMs ?? 60000)}"></label>
          <button class="primary">Save</button>
        </form>
      </section>
      <section class="panel">
        <div class="panel-head"><h3>Configuration</h3></div>
        <div class="actions"><a href="/api/config/export" target="_blank"><button type="button">Export local</button></a><a href="/api/config/export?portable=1" target="_blank"><button type="button">Export portable</button></a></div>
        <pre>${escapeHtml(JSON.stringify(adminSettings, null, 2))}</pre>
      </section>
      <section class="panel wide">
        <div class="panel-head"><h3>Command-family overrides</h3></div>
        <form id="command-family" class="form-row"><label class="field"><span>Family</span><input name="family" placeholder="my-codegen" required></label><label class="field"><span>Effect</span><select name="effect"><option>READ_ONLY</option><option>BUILD_OUTPUT</option><option>SOURCE_MUTATION</option><option>REPOSITORY_STATE</option><option>UNKNOWN</option></select></label><button class="primary">Set override</button></form>
        ${simpleTable(['Family', 'Effect', ''], commandRows(commandFamilies))}
      </section>
      <section class="panel wide">
        <div class="panel-head"><h3>Network rules</h3></div>
        <form id="network-rule" class="form-row"><label class="field"><span>Effect</span><select name="effect"><option value="allow">Allow</option><option value="deny">Deny</option></select></label><label class="field"><span>Protocol</span><input name="protocol" value="https" required></label><label class="field"><span>Host</span><input name="host" placeholder="api.example.com" required></label><label class="field"><span>Port</span><input type="number" name="port" value="443" required></label><label class="field"><span>Workspace</span><select name="workspaceId"><option value="">Global</option>${workspaces.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join('')}</select></label><button class="primary">Add rule</button></form>
        ${simpleTable(['Effect', 'Destination', 'Scope', ''], networkRows(networkRules, workspaceNames))}
      </section>
      <section class="panel wide">
        <div class="panel-head"><h3>Environment profiles</h3></div>
        <form id="environment-profile" class="form-row"><label class="field"><span>Name</span><input name="name" required></label><label class="field"><span>Variables JSON</span><textarea name="vars" placeholder='{"NODE_ENV":"development"}'></textarea></label><label class="field"><span>Secret refs JSON</span><textarea name="secretRefs" placeholder='{"NUGET_TOKEN":"nuget-token"}'></textarea></label><button class="primary">Create profile</button></form>
        ${simpleTable(['Name', 'Variables', 'Secret references'], profileRows(profiles))}
      </section>
      <section class="panel wide">
        <div class="panel-head"><h3>Secret references</h3></div>
        <form id="secret-reference" class="form-row"><label class="field"><span>Reference</span><input name="ref" required></label><label class="field"><span>Secret value</span><input type="password" name="value" autocomplete="new-password" required></label><button class="primary">Store securely</button></form>
        ${simpleTable(['Reference', 'State', ''], secretRows(secretRefs))}
      </section>
    </div>`;
}
