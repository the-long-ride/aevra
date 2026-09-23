import type { RiskTier } from '../../protocol/src/index.js';
import { ACT_OP, desktopActRisk } from './desktop-act.js';
import { BACKGROUND_ACT_OP, backgroundActRisk } from './desktop-background.js';

export const DESKTOP_TOOL_NAMES = new Set([
  'desktop_status',
  'desktop_connect',
  'desktop_disconnect',
  'desktop_apps',
  'desktop_request_access',
  'desktop_windows',
  'desktop_describe',
  'desktop_capture',
  'desktop_click',
  'desktop_type',
  'desktop_key',
  'desktop_scroll',
  'desktop_invoke',
  'desktop_set_value',
  'desktop_select',
  'desktop_toggle',
  'desktop_release_window',
]);

/**
 * Reads are LOW, `desktop_connect` is MEDIUM, and input is priced by
 * `desktopActRisk` - see there for why input is no longer uniformly LOW.
 */
export function riskFor(name: string): RiskTier {
  if (name === 'desktop_connect') return 'MEDIUM';
  if (name === 'desktop_request_access') return 'LOW';
  if (ACT_OP[name]) return desktopActRisk(name);
  if (BACKGROUND_ACT_OP[name] || name === 'desktop_release_window') return backgroundActRisk(name);
  return 'LOW';
}
