import { requestJson } from '../core/api.js';
import { escapeHtml } from '../core/dom.js';
import { closeModal, openModal } from './modal.js';
import { toast } from './toast.js';

function row(cells) {
  return `<tr>${cells.map((cell) => `<td>${cell}</td>`).join('')}</tr>`;
}

function table(headers, rows) {
  return `<div class="table-scroll"><table class="simple-table"><thead><tr>${headers
    .map((header) => `<th>${escapeHtml(header)}</th>`)
    .join('')}</tr></thead><tbody>${rows || `<tr><td colspan="${headers.length}">No records</td></tr>`}</tbody></table></div>`;
}

export function openNewWorkspace(reload) {
  openModal(
    'Add workspace',
    `<form id="new-workspace" class="stack-form">
      <label class="field"><span>Name</span><input name="name" required></label>
      <label class="field"><span>Local root</span><input name="hostRoot" placeholder="F:\\my-repos\\project" required></label>
      <label class="field"><span>Description</span><input name="description"></label>
      <button class="primary">Add workspace</button>
    </form>`,
    {
      onReady(body) {
        body.querySelector('#new-workspace').addEventListener('submit', async (event) => {
          event.preventDefault();
          await requestJson('/api/workspaces', {
            method: 'POST',
            body: JSON.stringify(Object.fromEntries(new FormData(event.target))),
          });
          closeModal();
          toast('Workspace added', 'success');
          await reload();
        });
      },
    },
  );
}

export async function openWorkspaceDetail(workspaceId, reload) {
  const [workspaces, mounts, admissions, connectors] = await Promise.all([
    requestJson('/api/workspaces'),
    requestJson(`/api/workspaces/${encodeURIComponent(workspaceId)}/mounts`),
    requestJson(`/api/workspaces/${encodeURIComponent(workspaceId)}/admissions`),
    requestJson('/api/connectors'),
  ]);
  const workspace = workspaces.find((item) => item.id === workspaceId);
  if (!workspace) throw new Error('Workspace not found');
  const actors = connectors
    .filter((item) => item?.name)
    .map((item) => `connector:${item.name}`);
  const mountRows = mounts
    .map((item) =>
      row([
        `<code>${escapeHtml(item.logicalPath)}</code>`,
        `<code>${escapeHtml(item.hostRoot ?? '')}</code>`,
        escapeHtml((item.capabilities ?? []).join(', ')),
        escapeHtml(item.sensitivityPolicyId ?? 'Default'),
        `<button type="button" data-remove-mount="${escapeHtml(item.id)}">Remove</button>`,
      ]),
    )
    .join('');
  const admissionRows = admissions
    .map((item) =>
      row([
        escapeHtml(item.actor),
        escapeHtml(item.profileName ?? item.profileId),
        escapeHtml(item.admission),
      ]),
    )
    .join('');
  const body = `<section class="form-section">
      <h3>Workspace</h3>
      <div class="details-grid">
        <div><span>Name</span><strong>${escapeHtml(workspace.name)}</strong></div>
        <div><span>Local root</span><code>${escapeHtml(workspace.hostRoot ?? '')}</code></div>
        <div><span>Description</span><strong>${escapeHtml(workspace.description ?? '—')}</strong></div>
      </div>
    </section>
    <section class="form-section">
      <h3>External mounts</h3>
      <form id="add-mount" class="form-row">
        <label class="field"><span>Logical path</span><input name="logicalPath" placeholder="/external/shared-sdk" required></label>
        <label class="field"><span>Local mount root</span><input name="hostRoot" required></label>
        <label class="field"><span>Sensitivity policy</span><input name="sensitivityPolicyId" placeholder="Optional"></label>
        <label class="choice-inline"><input type="checkbox" name="read" checked> Read/search</label>
        <label class="choice-inline"><input type="checkbox" name="write"> Write</label>
        <label class="choice-inline"><input type="checkbox" name="command"> Commands</label>
        <button class="primary">Add mount</button>
      </form>
      ${table(['Logical path', 'Local root', 'Capabilities', 'Sensitivity', ''], mountRows)}
    </section>
    <section class="form-section">
      <h3>Actor admission</h3>
      <form id="admission" class="form-row">
        <label class="field"><span>Actor</span><input name="actor" list="actor-list" placeholder="connector:ChatGPT" required><datalist id="actor-list">${actors.map((actor) => `<option value="${escapeHtml(actor)}"></option>`).join('')}</datalist></label>
        <label class="field"><span>Profile</span><select name="profileId"><option value="read-only">Read Only</option><option value="developer" selected>Developer</option><option value="full-workspace">Full Workspace</option></select></label>
        <label class="field"><span>Admission</span><select name="admission"><option value="auto">Auto-admit</option><option value="ask">Ask every time</option></select></label>
        <button class="primary">Save admission</button>
      </form>
      ${table(['Actor', 'Profile', 'Admission'], admissionRows)}
    </section>
    <section class="form-section danger-zone"><h3>Danger zone</h3><button type="button" class="danger-button" id="remove-workspace">Remove workspace</button></section>`;

  openModal(`Workspace · ${workspace.name}`, body, {
    onReady(content) {
      const refresh = async () => {
        closeModal();
        await reload();
        await openWorkspaceDetail(workspaceId, reload);
      };
      content.querySelector('#add-mount').addEventListener('submit', async (event) => {
        event.preventDefault();
        const data = Object.fromEntries(new FormData(event.target));
        const capabilities = ['files.read', 'files.search'];
        if (data.write) capabilities.push('files.write');
        if (data.command) capabilities.push('commands.run');
        await requestJson(`/api/workspaces/${encodeURIComponent(workspaceId)}/mounts`, {
          method: 'POST',
          body: JSON.stringify({
            logicalPath: data.logicalPath,
            hostRoot: data.hostRoot,
            sensitivityPolicyId: data.sensitivityPolicyId || undefined,
            capabilities,
          }),
        });
        toast('External mount added', 'success');
        await refresh();
      });
      content.querySelector('#admission').addEventListener('submit', async (event) => {
        event.preventDefault();
        await requestJson(`/api/workspaces/${encodeURIComponent(workspaceId)}/admission`, {
          method: 'POST',
          body: JSON.stringify(Object.fromEntries(new FormData(event.target))),
        });
        toast('Admission mapping saved', 'success');
        await refresh();
      });
      content.addEventListener('click', async (event) => {
        const mountId = event.target.closest('[data-remove-mount]')?.dataset.removeMount;
        if (mountId && confirm('Remove this external mount?')) {
          await requestJson(`/api/mounts/${encodeURIComponent(mountId)}`, { method: 'DELETE' });
          toast('External mount removed', 'success');
          await refresh();
          return;
        }
        if (event.target.closest('#remove-workspace') && confirm('Remove this workspace registration?')) {
          await requestJson(`/api/workspaces/${encodeURIComponent(workspaceId)}`, { method: 'DELETE' });
          closeModal();
          toast('Workspace removed', 'success');
          await reload();
        }
      });
    },
  });
}
