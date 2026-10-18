import { useEffect, useRef, useState } from 'react';

const REMOTE_ACCESS_HIGHLIGHT_MS = 5000;
const REQUEST_EVENT = 'aevra:remote-access-highlight';
// A request is honoured only while fresh, so a later visit to Settings stays calm.
const REQUEST_TTL_MS = 15_000;
let requestedAt = 0;

export function requestRemoteAccessHighlight(): void {
  requestedAt = Date.now();
  window.dispatchEvent(new Event(REQUEST_EVENT));
}

export function useRemoteAccessHighlight(ready: boolean) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState(false);
  const [request, setRequest] = useState(0);

  useEffect(() => {
    const onRequest = () => setRequest((value) => value + 1);
    window.addEventListener(REQUEST_EVENT, onRequest);
    return () => window.removeEventListener(REQUEST_EVENT, onRequest);
  }, []);

  useEffect(() => {
    if (!ready || !requestedAt || Date.now() - requestedAt > REQUEST_TTL_MS) return undefined;
    setActive(true);
    ref.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    const timer = window.setTimeout(() => {
      requestedAt = 0;
      setActive(false);
    }, REMOTE_ACCESS_HIGHLIGHT_MS);
    return () => window.clearTimeout(timer);
  }, [ready, request]);

  return { ref, active };
}
