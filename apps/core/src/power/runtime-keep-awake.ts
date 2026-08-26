import type { SettingsRepository } from '../../../../packages/store/src/settings.js';
import {
  KeepAwakeService,
  countKeepAwakeManagedProcesses,
  countKeepAwakeRemoteConnections,
} from './keep-awake-service.js';
import { createPlatformSleepInhibitor, type SleepInhibitor } from './platform-sleep-inhibitor.js';

interface ConnectionInventory {
  list(): Array<{ status?: unknown }>;
}

interface ProcessInventory {
  listLocal(): Array<{ state?: unknown; ownership?: unknown }>;
}

export function createRuntimeKeepAwakeService(
  settings: SettingsRepository,
  connections: ConnectionInventory,
  processes: ProcessInventory,
  inhibitor: SleepInhibitor = createPlatformSleepInhibitor(),
): KeepAwakeService {
  return new KeepAwakeService(settings, inhibitor, {
    remoteConnectionCount: () => countKeepAwakeRemoteConnections(connections.list()),
    managedProcessCount: () => countKeepAwakeManagedProcesses(processes.listLocal()),
  });
}

export type { KeepAwakeService };
