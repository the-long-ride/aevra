import type { SystemCapabilitySnapshot } from '@aevra/admin-contracts';

type SystemToolCategory = SystemCapabilitySnapshot['toolchains'][number]['category'];

const CATEGORY_LABELS: Record<SystemToolCategory, string> = {
  'source-control': 'Source control',
  javascript: 'JavaScript / TypeScript',
  python: 'Python',
  dotnet: '.NET',
  rust: 'Rust',
  go: 'Go',
  jvm: 'JVM',
  ruby: 'Ruby',
  php: 'PHP',
  native: 'Native build tools',
  containers: 'Containers',
};

function shellSummary(system: SystemCapabilitySnapshot) {
  const id = system.os.recommendedShell;
  if (!id) return 'Not detected';
  const shell = system.os.availableShells.find((entry) => entry.id === id);
  return shell ? `${shell.label} (${shell.id})` : id;
}

export function SystemCapabilities({ system }: { system?: SystemCapabilitySnapshot }) {
  if (!system) {
    return (
      <div className="system-capabilities" aria-label="System capabilities">
        <p className="section-note">System capability detection is unavailable.</p>
      </div>
    );
  }

  const groups = Object.entries(CATEGORY_LABELS)
    .map(([category, label]) => ({
      category,
      label,
      tools: system.toolchains.filter((tool) => tool.category === category),
    }))
    .filter((group) => group.tools.length > 0);

  return (
    <div className="system-capabilities" aria-label="System capabilities">
      <div className="system-capabilities-summary">
        <div>
          <span>Operating system</span>
          <strong>
            {system.os.platformDetail ?? system.os.platform} · {system.os.arch}
          </strong>
        </div>
        <div>
          <span>Recommended shell</span>
          <strong>{shellSummary(system)}</strong>
        </div>
      </div>

      <div className="system-capability-groups">
        {groups.map((group) => (
          <section className="system-capability-group" key={group.category}>
            <h3>{group.label}</h3>
            <div className="system-capability-list">
              {group.tools.map((tool) => (
                <div
                  className={`system-capability-row${tool.available ? '' : ' unavailable'}`}
                  key={tool.id}
                >
                  <span className="system-capability-state" aria-hidden="true">
                    {tool.available ? '✓' : '—'}
                  </span>
                  <strong>{tool.label}</strong>
                  <span>
                    {tool.available ? (tool.version ?? 'Version unavailable') : 'Not detected'}
                  </span>
                </div>
              ))}
            </div>
          </section>
        ))}

        <section className="system-capability-group system-capability-shells">
          <h3>Shells</h3>
          {system.os.availableShells.length ? (
            <div className="system-capability-list">
              {system.os.availableShells.map((shell) => (
                <div className="system-capability-row" key={shell.id}>
                  <span className="system-capability-state" aria-hidden="true">
                    ✓
                  </span>
                  <strong>{shell.label}</strong>
                  <span>{shell.version ?? shell.id}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="section-note">Not detected</p>
          )}
        </section>
      </div>
    </div>
  );
}
