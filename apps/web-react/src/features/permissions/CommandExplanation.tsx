import type { CommandAnalysis, CommandNode, Reason } from '@aevra/admin-contracts';

export function CommandExplanation({ analysis }: { analysis?: CommandAnalysis | null }) {
  if (!analysis) return null;

  const primaryNode = analysis.nodes[0];
  const isOutside = analysis.scope === 'outside';
  const isUnknown = analysis.scope === 'unknown';

  const outsideTargets = analysis.nodes.flatMap((n: CommandNode) =>
    n.targets.filter((t) => t.scope === 'outside'),
  );

  return (
    <div
      className={`command-explanation-card ${isOutside ? 'is-outside' : isUnknown ? 'is-unknown' : 'is-inside'}`}
      style={{
        marginTop: '0.75rem',
        padding: '0.75rem',
        borderRadius: '6px',
        backgroundColor: 'rgba(255, 255, 255, 0.04)',
        border: `1px solid ${isOutside ? '#ef4444' : isUnknown ? '#f59e0b' : '#10b981'}`,
        fontSize: '0.85rem',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '0.5rem',
        }}
      >
        <span style={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Command Understanding
        </span>
        <span
          style={{
            padding: '2px 8px',
            borderRadius: '4px',
            fontSize: '0.75rem',
            fontWeight: 700,
            backgroundColor: isOutside ? '#ef4444' : isUnknown ? '#f59e0b' : '#10b981',
            color: '#000',
          }}
        >
          {analysis.scope}
        </span>
      </div>

      {primaryNode ? (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'auto 1fr',
            gap: '0.25rem 0.75rem',
            marginBottom: '0.5rem',
          }}
        >
          <span style={{ opacity: 0.7 }}>Application:</span>
          <span>
            <code>{primaryNode.application}</code>
            {primaryNode.wrappers.length > 0
              ? ` (wrapped by ${primaryNode.wrappers.map((w: CommandNode['wrappers'][number]) => w.app).join(', ')})`
              : ''}
          </span>

          <span style={{ opacity: 0.7 }}>Operation:</span>
          <span>
            <code>{primaryNode.operation.join(' ')}</code>
            {primaryNode.scriptName ? ` [script: ${primaryNode.scriptName}]` : ''}
          </span>

          {primaryNode.modifiers.length > 0 ? (
            <>
              <span style={{ opacity: 0.7 }}>Modifiers:</span>
              <span style={{ color: '#f59e0b' }}>{primaryNode.modifiers.join(', ')}</span>
            </>
          ) : null}

          {primaryNode.cwdCandidates.length > 0 ? (
            <>
              <span style={{ opacity: 0.7 }}>Effective CWD:</span>
              <span>
                <code>{primaryNode.cwdCandidates.join(', ')}</code>
              </span>
            </>
          ) : null}
        </div>
      ) : null}

      {outsideTargets.length > 0 ? (
        <div
          style={{
            marginTop: '0.5rem',
            padding: '0.5rem',
            borderRadius: '4px',
            backgroundColor: 'rgba(239, 68, 68, 0.1)',
            color: '#f87171',
          }}
        >
          <strong>Outside Workspace Targets:</strong>
          <ul style={{ margin: '0.25rem 0 0 1.25rem', padding: 0 }}>
            {outsideTargets.map((t: CommandNode['targets'][number], idx: number) => (
              <li key={idx}>
                <code>{t.path}</code> ({t.access})
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {analysis.reasons.length > 0 ? (
        <div style={{ marginTop: '0.5rem', opacity: 0.85 }}>
          <strong>Reasons:</strong>
          <ul style={{ margin: '0.25rem 0 0 1.25rem', padding: 0 }}>
            {analysis.reasons.map((r: Reason, idx: number) => (
              <li key={idx}>
                <code>{r.code}</code>: {r.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
