const PRIMARY_DASHBOARD_SECTIONS = [
  'runtime-overview',
  'active-connections',
  'tool-activity',
  'connections',
  'recent-activity',
];

export function dashboardSectionOrder(completed) {
  return completed
    ? [...PRIMARY_DASHBOARD_SECTIONS, 'onboarding']
    : ['onboarding', ...PRIMARY_DASHBOARD_SECTIONS];
}

function isOnboardingCompleted(onboarding) {
  const summary = onboarding.querySelector('summary');
  return /\bCompleted\b/i.test(summary?.textContent ?? '');
}

function removeStaleRemoteAccessCopy(onboarding) {
  const note = onboarding.querySelector('.onboarding-finish p');
  if (
    note?.textContent?.includes(
      'Remote Access remains visible above this section after completion.',
    )
  ) {
    note.remove();
  }
}

export function applyDashboardOnboardingLayout(page) {
  const onboarding = page?.querySelector('.onboarding-panel');
  const remoteAccess = page?.querySelector('.dashboard-remote');
  const onboardingBody = onboarding?.querySelector('.onboarding-body');

  if (!onboarding || !remoteAccess || !onboardingBody) {
    return false;
  }

  const remoteWrapper = remoteAccess.parentElement?.matches?.(
    'details.dashboard-section',
  )
    ? remoteAccess.parentElement
    : null;

  remoteAccess.classList.add('onboarding-block', 'wide');

  if (remoteAccess.parentElement !== onboardingBody) {
    onboardingBody.prepend(remoteAccess);
  }

  if (remoteWrapper && remoteWrapper !== onboarding) {
    remoteWrapper.remove();
  }

  removeStaleRemoteAccessCopy(onboarding);

  if (isOnboardingCompleted(onboarding) && onboarding.parentElement === page) {
    page.append(onboarding);
  }

  return true;
}

function applyCurrentDashboardLayout() {
  const page = document.querySelector('#page');
  if (page?.dataset.uiV2 !== 'dashboard') {
    return;
  }
  applyDashboardOnboardingLayout(page);
}

function installDashboardOnboardingLayout() {
  applyCurrentDashboardLayout();

  const observer = new MutationObserver(() => {
    applyCurrentDashboardLayout();
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
}

if (typeof document !== 'undefined' && typeof MutationObserver !== 'undefined') {
  installDashboardOnboardingLayout();
}
