import { LLM_TXT_BLOB_URL, LLM_TXT_URL, REPOSITORY_URL } from '@aevra/admin-contracts';
import { useState } from 'react';

interface GuideAiPromptProps {
  version?: string;
}

export function buildAiGuidePrompt(version?: string): string {
  const normalizedVersion = version
    ? version.startsWith('v')
      ? version
      : `v${version}`
    : 'v1.1.1';
  return [
    `I am using Aevra ${normalizedVersion}.`,
    '',
    'Use the exact-version support guide first:',
    `${REPOSITORY_URL}/blob/${normalizedVersion}/llm.txt`,
    '',
    'If that exact-version guide is unavailable, check the exact release page:',
    `${REPOSITORY_URL}/releases/tag/${normalizedVersion}`,
    '',
    'Then use the latest/main guide only as fallback context:',
    `${REPOSITORY_URL}/blob/main/llm.txt`,
    '',
    'Compare fallback information against the changelog:',
    `${REPOSITORY_URL}/blob/main/CHANGELOG.md`,
    '',
    'Version-safety rules:',
    `- My installed version (${normalizedVersion}) is authoritative.`,
    '- Do not assume features from latest/main exist in my installed version.',
    `- If documentation versions conflict, prefer exact ${normalizedVersion} release/tag information.`,
    `- Clearly identify anything that is not verified for ${normalizedVersion}.`,
    '',
    'Give me step-by-step instructions based on features verified for my version.',
    'If troubleshooting, tell me what sanitized Settings/Logs details to share.',
    'Do not ask me for passwords, tokens, cookies, backup secrets, or other credentials.',
    '',
    'Once you have read and understood the documentation, reply to confirm that you are ready for my questions.',
  ].join('\n');
}

export function GuideAiPrompt({ version }: GuideAiPromptProps) {
  const [copied, setCopied] = useState(false);
  const promptText = buildAiGuidePrompt(version);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(promptText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Ignore clipboard write failure
    }
  };

  return (
    <section className="guide-ai-section" data-surface-id="guide:ai-prompt-section">
      <div className="guide-ai-header">
        <div className="guide-ai-title-wrap">
          <span className="guide-ai-badge">AI Assistant Prompt</span>
          <h3>Chat with AI to learn Aevra</h3>
          <p>
            You can use this prompt with our{' '}
            <a
              href={LLM_TXT_URL}
              target="_blank"
              rel="noreferrer"
              data-surface-id="guide:llm-txt-link"
            >
              llm.txt
            </a>{' '}
            (also available on{' '}
            <a href={LLM_TXT_BLOB_URL} target="_blank" rel="noreferrer">
              GitHub
            </a>
            ) to chat with an AI assistant (ChatGPT, Claude, Gemini, Cursor) to learn how to use
            Aevra.
          </p>
        </div>
        <button
          type="button"
          className="primary guide-ai-copy-button"
          data-surface-id="guide:copy-ai-prompt"
          onClick={handleCopy}
        >
          {copied ? 'Copied prompt!' : 'Copy prompt'}
        </button>
      </div>
      <div className="guide-ai-prompt-display">
        <pre>
          <code>{promptText}</code>
        </pre>
      </div>
    </section>
  );
}
