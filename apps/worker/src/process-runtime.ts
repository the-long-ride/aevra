import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ManagedProcessRuntime } from '../../../packages/executor/src/processes.js';

const processHostEntry = fileURLToPath(new URL('./process-host.js', import.meta.url));
const logDir = process.env.AEVRA_PROCESS_LOG_DIR ?? path.join(process.cwd(), '.aevra-process-logs');
export const processRuntime = new ManagedProcessRuntime({ processHostEntry, logDir });
