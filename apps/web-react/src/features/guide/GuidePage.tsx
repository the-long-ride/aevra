import { useCallback, useEffect, useMemo, useState } from 'react';
import { requestJson, requestText } from '../../services/api-client';
import { SAFE_COMMAND_MATCHERS } from './safe-command-matchers';

interface GuideChapter {
  slug: string;
  title: string;
  file: string;
}

type Platform = 'windows' | 'linux' | 'macos';

function Markdown({ source }: { source: string }) {
  const lines = source.split(/\r?\n/);
  return (
    <div>
      {lines.map((line, index) => {
        const heading = line.match(/^(#{1,3})\s+(.+)$/);
        if (heading) {
          const text = heading[2];
          if (heading[1].length === 1) return <h2 key={index}>{text}</h2>;
          if (heading[1].length === 2) return <h3 key={index}>{text}</h3>;
          return <h4 key={index}>{text}</h4>;
        }
        if (line.startsWith('- ')) return <li key={index}>{line.slice(2)}</li>;
        if (!line.trim()) return <br key={index} />;
        return <p key={index}>{line}</p>;
      })}
    </div>
  );
}

export function GuidePage() {
  const [chapters, setChapters] = useState<GuideChapter[]>([]);
  const [selected, setSelected] = useState('');
  const [source, setSource] = useState('');
  const [platform, setPlatform] = useState<Platform>('windows');
  const [error, setError] = useState<Error | null>(null);

  const loadChapter = useCallback(async (chapter: GuideChapter) => {
    setSelected(chapter.slug);
    setSource(await requestText(`/manual/${chapter.file}`));
  }, []);

  useEffect(() => {
    void requestJson<GuideChapter[]>('/api/guide')
      .then(async (items) => {
        setChapters(items);
        if (items[0]) await loadChapter(items[0]);
      })
      .catch((cause) => setError(cause instanceof Error ? cause : new Error(String(cause))));
  }, [loadChapter]);

  const matchers = useMemo(
    () => SAFE_COMMAND_MATCHERS.filter((item) => item.platforms.includes(platform)),
    [platform],
  );

  if (error) return <div className="react-page-state">{error.message}</div>;

  return (
    <>
      <section className="page-head">
        <div>
          <h2>Guide</h2>
          <p>Local Aevra manual.</p>
        </div>
      </section>
      <section className="guide-layout">
        <aside>
          {chapters.map((chapter) => (
            <button
              type="button"
              key={chapter.slug}
              className={chapter.slug === selected ? 'active' : ''}
              data-surface-id="guide:select-chapter"
              onClick={() => void loadChapter(chapter)}
            >
              {chapter.title}
            </button>
          ))}
        </aside>
        <article className="manual-content">
          <Markdown source={source} />
          {selected === 'safe-command-matchers' ? (
            <section className="safe-matcher-guide">
              <div className="safe-platform-tabs" role="tablist">
                {(['windows', 'linux', 'macos'] as const).map((value) => (
                  <button
                    type="button"
                    key={value}
                    className={platform === value ? 'active' : ''}
                    onClick={() => setPlatform(value)}
                  >
                    {value === 'macos' ? 'macOS' : value[0].toUpperCase() + value.slice(1)}
                  </button>
                ))}
                <button
                  type="button"
                  className="safe-copy-all"
                  data-surface-id="guide:copy-all-matchers"
                  onClick={() =>
                    void navigator.clipboard.writeText(
                      matchers.map((item) => item.matcher).join('\n'),
                    )
                  }
                >
                  Copy all
                </button>
              </div>
              <div className="table-scroll">
                <table className="simple-table">
                  <thead>
                    <tr>
                      <th>Matcher</th>
                      <th>Example</th>
                      <th>Purpose</th>
                      <th>Risk note</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {matchers.map((item) => (
                      <tr key={item.matcher}>
                        <td>
                          <code>{item.matcher}</code>
                        </td>
                        <td>
                          <code>{item.example}</code>
                        </td>
                        <td>{item.purpose}</td>
                        <td>{item.riskNote}</td>
                        <td>
                          <button
                            type="button"
                            data-surface-id="guide:copy-matcher"
                            onClick={() => void navigator.clipboard.writeText(item.matcher)}
                          >
                            Copy
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}
        </article>
      </section>
    </>
  );
}
