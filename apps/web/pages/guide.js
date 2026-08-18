import { requestJson, requestText } from '../core/api.js';
import { escapeHtml } from '../core/dom.js';
import {
  SAFE_COMMAND_MATCHERS,
  selectedPlatformMatchers,
} from '../data/safe-command-matchers.js';
import { toast } from '../components/toast.js';

const PLATFORMS = [
  ['windows', 'Windows'],
  ['linux', 'Linux'],
  ['macos', 'macOS'],
];
let selectedPlatform = 'windows';

function markdownToHtml(source) {
  const lines = String(source ?? '').split(/\r?\n/);
  let html = '';
  let inCode = false;
  let inList = false;
  const closeList = () => {
    if (inList) {
      html += '</ul>';
      inList = false;
    }
  };
  for (const raw of lines) {
    if (raw.startsWith('```')) {
      closeList();
      inCode = !inCode;
      html += inCode ? '<pre><code>' : '</code></pre>';
      continue;
    }
    if (inCode) {
      html += `${escapeHtml(raw)}\n`;
      continue;
    }
    if (!raw.trim()) {
      closeList();
      continue;
    }
    const heading = raw.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      closeList();
      const level = heading[1].length + 1;
      html += `<h${level}>${escapeHtml(heading[2])}</h${level}>`;
      continue;
    }
    const item = raw.match(/^[-*]\s+(.+)$/);
    if (item) {
      if (!inList) {
        html += '<ul>';
        inList = true;
      }
      html += `<li>${escapeHtml(item[1])}</li>`;
      continue;
    }
    closeList();
    html += `<p>${escapeHtml(raw)}</p>`;
  }
  closeList();
  return html;
}

function matcherGuide(source) {
  const entries = SAFE_COMMAND_MATCHERS.filter((item) =>
    item.platforms.includes(selectedPlatform),
  );
  const tabs = PLATFORMS.map(
    ([id, label]) =>
      `<button type="button" data-safe-platform="${id}" class="${id === selectedPlatform ? 'active' : ''}">${label}</button>`,
  ).join('');
  const rows = entries
    .map(
      (item) => `<tr>
        <td><code>${escapeHtml(item.matcher)}</code></td>
        <td><code>${escapeHtml(item.example)}</code></td>
        <td>${escapeHtml(item.purpose)}</td>
        <td>${escapeHtml(item.riskNote)}</td>
        <td><button type="button" data-copy-matcher="${escapeHtml(item.matcher)}">Copy</button></td>
      </tr>`,
    )
    .join('');
  return `${markdownToHtml(source)}
    <section class="safe-matcher-guide">
      <div class="safe-platform-tabs" role="tablist" aria-label="Command matcher platform">
        ${tabs}<button type="button" class="safe-copy-all" data-copy-all-matchers>Copy all</button>
      </div>
      <div class="table-scroll"><table class="simple-table"><thead><tr><th>Matcher</th><th>Example</th><th>Purpose</th><th>Risk note</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="5">No recommendations for this platform.</td></tr>'}</tbody></table></div>
    </section>`;
}

export async function renderGuidePage(container, context) {
  const render = async () => {
    const chapters = await requestJson('/api/guide');
    const slug = context.guideSlug ?? chapters[0]?.slug;
    const chapter = chapters.find((item) => item.slug === slug) ?? chapters[0];
    if (!chapter) throw new Error('Guide is empty');
    context.guideSlug = chapter.slug;
    const source = await requestText(`/manual/${chapter.file}`);
    const content =
      chapter.slug === 'safe-command-matchers'
        ? matcherGuide(source)
        : markdownToHtml(source);
    container.innerHTML = `<section class="page-head"><div><h2>Guide</h2><p>Local Aevra manual.</p></div></section>
      <section class="guide-layout">
        <aside>${chapters
          .map(
            (item) =>
              `<button type="button" data-guide="${escapeHtml(item.slug)}" class="${item.slug === chapter.slug ? 'active' : ''}">${escapeHtml(item.title)}</button>`,
          )
          .join('')}</aside>
        <article class="manual-content">${content}</article>
      </section>`;

    container.addEventListener('click', async (event) => {
      const nextSlug = event.target.closest('[data-guide]')?.dataset.guide;
      if (nextSlug) {
        context.guideSlug = nextSlug;
        await render();
        return;
      }
      const platform = event.target.closest('[data-safe-platform]')?.dataset.safePlatform;
      if (platform) {
        selectedPlatform = platform;
        await render();
        return;
      }
      const matcher = event.target.closest('[data-copy-matcher]')?.dataset.copyMatcher;
      if (matcher) {
        await navigator.clipboard.writeText(matcher);
        toast('Matcher copied', 'success');
        return;
      }
      if (event.target.closest('[data-copy-all-matchers]')) {
        const matchers = selectedPlatformMatchers(
          SAFE_COMMAND_MATCHERS,
          selectedPlatform,
        );
        await navigator.clipboard.writeText(matchers.join('\n'));
        toast(`Copied ${matchers.length} matchers`, 'success');
      }
    }, { once: true });
  };
  await render();
}
