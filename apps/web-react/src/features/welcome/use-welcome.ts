import { useCallback, useEffect, useState } from 'react';
import { requestRemoteAccessHighlight } from '../settings/remote-access-highlight';
import { loadWelcomeSeen, markWelcomeSeen } from './welcome-service';

// Once closed, the welcome never returns in this page session, even when saving
// the seen flag failed.
let closedThisSession = false;

export function resetWelcomeSessionForTests(): void {
  closedThisSession = false;
}

export function useWelcome() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (closedThisSession) return undefined;
    let active = true;
    loadWelcomeSeen().then(
      (seen) => {
        if (active && !seen && !closedThisSession) setOpen(true);
      },
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, []);

  const close = useCallback(() => {
    closedThisSession = true;
    setOpen(false);
    markWelcomeSeen().catch(() => undefined);
    requestRemoteAccessHighlight();
  }, []);

  return { open, close };
}
