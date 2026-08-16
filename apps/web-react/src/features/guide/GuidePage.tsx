import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Dropdown } from '../../components/Dropdown';
import { requestJson, requestText } from '../../services/api-client';
import { SAFE_COMMAND_MATCHERS } from './safe-command-matchers';

interface GuideChapter {
  slug: string;
  title: string;
  file: string;
}

type Platform = 'windows' | 'linux' | 'macos';

function InlineText({ text }: { text: string }) {
  const nodes: ReactNode[] = [];
  const pattern = /(`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let offset = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > offset) nodes.push(text.slice(offset, index));
    const token = match[0];
    if (token.startsWith('`')) {
      nodes.push(<code key={`${index}-code`}>{token.slice(1, -1)}</code>);
    } else {
      const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (link) {
        const href = link[2];
        const safeHref = /^(https?:\/\/|\/|#)/.test(href);
        nodes.push(
          safeHref ? (
            <a
              key={`${index}-link`}
              href={href}
              target={href.startsWith('http') ? '_blank' : undefined}
              rel={href.startsWith('http') ? 'noreferrer' : undefined}
            >
              {link[1]}
            </a>
          ) : (
            link[1]
          ),
        );
      }
    }
    offset = index + token.length;
  }
  if (offset < text.length) nodes.push(text.slice(offset));
  return <>{nodes.length ? nodes : text}</>;
}

function Markdown({ source }: { source: string }) {
  const lines = source.split(/\r?\n/);
  const blocks: ReactNode[] = [];
  let index = 0;
  let key = 0;

  while (index < lines.length) {
    const line = lines[index] ?? '';
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = line.match(/^```([^\s]*)\s*$/);
    if (fence) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index] ?? '')) {
        code.push(lines[index] ?? '');
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push(
        <pre key={`block-${key++}`} data-language={fence[1] || undefined}>
          <code>{code.join('\n')}</code>
        </pre>,
      );
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      const text = heading[2];
      const level = Math.min(5, heading[1].length + 2);
      if (level === 3)
        blocks.push(
          <h3 key={`block-${key++}`}>
            <InlineText text={text} />
          </h3>,
        );
      else if (level === 4)
        blocks.push(
          <h4 key={`block-${key++}`}>
            <InlineText text={text} />
          </h4>,
        );
      else
        blocks.push(
          <h5 key={`block-${key++}`}>
            <InlineText text={text} />
          </h5>,
        );
      index += 1;
      continue;
    }

    if (/^\s*-\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*-\s+/.test(lines[index] ?? '')) {
        items.push((lines[index] ?? '').replace(/^\s*-\s+/, ''));
        index += 1;
      }
      blocks.push(
        <ul key={`block-${key++}`} aria-label="Manual list">
          {items.map((item, itemIndex) => (
            <li key={`${itemIndex}-${item}`}>
              <InlineText text={item} />
            </li>
          ))}
        </ul>,
      );
      continue;
    }

    const paragraph: string[] = [line.trim()];
    index += 1;
    while (
      index < lines.length &&
      (lines[index] ?? '').trim() &&
      !/^(#{1,4})\s+/.test(lines[index] ?? '') &&
      !/^```/.test(lines[index] ?? '') &&
      !/^\s*-\s+/.test(lines[index] ?? '')
    ) {
      paragraph.push((lines[index] ?? '').trim());
      index += 1;
    }
    blocks.push(
      <p key={`block-${key++}`}>
        <InlineText text={paragraph.join(' ')} />
      </p>,
    );
  }

  return <div className="manual-markdown">{blocks}</div>;
}

function withoutTopHeading(source: string) {
  return source.replace(/^#\s+[^\r\n]+\r?\n?/, '').trimStart();
}

export function GuidePage() {
  const [chapters, setChapters] = useState<GuideChapter[]>([]);
  const [selected, setSelected] = useState('');
  const [source, setSource] = useState('');
  const [platform, setPlatform] = useState<Platform>('windows');
  const [chapterQuery, setChapterQuery] = useState('');
  const [error, setError] = useState<Error | null>(null);

  const loadChapter = useCallback(async (chapter: GuideChapter) => {
    try {
      const next = await requestText(`/manual/${chapter.file}`);
      setSelected(chapter.slug);
      setSource(next);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error(String(cause)));
    }
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
  const selectedChapter = chapters.find((chapter) => chapter.slug === selected) ?? chapters[0];
  const selectedIndex = selectedChapter
    ? chapters.findIndex((chapter) => chapter.slug === selectedChapter.slug)
    : -1;
  const previous = selectedIndex > 0 ? chapters[selectedIndex - 1] : undefined;
  const next = selectedIndex >= 0 ? chapters[selectedIndex + 1] : undefined;
  const filteredChapters = useMemo(() => {
    const query = chapterQuery.trim().toLowerCase();
    return query
      ? chapters.filter((chapter) => chapter.title.toLowerCase().includes(query))
      : chapters;
  }, [chapterQuery, chapters]);

  if (error) return <div className="react-page-state">{error.message}</div>;

  return (
    <>
      <section className="page-head guide-page-head">
        <div>
          <h2>Guide</h2>
          <p>Aevra user manual, setup reference, and safe-operation guidance.</p>
        </div>
      </section>
      <div className="guide-mobile-picker">
        <span>Chapter</span>
        <Dropdown
          ariaLabel="Chapter"
          value={selectedChapter?.slug ?? ''}
          onChange={(slug) => {
            const chapter = chapters.find((item) => item.slug === slug);
            if (chapter) void loadChapter(chapter);
          }}
          options={chapters.map((chapter) => ({ value: chapter.slug, label: chapter.title }))}
        />
      </div>
      <section className="guide-layout">
        <aside className="guide-sidebar">
          <nav className="guide-chapters" aria-label="Manual chapters">
            <label className="guide-search">
              <span>Chapters</span>
              <input
                type="search"
                aria-label="Search chapters"
                placeholder="Search manual…"
                value={chapterQuery}
                onChange={(event) => setChapterQuery(event.currentTarget.value)}
              />
            </label>
            <div className="guide-chapter-scroll">
              {filteredChapters.map((chapter) => (
                <button
                  type="button"
                  key={chapter.slug}
                  className={chapter.slug === selectedChapter?.slug ? 'active' : ''}
                  data-surface-id="guide:select-chapter"
                  onClick={() => void loadChapter(chapter)}
                >
                  {chapter.title}
                </button>
              ))}
              {!filteredChapters.length ? (
                <p className="guide-empty">No matching chapters.</p>
              ) : null}
            </div>
          </nav>
        </aside>
        <article className="manual-content">
          <div className="manual-scroll">
            <header className="manual-article-head">
              <span>User manual</span>
              <h2>{selectedChapter?.title ?? 'Loading…'}</h2>
            </header>
            <Markdown source={withoutTopHeading(source)} />
            {selected === 'safe-command-matchers' ? (
              <section className="safe-matcher-guide">
                <div className="safe-platform-tabs" role="tablist" aria-label="Platform">
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
            <footer className="guide-pagination" aria-label="Manual chapter navigation">
              <button
                type="button"
                disabled={!previous}
                onClick={() => previous && void loadChapter(previous)}
              >
                {previous ? `Previous: ${previous.title}` : 'Previous'}
              </button>
              <button type="button" disabled={!next} onClick={() => next && void loadChapter(next)}>
                {next ? `Next: ${next.title}` : 'Next'}
              </button>
            </footer>
          </div>
        </article>
      </section>
    </>
  );
}
