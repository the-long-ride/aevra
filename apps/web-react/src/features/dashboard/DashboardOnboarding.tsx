import { completeOnboarding, registerWorkspace, type DashboardData } from './dashboard-service';
import { RemoteAccessPanel } from './RemoteAccessPanel';

export function Onboarding({ data, refresh }: { data: DashboardData; refresh(): Promise<void> }) {
  const endpoint = data.exposure.publicUrl
    ? `${data.exposure.publicUrl}/mcp`
    : 'Configure Remote Access first';
  return (
    <div className="onboarding-body">
      <section className="onboarding-block wide" data-onboarding-section="remote-access">
        <div className="section-heading">
          <span>Remote Access</span>
          <strong>{data.exposure.publicUrl ? 'Configured' : 'Setup needed'}</strong>
        </div>
        <RemoteAccessPanel status={data.exposure} onChanged={refresh} />
      </section>
      <section className="onboarding-block wide" data-onboarding-section="connect-ai">
        <div className="section-heading">
          <span>Connect an AI</span>
          <strong>Example guide</strong>
        </div>
        <p className="section-note">Examples only; provider screens can change.</p>
        <div className="endpoint">
          <span>MCP endpoint</span>
          <code>{endpoint}</code>
        </div>
      </section>
      <section className="onboarding-block" data-onboarding-section="workspace">
        <div className="section-heading">
          <span>Workspace</span>
          <strong>
            {data.workspaces.length ? `${data.workspaces.length} registered` : 'Register one'}
          </strong>
        </div>
        {data.workspaces.length ? (
          <p>Your local workspace is ready. Manage details from Workspaces.</p>
        ) : (
          <form
            className="stack-form"
            onSubmit={(event) => {
              event.preventDefault();
              void registerWorkspace(new FormData(event.currentTarget)).then(refresh);
            }}
          >
            <input name="name" placeholder="Workspace name" required />
            <input name="hostRoot" placeholder="Absolute path to your project" required />
            <button className="primary">Register workspace</button>
          </form>
        )}
      </section>
      <section className="onboarding-block" data-onboarding-section="try-aevra">
        <div className="section-heading">
          <span>Try Aevra</span>
          <strong>Start read-only</strong>
        </div>
        <p>
          Select a workspace from chat, approve access locally, then start with status, skills and
          file reads.
        </p>
      </section>
      <section
        className="onboarding-block wide onboarding-finish"
        data-onboarding-section="finish-onboarding"
      >
        <div>
          <b>
            {data.onboarding.completed
              ? 'Onboarding completed'
              : 'Finish onboarding when setup is ready'}
          </b>
        </div>
        <button
          type="button"
          className="primary"
          disabled={data.onboarding.completed}
          onClick={() => void completeOnboarding().then(refresh)}
        >
          {data.onboarding.completed ? 'Completed' : 'Finish onboarding'}
        </button>
      </section>
    </div>
  );
}
