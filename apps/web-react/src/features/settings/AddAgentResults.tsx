import type { WorkspaceSummary } from '@aevra/admin-contracts';
import type { Ref } from 'react';
import { pairLabel, type PairResult, type RunOutput } from './agent-install-run';

const ACTION = { create: 'Create', update: 'Update', remove: 'Remove' } as const;

export function OutcomeList({
  results,
  workspaces,
}: {
  results: PairResult[];
  workspaces: WorkspaceSummary[];
}) {
  const failed = results.filter((item) => !item.ok);
  return (
    <>
      <div role="status" aria-label="Install results">
        <ul className="agent-modal-results">
          {results.map((item) => {
            const label = pairLabel(item.target, workspaces, item.workspaceId);
            return (
              <li key={`${item.target}|${item.workspaceId ?? ''}`}>
                {item.ok
                  ? `${label}: Installed`
                  : `${label}: Failed: ${item.error ?? 'Unknown error'}`}
              </li>
            );
          })}
        </ul>
      </div>
      {failed.length > 0 && (
        <p role="alert">
          {failed.length} of {results.length} failed. The others stay installed; fix the problem and
          retry the failed agents.
        </p>
      )}
    </>
  );
}

export function PreviewPanel({
  preview,
  workspaces,
  headingRef,
}: {
  preview: RunOutput;
  workspaces: WorkspaceSummary[];
  headingRef: Ref<HTMLHeadingElement>;
}) {
  const failed = preview.results.filter((item) => !item.ok);
  return (
    <section aria-labelledby="agent-preview-title" aria-live="polite">
      <h3 id="agent-preview-title" ref={headingRef} tabIndex={-1}>
        Preview
      </h3>
      {preview.changes.length ? (
        <div className="agent-preview-scroll">
          <table className="simple-table agent-preview-table" aria-label="Planned changes">
            <thead>
              <tr>
                <th scope="col">AI agent</th>
                <th scope="col">Path</th>
              </tr>
            </thead>
            <tbody>
              {preview.changes.map((change) => (
                <tr
                  key={`${change.workspaceId ?? ''}|${change.target}|${change.file}|${change.action}`}
                >
                  <td>
                    <div>{pairLabel(change.target, workspaces, change.workspaceId)}</div>
                    <div className="agent-modal-hint">{ACTION[change.action]}</div>
                  </td>
                  <td className="agent-preview-path">{change.file}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p>No files would change.</p>
      )}
      {preview.notes.length > 0 && (
        <ul aria-label="Notes">
          {preview.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
      {failed.length > 0 && (
        <ul aria-label="Problems">
          {failed.map((item) => (
            <li key={`${item.target}|${item.workspaceId ?? ''}`}>
              {`${pairLabel(item.target, workspaces, item.workspaceId)}: ${item.error ?? 'Unknown error'}`}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
