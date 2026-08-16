import {startWorkerServer} from './server.js';
const endpoint=process.env.AEVRA_WORKER_ENDPOINT,secret=process.env.AEVRA_WORKER_SECRET,daemonInstanceId=process.env.AEVRA_DAEMON_INSTANCE_ID;
delete process.env.AEVRA_WORKER_SECRET;
if(!endpoint||!secret||!daemonInstanceId)throw new Error('Missing worker bootstrap environment');
const server=await startWorkerServer({endpoint,secret:Buffer.from(secret,'base64url'),daemonInstanceId});
for(const sig of ['SIGINT','SIGTERM'] as const)process.once(sig,()=>server.close(()=>process.exit(0)));
