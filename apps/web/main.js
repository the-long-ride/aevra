import { closeModal } from './components/modal.js';
import {
  closeRequestDrawer,
  openRequestDrawer,
  startRequestWatch,
} from './components/request-drawer.js';
import { toast } from './components/toast.js';
import { renderAuditPage } from './pages/audit.js';
import { renderChangesPage } from './pages/changes.js';
import { renderDashboardPage } from './pages/dashboard.js';
import { renderGuidePage } from './pages/guide.js';
import { renderPermissionsPage } from './pages/permissions.js';
import { renderProcessesPage } from './pages/processes.js';
import { renderSessionsPage } from './pages/sessions.js';
import { renderSettingsPage } from './pages/settings.js';
import { renderWorkspacesPage } from './pages/workspaces.js';

const NAVIGATION = [
  ['dashboard', 'Dashboard'],
  ['permissions', 'Permissions'],
  ['workspaces', 'Workspaces'],
  ['sessions', 'Sessions'],
  ['processes', 'Processes'],
  ['changes', 'Changes'],
  ['audit', 'Audit'],
  ['settings', 'Settings'],
  ['guide', 'Guide'],
];

const renderers = {
  dashboard: renderDashboardPage,
  permissions: renderPermissionsPage,
  workspaces: renderWorkspacesPage,
  sessions: renderSessionsPage,
  processes: renderProcessesPage,
  changes: renderChangesPage,
  audit: renderAuditPage,
  settings: renderSettingsPage,
  guide: renderGuidePage,
};

const context = {
  guideSlug: null,
};
let cleanup;
let activePage = 'dashboard';

function pageFromHash() {
  const value = location.hash.replace(/^#\/?/, '').split('/')[0];
  return Object.hasOwn(renderers, value) ? value : 'dashboard';
}

function shellMarkup() {
  return `<div class="app-shell">
    <aside class="sidebar">
      <div class="brand"><span class="brand-mark">A</span><div><strong>Aevra</strong><small>Local agent gateway</small></div></div>
      <nav aria-label="Aevra admin">
        ${NAVIGATION.map(
          ([id, label]) =>
            `<button type="button" data-nav-page="${id}">${label}</button>`,
        ).join('')}
      </nav>
      <div class="sidebar-foot"><span class="local-state"><i></i> Local gateway</span></div>
    </aside>
    <main class="main-shell">
      <header class="topbar">
        <div><span class="eyebrow">Local control plane</span><strong id="page-title">Dashboard</strong></div>
        <div class="topbar-actions"><button type="button" id="open-requests">Requests</button></div>
      </header>
      <div id="page" class="page"></div>
    </main>
  </div>`;
}

function syncNavigation(page) {
  for (const button of document.querySelectorAll('[data-nav-page]')) {
    button.classList.toggle('active', button.dataset.navPage === page);
  }
  const label = NAVIGATION.find(([id]) => id === page)?.[1] ?? page;
  document.querySelector('#page-title').textContent = label;
}

async function activate(page, { updateHash = true } = {}) {
  if (!Object.hasOwn(renderers, page)) page = 'dashboard';
  if (updateHash && pageFromHash() !== page) {
    history.replaceState(null, '', `#/${page}`);
  }
  cleanup?.();
  cleanup = undefined;
  activePage = page;
  syncNavigation(page);
  const target = document.querySelector('#page');
  target.dataset.page = page;
  target.innerHTML = '<div class="page-loading">Loading…</div>';
  try {
    cleanup = (await renderers[page](target, context)) ?? undefined;
  } catch (error) {
    console.error('[Aevra UI]', error);
    target.innerHTML = `<section class="error-panel"><h2>Unable to load ${page}</h2><p></p><button type="button" id="retry-page">Retry</button></section>`;
    target.querySelector('p').textContent = error.message;
    target
      .querySelector('#retry-page')
      .addEventListener('click', () => void activate(activePage));
    toast(error.message, 'error');
  }
}

function installGlobalActions() {
  document.addEventListener('click', (event) => {
    const page = event.target.closest('[data-nav-page]')?.dataset.navPage;
    if (page) {
      void activate(page);
      return;
    }
    const guideSlug = event.target.closest('[data-guide-slug]')?.dataset
      .guideSlug;
    if (guideSlug) {
      context.guideSlug = guideSlug;
      void activate('guide');
      return;
    }
    if (
      event.target.closest('[data-open-requests]') ||
      event.target.closest('#open-requests')
    ) {
      openRequestDrawer();
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeRequestDrawer();
      closeModal();
    }
  });
  window.addEventListener('hashchange', () => {
    const page = pageFromHash();
    if (page !== activePage) void activate(page, { updateHash: false });
  });
}

function boot() {
  const root = document.querySelector('#app');
  root.innerHTML = shellMarkup();
  installGlobalActions();
  startRequestWatch();
  void activate(pageFromHash(), { updateHash: false });
}

boot();
