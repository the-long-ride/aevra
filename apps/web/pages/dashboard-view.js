import { escapeHtml } from '../core/dom.js';
import { duration } from '../core/time.js';
import { remoteAccessMarkup } from '../components/remote-access.js';

export function collapsibleMarkup(id, title, body, open = true) {
  return `<details class="dashboard-section" data-dashboard-section="${id}" ${open ? 'open' : ''}>
    <summary class="dashboard-section-summary"><span>${escapeHtml(title)}</span><span aria-hidden="true">⌄</span></summary>
    <div class="dashboard-section-body">${body}</div>
  </details>`;
}

export function runtimeOverviewMarkup(snapshot) {
  const rows = [
    [
      'Version',
      snapshot.status?.version
        ? `v${String(snapshot.status.version).replace(/^v/, '')}`
        : '—',
    ],
    ['Uptime', duration(snapshot.uptimeSeconds)],
    ['Remote sessions', snapshot.stats.sessions],
    ['Workspace leases', snapshot.stats.workspaceLeases],
    ['Pending requests', snapshot.pending.total],
    ['Managed processes', snapshot.stats.processes],
    ['Open changes', snapshot.stats.openChanges],
    ['Tool calls', snapshot.stats.toolCalls],
    [
      'Avg tool latency',
      snapshot.stats.avgToolLatencyMs == null
        ? '—'
        : `${snapshot.stats.avgToolLatencyMs} ms`,
    ],
    ['Connectors', snapshot.stats.connectors],
  ];
  return `<div class="runtime-grid">${rows
    .map(
      ([label, value]) =>
        `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`,
    )
    .join('')}</div>`;
}

export function onboardingMarkup(onboarding, cloudflare, workspaces) {
  const endpoint = cloudflare?.hostname
    ? `https://${cloudflare.hostname}/mcp`
    : 'Configure Remote Access first';
  const providers = [
    ['ChatGPT', 'Create a custom MCP app and use OAuth.'],
    ['Claude', 'Add a remote MCP server and authenticate with OAuth.'],
    ['Gemini', 'Add the MCP endpoint and complete OAuth.'],
  ];
  return `<div class="onboarding-body">
    <section class="onboarding-block wide" data-onboarding-section="remote-access">
      <div class="section-heading"><span>Remote Access</span><strong>${cloudflare?.hostname ? 'Configured' : 'Setup needed'}</strong></div>
      ${remoteAccessMarkup(cloudflare, 'dashboard')}
    </section>
    <section class="onboarding-block wide" data-onboarding-section="connect-ai">
      <div class="section-heading"><span>Connect an AI</span><strong>Example guide</strong></div>
      <p class="section-note">Examples only; provider screens can change.</p>
      <div class="endpoint"><span>MCP endpoint</span><code>${escapeHtml(endpoint)}</code></div>
      <div class="client-grid">${providers
        .map(
          ([name, description]) =>
            `<article class="client-example"><h3>${name}</h3><p>${description}</p><p>Authentication: <b>OAuth</b></p><button type="button" data-guide-slug="connect-${name.toLowerCase()}">Open guide</button></article>`,
        )
        .join('')}</div>
    </section>
    <section class="onboarding-block" data-onboarding-section="workspace">
      <div class="section-heading"><span>Workspace</span><strong>${workspaces.length ? `${workspaces.length} registered` : 'Register one'}</strong></div>
      ${
        workspaces.length
          ? '<p>Your local workspace is ready. Manage details from Workspaces.</p><button type="button" data-nav-page="workspaces">Open Workspaces</button>'
          : '<form id="onboard-workspace" class="stack-form"><input name="name" placeholder="Workspace name" required><input name="hostRoot" placeholder="Absolute path to your project" required><button class="primary">Register workspace</button></form>'
      }
    </section>
    <section class="onboarding-block" data-onboarding-section="try-aevra">
      <div class="section-heading"><span>Try Aevra</span><strong>Start read-only</strong></div>
      <p>Select a workspace from chat, approve access locally, then start with status, skills and file reads.</p>
      <div class="actions"><button type="button" data-open-requests>Requests</button><button type="button" data-nav-page="workspaces">Workspaces</button></div>
    </section>
    <section class="onboarding-block wide onboarding-finish" data-onboarding-section="finish-onboarding">
      <div><b>${onboarding.completed ? 'Onboarding completed' : 'Finish onboarding when setup is ready'}</b></div>
      <button type="button" class="primary" id="finish-onboarding" ${onboarding.completed ? 'disabled' : ''}>${onboarding.completed ? 'Completed' : 'Finish onboarding'}</button>
    </section>
  </div>`;
}

export function recentActivityMarkup(snapshot) {
  const rows = [
    ['Requests', snapshot.pending.total, 'awaiting local action'],
    ['Sessions', snapshot.stats.sessions, 'remote MCP sessions'],
    ['Processes', snapshot.stats.processes, 'managed locally'],
    ['Changes', snapshot.stats.openChanges, 'open change sets'],
  ];
  return `<div class="recent-grid">${rows
    .map(
      ([label, value, detail]) =>
        `<div><span>${label}</span><strong>${value}</strong><small>${detail}</small></div>`,
    )
    .join('')}</div>`;
}
