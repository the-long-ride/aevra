import type { McpDiagnosticSnapshot } from '@aevra/admin-contracts';

export function McpDiagnosticsNotice({ snapshot }: { snapshot?: McpDiagnosticSnapshot | null }) {
  if (!snapshot) return null;
  if (snapshot.hint === 'no-client-traffic') {
    return (
      <p className="execution-warning" role="status">
        Aevra is listening, but no MCP request has reached the server. If a client already attempted
        a tool, a client or tool-host restriction is a likely external cause; Aevra authentication
        and workspace permissions have not rejected a request.
      </p>
    );
  }
  if (snapshot.hint === 'traffic-no-initialize') {
    return (
      <p className="execution-warning" role="status">
        MCP traffic is reaching Aevra, but no session initialized successfully. Check client
        authentication and protocol negotiation.
      </p>
    );
  }
  if (snapshot.hint === 'initialized-no-tools') {
    return (
      <p className="section-note" role="status">
        MCP initialized successfully. No tool call has reached Aevra yet.
      </p>
    );
  }
  return null;
}
