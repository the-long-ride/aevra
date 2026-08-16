import type { CoreConfig } from '../../core/src/config.js';
import type { CoreRuntime } from '../../core/src/runtime.js';

export interface AevraSignalSource {
  once(event: 'SIGINT' | 'SIGTERM', listener: () => void): unknown;
  removeListener(event: 'SIGINT' | 'SIGTERM', listener: () => void): unknown;
}

export interface RunStartDependencies {
  signals: AevraSignalSource;
  createRuntime(config: CoreConfig): Promise<CoreRuntime>;
  onReady?(info: { adminUrl: string; mcpUrl: string }): void | Promise<void>;
}

export async function runStart(
  config: CoreConfig,
  dependencies: RunStartDependencies,
): Promise<number> {
  const runtime = await dependencies.createRuntime(config);
  await runtime.start();
  await dependencies.onReady?.({
    adminUrl: runtime.adminUrl,
    mcpUrl: runtime.mcpUrl,
  });

  return new Promise<number>((resolve) => {
    let closing = false;
    const shutdown = () => {
      if (closing) return;
      closing = true;
      void runtime.close().finally(() => {
        dependencies.signals.removeListener('SIGINT', shutdown);
        dependencies.signals.removeListener('SIGTERM', shutdown);
        resolve(0);
      });
    };

    dependencies.signals.once('SIGINT', shutdown);
    dependencies.signals.once('SIGTERM', shutdown);
  });
}
