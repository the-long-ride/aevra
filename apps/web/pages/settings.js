import { requestJson } from '../core/api.js';
import { parseJson } from '../core/dom.js';
import { wireRemoteAccess } from '../components/remote-access.js';
import { toast } from '../components/toast.js';
import { settingsMarkup } from './settings-markup.js';

async function loadSettings() {
  const [
    adminSettings,
    cloudflare,
    commandFamilies,
    networkRules,
    execution,
    profiles,
    secretRefs,
    workspaces,
  ] = await Promise.all([
    requestJson('/api/settings'),
    requestJson('/api/cloudflare/status'),
    requestJson('/api/policy/command-families'),
    requestJson('/api/policy/network-rules'),
    requestJson('/api/execution-settings'),
    requestJson('/api/environment-profiles'),
    requestJson('/api/secret-references'),
    requestJson('/api/workspaces'),
  ]);
  return {
    adminSettings,
    cloudflare,
    commandFamilies,
    networkRules,
    execution,
    profiles,
    secretRefs,
    workspaces,
  };
}

export async function renderSettingsPage(container) {
  const render = async () => {
    const data = await loadSettings();
    container.innerHTML = settingsMarkup(data);
    wireRemoteAccess(container, data.cloudflare, 'settings', render);

    container
      .querySelector('#access-settings')
      .addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!data.cloudflare.hostname) {
          toast('Configure the public hostname first', 'error');
          return;
        }
        const value = Object.fromEntries(new FormData(event.target));
        await requestJson('/api/cloudflare/setup', {
          method: 'POST',
          body: JSON.stringify({
            ...value,
            hostname: data.cloudflare.hostname,
            tunnelId: data.cloudflare.tunnelId,
            ownership: data.cloudflare.ownership,
          }),
        });
        toast('Cloudflare Access mode saved', 'success');
        await render();
      });

    container
      .querySelector('#execution-settings')
      .addEventListener('submit', async (event) => {
        event.preventDefault();
        const value = Object.fromEntries(new FormData(event.target));
        value.workspaceDrainMs = Number(value.workspaceDrainMs);
        await requestJson('/api/execution-settings', {
          method: 'PATCH',
          body: JSON.stringify(value),
        });
        toast('Execution settings saved', 'success');
        await render();
      });

    container
      .querySelector('#command-family')
      .addEventListener('submit', async (event) => {
        event.preventDefault();
        const value = Object.fromEntries(new FormData(event.target));
        await requestJson('/api/policy/command-families', {
          method: 'PATCH',
          body: JSON.stringify({
            ...data.commandFamilies,
            [value.family]: value.effect,
          }),
        });
        toast('Command-family override saved', 'success');
        await render();
      });

    container
      .querySelector('#network-rule')
      .addEventListener('submit', async (event) => {
        event.preventDefault();
        const value = Object.fromEntries(new FormData(event.target));
        value.port = Number(value.port);
        if (!value.workspaceId) delete value.workspaceId;
        await requestJson('/api/policy/network-rules', {
          method: 'POST',
          body: JSON.stringify(value),
        });
        toast('Network rule added', 'success');
        await render();
      });

    container
      .querySelector('#environment-profile')
      .addEventListener('submit', async (event) => {
        event.preventDefault();
        const value = Object.fromEntries(new FormData(event.target));
        await requestJson('/api/environment-profiles', {
          method: 'POST',
          body: JSON.stringify({
            name: value.name,
            vars: parseJson(value.vars, {}),
            secretRefs: parseJson(value.secretRefs, {}),
          }),
        });
        toast('Environment profile created', 'success');
        await render();
      });

    container
      .querySelector('#secret-reference')
      .addEventListener('submit', async (event) => {
        event.preventDefault();
        await requestJson('/api/secret-references', {
          method: 'POST',
          body: JSON.stringify(Object.fromEntries(new FormData(event.target))),
        });
        toast('Secret reference stored', 'success');
        await render();
      });

    container.addEventListener('click', async (event) => {
      const family = event.target.closest('[data-command-remove]')?.dataset
        .commandRemove;
      if (family) {
        const next = { ...data.commandFamilies };
        delete next[family];
        await requestJson('/api/policy/command-families', {
          method: 'PATCH',
          body: JSON.stringify(next),
        });
        toast('Command-family override removed', 'success');
        await render();
        return;
      }
      const networkId = event.target.closest('[data-network-remove]')?.dataset
        .networkRemove;
      if (networkId) {
        await requestJson(
          `/api/policy/network-rules/${encodeURIComponent(networkId)}`,
          { method: 'DELETE' },
        );
        toast('Network rule removed', 'success');
        await render();
        return;
      }
      const secret = event.target.closest('[data-secret-remove]')?.dataset
        .secretRemove;
      if (secret) {
        await requestJson(`/api/secret-references/${secret}`, {
          method: 'DELETE',
        });
        toast('Secret reference removed', 'success');
        await render();
      }
    });
  };
  await render();
}
