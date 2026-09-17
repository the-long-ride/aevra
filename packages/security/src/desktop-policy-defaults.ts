import type { DesktopPolicy } from '../../protocol/src/desktop.js';

/**
 * Default desktop input policy: denylist known-sensitive Windows applications
 * and refuse input to any window whose identity cannot be attributed.
 *
 * LIMITATION (do not remove this comment): the threat model names Aevra's own
 * admin UI as the first thing the agent must not be able to drive, since it
 * could approve its own approvals. But that UI is a web page rendered inside
 * a browser process, not a distinct executable. At window granularity its
 * identity IS the browser's process (chrome.exe, msedge.exe, ...), so a
 * process-name denylist cannot single it out without denylisting the entire
 * browser - which is exactly what a desktop agent most needs to drive. This
 * policy does NOT solve that. `deniedTitlePatterns` below is a partial,
 * defense-in-depth-ONLY mitigation, not a fix: window titles are attacker-
 * and page-influenceable (any web page can set `document.title`), so a title
 * match must never be treated as proof of identity - only as one more speed
 * bump alongside approvals and the admin UI's own auth boundary. It is also
 * blind to anything not in the ACTIVE tab: a browser with the admin UI
 * sitting in a background tab shows whatever title its focused tab has, and
 * a Ctrl+Tab reaches the admin UI with no title-based signal here to catch
 * it - see `titleDenied` in window-gate.ts for the full explanation. Anyone
 * extending this later should not mistake either the mechanism or its exact-
 * match narrowing for a real fix.
 */
export function defaultDesktopPolicy(): DesktopPolicy {
  return {
    mode: 'denylist',
    unattributedInput: 'deny',
    applications: [
      // Terminals and shells
      'cmd.exe',
      'powershell.exe',
      'pwsh.exe',
      'WindowsTerminal.exe',
      'conhost.exe',
      // Password managers and secret stores
      '1Password.exe',
      'KeePass.exe',
      'KeePassXC.exe',
      'Bitwarden.exe',
      'Dashlane.exe',
      'LastPass.exe',
      // Elevation and credential dialogs
      'consent.exe',
      'CredentialUIBroker.exe',
      'LogonUI.exe',
    ],
    // Defense in depth ONLY - see the limitation comment above. Aevra's own
    // web UI sets its page title to exactly "Aevra"
    // (apps/web-react/index.html); that is the one signal available at this
    // layer that ties a browser window back to Aevra's own surface, matched
    // exactly (not as a substring) so an editor, browser tab, or file manager
    // that merely mentions "Aevra" in passing is not refused input too.
    deniedTitlePatterns: ['Aevra'],
  };
}
