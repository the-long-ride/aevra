export interface ReadSnapshot {
  sessionId: string;
  workspaceId: string;
  path: string;
  hash: string;
  content: string;
  storedAt: number;
}
export class ReadVersionCache {
  private items = new Map<string, ReadSnapshot>();
  constructor(private maxEntries = 256) {}
  private key(s: string, w: string, p: string, h: string) {
    return `${s}\0${w}\0${p}\0${h}`;
  }
  put(item: ReadSnapshot) {
    this.items.set(this.key(item.sessionId, item.workspaceId, item.path, item.hash), item);
    while (this.items.size > this.maxEntries) this.items.delete(this.items.keys().next().value!);
  }
  get(sessionId: string, workspaceId: string, path: string, hash: string) {
    return this.items.get(this.key(sessionId, workspaceId, path, hash)) ?? null;
  }
  clearSession(sessionId: string) {
    for (const [k, v] of this.items) if (v.sessionId === sessionId) this.items.delete(k);
  }
}
