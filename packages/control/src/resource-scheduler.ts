export class ResourceScheduler {
  private tails = new Map<string, Promise<void>>();

  async run<T>(keys: string[], operation: () => Promise<T>): Promise<T> {
    const resources = [...new Set(keys)].sort();
    const predecessors = resources.map((key) => this.tails.get(key) ?? Promise.resolve());
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    for (const key of resources) this.tails.set(key, current);

    await Promise.all(predecessors);
    try {
      return await operation();
    } finally {
      release();
      for (const key of resources) {
        if (this.tails.get(key) === current) this.tails.delete(key);
      }
    }
  }
}
