export interface DashboardRuntimeSnapshot{
  generatedAt:string;startedAt:string;uptimeSeconds:number;status:any;metrics:any[];
  pending:{approvals:number;oauth:number;total:number};
  stats:{sessions:number;workspaceLeases:number;processes:number;openChanges:number;toolCalls:number;avgToolLatencyMs:number|null;connectors:number};
  activeConnections:any[];connectors:any[];
}

function authType(actor:string){if(actor.startsWith('oauth:'))return'OAuth';if(actor.startsWith('connector:'))return'Bearer connector';return'Access / remote identity';}

export function buildDashboardRuntimeSnapshot(context:any,status:any,startedAt:string,now=new Date()):DashboardRuntimeSnapshot{
  const metrics=context.metrics?.snapshot?.()??[];
  const approvals=(context.approvals?.list?.()??[]).filter((item:any)=>item.state==='PENDING');
  const oauth=context.oauth?.listPendingAuthorizations?.()??[];
  const sessions=context.sessions?.list?.()??[];
  const processes=context.processes?.listLocal?.()??[];
  const changes=context.changes?.list?.()??[];
  const connectors=context.connectors?.list?.()??[];
  const workspaces=context.workspaces?.listRemote?.()??context.workspaces?.listLocal?.()??[];
  const workspaceNames=new Map(workspaces.map((workspace:any)=>[String(workspace.id),String(workspace.name??workspace.id)]));
  const toolCalls=metrics.reduce((sum:number,row:any)=>sum+Number(row.calls||0),0),totalMs=metrics.reduce((sum:number,row:any)=>sum+Number(row.totalMs||0),0);
  const activeConnections=sessions.map((session:any)=>{
    const lease=session.lease??null,workspaceId=lease?.workspaceId??null;
    return{id:session.id,actor:session.actor,client:String(session.actor??'').replace(/^(oauth:|connector:)/,''),authType:authType(String(session.actor??'')),remoteIp:session.remoteIp??null,workspaceId,workspace:workspaceId?(workspaceNames.get(String(workspaceId))??workspaceId):null,capabilities:lease?.capabilities??[],connectedAt:session.createdAt,lastActivityAt:session.lastActivityAt,status:'active'};
  });
  return{
    generatedAt:now.toISOString(),startedAt,uptimeSeconds:Math.max(0,Math.floor((now.getTime()-Date.parse(startedAt))/1000)),status,metrics,
    pending:{approvals:approvals.length,oauth:oauth.length,total:approvals.length+oauth.length},
    stats:{sessions:sessions.length,workspaceLeases:sessions.filter((row:any)=>row.activeLeaseId||row.lease).length,processes:processes.filter((row:any)=>row.ownership!=='detached-uncertain').length,openChanges:changes.filter((row:any)=>row.state==='OPEN').length,toolCalls,avgToolLatencyMs:toolCalls?Math.round(totalMs/toolCalls):null,connectors:connectors.length},
    activeConnections,connectors,
  };
}
