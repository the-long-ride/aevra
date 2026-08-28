import type { McpActivityEntry } from '@aevra/admin-contracts';
import {
  createContext,
  createElement,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

const MAX_ENTRIES = 150;
const STALE_RUNNING_MS = 48 * 60 * 60_000;
type StreamState = 'connecting' | 'live' | 'reconnecting' | 'unsupported';
interface McpActivityValue {
  entries: McpActivityEntry[];
  streamState: StreamState;
}
const McpActivityContext = createContext<McpActivityValue | null>(null);

function validEntry(value: unknown): value is McpActivityEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<McpActivityEntry>;
  return Boolean(
    entry.id &&
    entry.actor &&
    entry.sessionId &&
    entry.action &&
    entry.updatedAt &&
    ['tool', 'rpc', 'session'].includes(String(entry.kind)) &&
    ['running', 'success', 'error'].includes(String(entry.state)),
  );
}

function reconcile(entries: Record<string, McpActivityEntry>, now = Date.now(), expire = true) {
  const ordered = Object.values(entries)
    .map((entry) =>
      expire && entry.state === 'running' && now - Date.parse(entry.updatedAt) > STALE_RUNNING_MS
        ? { ...entry, state: 'error' as const, updatedAt: new Date(now).toISOString() }
        : entry,
    )
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
    .slice(0, MAX_ENTRIES);
  return Object.fromEntries(ordered.map((entry) => [entry.id, entry])) as Record<
    string,
    McpActivityEntry
  >;
}

export function McpActivityProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<Record<string, McpActivityEntry>>({});
  const [streamState, setStreamState] = useState<StreamState>('connecting');
  useEffect(() => {
    if (typeof EventSource === 'undefined') {
      setStreamState('unsupported');
      return undefined;
    }
    const source = new EventSource('/api/activity/stream');
    source.onopen = () => setStreamState('live');
    source.onerror = () => setStreamState('reconnecting');
    const onActivity = (event: MessageEvent<string>) => {
      try {
        const entry: unknown = JSON.parse(event.data);
        if (validEntry(entry))
          setEntries((current) => reconcile({ ...current, [entry.id]: entry }, Date.now(), false));
      } catch {
        /* Ignore malformed activity payloads. */
      }
    };
    source.addEventListener('activity', onActivity as EventListener);
    const timer = setInterval(() => setEntries((current) => reconcile(current)), 60_000);
    return () => {
      clearInterval(timer);
      source.close();
    };
  }, []);
  const value = useMemo(
    () => ({ entries: Object.values(entries), streamState }),
    [entries, streamState],
  );
  return createElement(McpActivityContext.Provider, { value }, children);
}

export function useMcpActivity() {
  return useContext(McpActivityContext) ?? { entries: [], streamState: 'unsupported' };
}
export function useHasMcpActivityProvider() {
  return useContext(McpActivityContext) !== null;
}
export function useMcpActivityEntries() {
  return useMcpActivity().entries;
}
export type { McpActivityEntry, StreamState };
