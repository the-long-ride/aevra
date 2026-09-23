import {
  AUTHOR,
  AUTHOR_NOTE,
  AUTHOR_PROFILE_URL,
  ISSUES_URL,
  LLM_TXT_URL,
  REPOSITORY_URL,
} from '@aevra/admin-contracts';
import { useRuntimeStatus } from '../../hooks/use-runtime-status';

export function AboutPage() {
  const status = useRuntimeStatus();
  const version = status.version
    ? String(status.version).startsWith('v')
      ? status.version
      : `v${status.version}`
    : 'v1.1.2';

  return (
    <section className="about-page" data-surface-id="page:about">
      <section className="page-head">
        <div>
          <h2>About</h2>
          <p>Workspace-scoped local MCP execution gateway for AI web interfaces.</p>
        </div>
      </section>

      <div className="about-grid">
        <article className="about-card">
          <header className="about-card-head">
            <h3>Aevra</h3>
            <span className="about-version-badge">{version}</span>
          </header>
          <div className="about-card-body">
            <p className="about-description">
              Aevra lets AI assistants work directly on your machine under explicit security
              boundaries with human-in-the-loop approvals, workspace isolation, and full audit
              logging.
            </p>
            <dl className="about-details-list">
              <div className="about-detail-row">
                <dt>Author</dt>
                <dd>
                  <strong>{AUTHOR}</strong>{' '}
                  <span className="about-author-note">({AUTHOR_NOTE})</span>
                </dd>
              </div>
            </dl>
          </div>
        </article>

        <article className="about-card">
          <header className="about-card-head">
            <h3>Links &amp; Resources</h3>
          </header>
          <div className="about-card-body">
            <ul className="about-links-list">
              <li>
                <a
                  href={AUTHOR_PROFILE_URL}
                  target="_blank"
                  rel="noreferrer"
                  data-surface-id="about:profile-link"
                >
                  GitHub Profile ({AUTHOR})
                </a>
              </li>
              <li>
                <a
                  href={REPOSITORY_URL}
                  target="_blank"
                  rel="noreferrer"
                  data-surface-id="about:repo-link"
                >
                  GitHub Repository
                </a>
              </li>
              <li>
                <a
                  href={ISSUES_URL}
                  target="_blank"
                  rel="noreferrer"
                  data-surface-id="about:issues-link"
                >
                  GitHub Issues
                </a>
              </li>
              <li>
                <a
                  href={LLM_TXT_URL}
                  target="_blank"
                  rel="noreferrer"
                  data-surface-id="about:llm-guide-link"
                >
                  LLM Guide &amp; Architecture (llm.txt)
                </a>
              </li>
            </ul>
          </div>
        </article>
      </div>
    </section>
  );
}
