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
    >
      <div className="command-explanation-head">
        <span className="command-explanation-title">Command Understanding</span>
        <span className="command-explanation-badge">{analysis.scope}</span>
      </div>

      {primaryNode ? (
        <div className="command-explanation-grid">
          <span className="command-explanation-label">Application:</span>
          <span className="command-explanation-value">
            <code>{primaryNode.application}</code>
            {primaryNode.wrappers.length > 0
              ? ` (wrapped by ${primaryNode.wrappers.map((w: CommandNode['wrappers'][number]) => w.app).join(', ')})`
              : ''}
          </span>

          <span className="command-explanation-label">Operation:</span>
          <span className="command-explanation-value">
            <code>{primaryNode.operation.join(' ')}</code>
            {primaryNode.scriptName ? ` [script: ${primaryNode.scriptName}]` : ''}
          </span>

          {primaryNode.modifiers.length > 0 ? (
            <>
              <span className="command-explanation-label">Modifiers:</span>
              <span className="command-explanation-value" style={{ color: 'var(--warning)' }}>
                {primaryNode.modifiers.join(', ')}
              </span>
            </>
          ) : null}

          {primaryNode.cwdCandidates.length > 0 ? (
            <>
              <span className="command-explanation-label">Effective CWD:</span>
              <span className="command-explanation-value">
                <code>{primaryNode.cwdCandidates.join(', ')}</code>
              </span>
            </>
          ) : null}
        </div>
      ) : null}

      {outsideTargets.length > 0 ? (
        <div className="command-explanation-outside">
          <strong>Outside Workspace Targets:</strong>
          <ul>
            {outsideTargets.map((t: CommandNode['targets'][number], idx: number) => (
              <li key={idx}>
                <code>{t.path}</code> ({t.access})
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {analysis.reasons.length > 0 ? (
        <div className="command-explanation-reasons">
          <strong>Reasons:</strong>
          <ul>
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
