import type { McpUpstreamToolDocumentation } from '@aevra/admin-contracts';
import { inputExample, inputParameters } from './tool-input-documentation';

export function McpUpstreamToolDetails({ tool }: { tool: McpUpstreamToolDocumentation }) {
  const parameters = inputParameters(tool.inputSchema);
  const example = inputExample(tool.inputSchema);
  const hints = tool.annotations;
  return (
    <details className="mcp-upstream-tool">
      <summary>
        <strong>{tool.name}</strong>
      </summary>
      <div className="mcp-upstream-tool-body">
        <h3>Instructions</h3>
        <p className="mcp-upstream-tool-instructions">
          {tool.description || 'No instructions supplied by this server.'}
        </p>
        <div className="mcp-upstream-tool-claims">
          <span>{hints?.readOnlyHint ? 'claims read-only' : 'no read-only claim'}</span>
          <span>
            {hints?.destructiveHint === undefined
              ? 'no destructive claim'
              : hints.destructiveHint
                ? 'claims destructive'
                : 'claims non-destructive'}
          </span>
        </div>
        <h3>Parameters</h3>
        {parameters.length ? (
          <div className="mcp-upstream-tool-table-scroll">
            <table aria-label={`Parameters for ${tool.name}`}>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Type</th>
                  <th scope="col">Required</th>
                  <th scope="col">Description</th>
                </tr>
              </thead>
              <tbody>
                {parameters.map((parameter) => (
                  <tr key={parameter.name}>
                    <th scope="row">{parameter.name}</th>
                    <td>{parameter.type}</td>
                    <td>{parameter.required ? 'Required' : 'Optional'}</td>
                    <td>{parameter.description || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="section-note">
            No named parameters supplied. Check the input schema for constraints.
          </p>
        )}
        <h3>Example arguments</h3>
        {example ? (
          <>
            <p className="section-note">{example.label}</p>
            <pre aria-label={`Example arguments for ${tool.name}`}>
              {JSON.stringify(example.value, null, 2)}
            </pre>
          </>
        ) : (
          <p className="section-note">
            {tool.inputSchema === undefined
              ? 'No input schema or example supplied.'
              : 'No example supplied; inspect the input schema.'}
          </p>
        )}
        {tool.inputSchema !== undefined ? (
          <details className="mcp-upstream-tool-schema">
            <summary>Input schema</summary>
            <pre>{JSON.stringify(tool.inputSchema, null, 2)}</pre>
          </details>
        ) : null}
      </div>
    </details>
  );
}
