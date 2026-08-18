import assert from 'node:assert/strict';
import test from 'node:test';

const { dashboardSectionOrder, applyDashboardOnboardingLayout } = await import(
  new URL('../../apps/web/dashboard-onboarding-layout.js', import.meta.url),
);

test('incomplete onboarding stays first', () => {
  assert.deepEqual(dashboardSectionOrder(false), [
    'onboarding',
    'runtime-overview',
    'active-connections',
    'tool-activity',
    'connections',
    'recent-activity',
  ]);
});

test('completed onboarding moves to the bottom', () => {
  assert.deepEqual(dashboardSectionOrder(true), [
    'runtime-overview',
    'active-connections',
    'tool-activity',
    'connections',
    'recent-activity',
    'onboarding',
  ]);
});

function fakeDashboard({ completed }) {
  const events = [];
  const classNames = new Set();
  const page = {
    append(node) {
      events.push(['append', node]);
    },
    querySelector(selector) {
      if (selector === '.onboarding-panel') return onboarding;
      if (selector === '.dashboard-remote') return remote;
      return null;
    },
  };
  const body = {
    prepend(node) {
      events.push(['prepend', node]);
      node.parentElement = body;
    },
  };
  const summary = {
    textContent: completed
      ? 'Onboarding Completed · expand anytime'
      : 'Onboarding Setup guide',
  };
  const stale = {
    textContent: 'Remote Access remains visible above this section after completion.',
    remove() {
      events.push(['remove-stale-copy']);
    },
  };
  const onboarding = {
    parentElement: page,
    querySelector(selector) {
      if (selector === '.onboarding-body') return body;
      if (selector === 'summary') return summary;
      if (selector === '.onboarding-finish p') return stale;
      return null;
    },
  };
  const remote = {
    parentElement: page,
    classList: {
      add(...names) {
        for (const name of names) classNames.add(name);
      },
    },
  };
  return { page, onboarding, remote, body, events, classNames };
}

test('layout moves Remote Access into Onboarding as the first full-width block', () => {
  const fixture = fakeDashboard({ completed: false });

  assert.equal(applyDashboardOnboardingLayout(fixture.page), true);
  assert.deepEqual(fixture.events[0], ['prepend', fixture.remote]);
  assert.equal(fixture.remote.parentElement, fixture.body);
  assert.equal(fixture.classNames.has('onboarding-block'), true);
  assert.equal(fixture.classNames.has('wide'), true);
  assert.equal(fixture.events.some(([event]) => event === 'append'), false);
});

test('completed layout puts the whole Onboarding panel at the Dashboard bottom and removes stale copy', () => {
  const fixture = fakeDashboard({ completed: true });

  assert.equal(applyDashboardOnboardingLayout(fixture.page), true);
  assert.deepEqual(fixture.events.at(-2), ['remove-stale-copy']);
  assert.deepEqual(fixture.events.at(-1), ['append', fixture.onboarding]);
});
