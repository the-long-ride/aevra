import { ManagementModal } from '../../components/ManagementModal';
import { TunnelCheck } from './TunnelCheck';

export function WelcomeModal({ onClose }: { onClose(): void }) {
  return (
    <ManagementModal
      open
      title="Hi, welcome to Aevra"
      onClose={onClose}
      className="welcome-modal"
      surfaceId="welcome:dialog"
      closeSurfaceId="welcome:close"
      closeIcon
    >
      <div className="welcome-body">
        <p className="welcome-intro">
          Aevra lets an AI chat app, like ChatGPT or Claude, work on this computer with your
          approval. Nothing happens until you say yes.
        </p>
        <TunnelCheck />
        <section className="welcome-section">
          <h3>New to Aevra?</h3>
          <p>
            Open the <b>Guide</b> tab and press <b>Copy prompt</b>. Paste it into any AI chat
            (ChatGPT, Claude, Gemini) and it will walk you through Aevra step by step.
          </p>
        </section>
        <div className="welcome-actions">
          <p className="welcome-note">{"Next, we'll open Settings so you can set things up."}</p>
          <button
            type="button"
            className="primary"
            data-surface-id="welcome:primary"
            onClick={onClose}
          >
            {"Let's set up remote access"}
          </button>
        </div>
      </div>
    </ManagementModal>
  );
}
