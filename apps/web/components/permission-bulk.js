import { requestJson } from '../core/api.js';
import { escapeHtml, unique } from '../core/dom.js';
import { openModal } from './modal.js';
import { toast } from './toast.js';

export const CAPABILITIES = [
  'files.read',
  'files.search',
  'git.read',
  'files.write',
  'files.delete',
  'commands.run',
  'git.commit',
  'git.push',
  'network',
];

const HELP = {
  'files.read': 'Read file contents',
  'files.search': 'Search workspace files',
  'git.read': 'Inspect Git state and history',
  'files.write': 'Create or modify files',
  'files.delete': 'Delete files',
  'commands.run': 'Run commands',
  'git.commit': 'Create Git commits',
  'git.push': 'Push commits to remotes',
  network: 'Access allowed network targets',
};

function isConnectorActor(actor) {
  return /^(?:connector|oauth):/.test(String(actor ?? ''));
}

function actorLabel(actor) {
  return String(actor ?? '').replace(/^(?:connector|oauth):/, '');
}

function connectorInventory(connectors, oauthClients, sessions) {
  const active = new Set(
    sessions
      .filter((item) => isConnectorActor(item.actor))
      .map((item) => String(item.actor)),
  );
  const entries = [];
  for (const item of connectors) {
    if (!item?.name) continue;
    const actor = `connector:${item.name}`;
    entries.push({
      actor,
      name: String(item.name),
      kind: 'Bearer',
      status: active.has(actor)
        ? 'Connected'
        : item.lastUsedAt
          ? 'Configured'
          : 'Never used',
    });
  }
  for (const item of oauthClients) {
    const actor = String(
      item.actor ?? `oauth:${item.clientName ?? item.client_name ?? 'MCP client'}`,
    );
    entries.push({
      actor,
      name: String(
        item.clientName ?? item.client_name ?? actorLabel(actor),
      ),
      kind: 'OAuth',
      status: active.has(actor) ? 'Connected' : 'Configured',
    });
  }
  const byActor = new Map();
  for (const entry of entries) {
    if (!byActor.has(entry.actor) || entry.status === 'Connected') {
      byActor.set(entry.actor, entry);
    }
  }
  return [...byActor.values()].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}

function capabilityCards() {
  return CAPABILITIES.map(
    (capability) => `<label class="choice-card capability-card">
      <input type="checkbox" name="capability" value="${capability}" ${
        ['files.read', 'files.search'].includes(capability) ? 'checked' : ''
      }>
      <span><code>${capability}</code><small>${escapeHtml(HELP[capability])}</small></span>
    </label>`,
  ).join('');
}

function connectorCards(inventory) {
  return inventory
    .map(
      (item) => `<label class="choice-card connector-card">
        <input type="checkbox" name="actor" value="${escapeHtml(item.actor)}">
        <span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.kind)} · ${escapeHtml(item.status)}</small></span>
      </label>`,
    )
    .join('');
}

function workspaceCards(workspaces) {
  return workspaces
    .map(
      (item) => `<label class="choice-card">
        <input type="checkbox" name="workspaceId" value="${escapeHtml(item.id)}" ${workspaces.length === 1 ? 'checked' : ''}>
        <span>${escapeHtml(item.name)}</span>
      </label>`,
    )
    .join('');
}

function sessionCards(sessions) {
  return sessions
    .filter((item) => isConnectorActor(item.actor))
    .map(
      (item) => `<label class="choice-card">
        <input type="checkbox" name="sessionId" value="${escapeHtml(item.id)}" data-actor="${escapeHtml(item.actor)}">
        <span>${escapeHtml(actorLabel(item.actor))}<small>${escapeHtml(String(item.id).slice(0, 10))}…</small></span>
      </label>`,
    )
    .join('');
}

