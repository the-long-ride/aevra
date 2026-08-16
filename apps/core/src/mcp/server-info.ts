import { AEVRA_VERSION } from '../version.js';

export function aevraServerInfo() {
  return {
    name: 'Aevra',
    version: AEVRA_VERSION,
    description:
      'Use Claude, ChatGPT, Grok, etc. chat to control your workspace. Risks are under control by permissions and your approvals.',
  };
}