export function openPermissionBulkEditor(
  { workspaces, sessions, connectors, oauthClients },
  reload,
) {
  const inventory = connectorInventory(connectors, oauthClients, sessions);
  const allActors = inventory.map((item) => item.actor);
  const body = `<form id="permission-bulk" class="permission-bulk">
    <section class="form-section">
      <h3>Who gets access?</h3>
      <div class="choice-grid compact">
        <label class="choice-card"><input type="radio" name="targetMode" value="all" checked><span><strong>All connectors</strong><small>${allActors.length} configured</small></span></label>
        <label class="choice-card"><input type="radio" name="targetMode" value="selected"><span><strong>Selected connectors</strong><small>Choose one or more</small></span></label>
      </div>
      <div data-selected-connectors hidden class="choice-grid">${connectorCards(inventory) || '<p>No connectors configured yet.</p>'}</div>
    </section>
    <section class="form-section">
      <h3>Where does it apply?</h3>
      <div class="choice-grid compact">
        <label class="choice-card"><input type="radio" name="scope" value="global"><span>Global</span></label>
        <label class="choice-card"><input type="radio" name="scope" value="workspace" checked><span>Workspace</span></label>
        <label class="choice-card"><input type="radio" name="scope" value="session"><span>Session</span></label>
      </div>
      <div data-workspace-targets class="choice-grid">${workspaceCards(workspaces) || '<p>No workspaces registered.</p>'}</div>
      <div data-session-targets hidden class="choice-grid">${sessionCards(sessions) || '<p>No live connector sessions.</p>'}</div>
    </section>
    <section class="form-section wide">
      <div class="section-heading"><h3>What can they do?</h3><div class="actions"><button type="button" data-select-all>Select all</button><button type="button" data-clear>Clear</button></div></div>
      <div class="choice-grid capability-grid">${capabilityCards()}</div>
    </section>
    <section class="form-section wide">
      <h3>Rule details</h3>
      <label class="field"><span>Effect</span><select name="effect"><option value="allow">Allow</option><option value="deny">Deny</option></select></label>
      <div data-command-matchers hidden>
        <label class="field"><span>Command matchers</span><textarea name="commandMatchers" rows="6" placeholder="git:status&#10;git:diff&#10;npm:test"></textarea><small>One normalized matcher per line.</small></label>
        <p class="warning" data-matcher-warning hidden><strong>Broad command access:</strong> <code>*</code> allows every command matcher not otherwise denied.</p>
      </div>
    </section>
    <footer class="modal-inline-foot"><span data-rule-count>Create 0 rules</span><button class="primary" data-create disabled>Create 0 rules</button></footer>
  </form>`;
  openModal('Add permission rules', body, {
    onReady(content) {
      const form = content.querySelector('#permission-bulk');
      const selected = form.querySelector('[data-selected-connectors]');
      const workspaceTargets = form.querySelector('[data-workspace-targets]');
      const sessionTargets = form.querySelector('[data-session-targets]');
      const matcherBox = form.querySelector('[data-command-matchers]');
      const matcherInput = form.querySelector('[name=commandMatchers]');
      const warning = form.querySelector('[data-matcher-warning]');
      const count = form.querySelector('[data-rule-count]');
      const create = form.querySelector('[data-create]');

      const refresh = () => {
        const targetMode = form.querySelector('[name=targetMode]:checked')?.value ?? 'all';
        const scope = form.querySelector('[name=scope]:checked')?.value ?? 'workspace';
        selected.hidden = targetMode !== 'selected';
        workspaceTargets.hidden = scope !== 'workspace';
        sessionTargets.hidden = scope !== 'session';
        const actors = targetMode === 'all'
          ? allActors
          : [...form.querySelectorAll('[name=actor]:checked')].map((item) => item.value);
        const capabilities = [...form.querySelectorAll('[name=capability]:checked')].map((item) => item.value);
        const commands = capabilities.includes('commands.run');
        const matchers = commands
          ? unique(String(matcherInput.value ?? '').split(/\r?\n/).map((value) => value.trim()))
          : [];
        matcherBox.hidden = !commands;
        warning.hidden = !matchers.includes('*');
        for (const input of form.querySelectorAll('[name=sessionId]')) {
          const allowed = actors.includes(input.dataset.actor);
          input.disabled = !allowed;
          if (!allowed) input.checked = false;
        }
        const targets = scope === 'global'
          ? 1
          : scope === 'workspace'
            ? form.querySelectorAll('[name=workspaceId]:checked').length
            : form.querySelectorAll('[name=sessionId]:checked').length;
        const expanded = capabilities.filter((item) => item !== 'commands.run').length + (commands ? matchers.length : 0);
        const total = actors.length * targets * expanded;
        const label = `Create ${total} rule${total === 1 ? '' : 's'}`;
        count.textContent = label;
        create.textContent = label;
        create.disabled = total === 0 || (commands && matchers.length === 0);
      };

      form.addEventListener('change', refresh);
      matcherInput.addEventListener('input', refresh);
      form.querySelector('[data-select-all]').addEventListener('click', () => {
        for (const input of form.querySelectorAll('[name=capability]')) input.checked = true;
        refresh();
      });
      form.querySelector('[data-clear]').addEventListener('click', () => {
        for (const input of form.querySelectorAll('[name=capability]')) input.checked = false;
        refresh();
      });
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const targetMode = form.querySelector('[name=targetMode]:checked')?.value ?? 'all';
        const scope = form.querySelector('[name=scope]:checked')?.value ?? 'workspace';
        const payload = {
          effect: form.querySelector('[name=effect]').value,
          scope,
          actors: targetMode === 'all' ? allActors : [...form.querySelectorAll('[name=actor]:checked')].map((item) => item.value),
          capabilities: [...form.querySelectorAll('[name=capability]:checked')].map((item) => item.value),
          commandMatchers: unique(String(matcherInput.value ?? '').split(/\r?\n/).map((value) => value.trim())),
          workspaceIds: [...form.querySelectorAll('[name=workspaceId]:checked')].map((item) => item.value),
          sessionIds: [...form.querySelectorAll('[name=sessionId]:checked')].map((item) => item.value),
        };
        await requestJson('/api/permissions/bulk', { method: 'POST', body: JSON.stringify(payload) });
        toast('Permission rules created', 'success');
        document.querySelector('.modal-backdrop')?.remove();
        await reload();
      });
      refresh();
    },
  });
}
