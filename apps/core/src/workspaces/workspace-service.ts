import type { CapabilityRoot } from '../../../../packages/protocol/src/index.js';
import {
  WorkspaceRepository,
  type WorkspaceRemoteView,
} from '../../../../packages/store/src/workspaces.js';
export interface MountRemoteView {
  id: string;
  logicalPath: string;
  capabilities: any[];
}
export class WorkspaceService {
  constructor(private repo: WorkspaceRepository) {}
  create(input: { name: string; description?: string; hostRoot: string }) {
    return this.repo.create(input);
  }
  update(id: string, input: any) {
    return this.repo.update(id, input);
  }
  delete(id: string) {
    this.repo.delete(id);
  }
  listRemote(): WorkspaceRemoteView[] {
    return this.repo.listRemote();
  }
  listLocal() {
    return this.repo.list();
  }
  getLocal(idOrName: string) {
    return this.repo.get(idOrName) ?? this.repo.getByName(idOrName);
  }
  addMount(workspaceId: string, input: any) {
    return this.repo.addMount(workspaceId, input);
  }
  deleteMount(id: string) {
    this.repo.deleteMount(id);
  }
  listMountsLocal(workspaceId: string) {
    return this.repo.listMounts(workspaceId);
  }
  listMountsRemote(workspaceId: string): MountRemoteView[] {
    return this.repo
      .listMounts(workspaceId)
      .map(({ id, logicalPath, capabilities }) => ({ id, logicalPath, capabilities }));
  }
  capabilityRoots(workspaceId: string): CapabilityRoot[] {
    const w = this.repo.get(workspaceId);
    if (!w) throw new Error('workspace not found');
    const roots: CapabilityRoot[] = [
      {
        id: `workspace:${w.id}`,
        kind: 'workspace',
        logicalPrefix: '/',
        hostRoot: w.hostRoot,
        capabilities: [
          'files.read',
          'files.search',
          'git.read',
          'files.write',
          'files.delete',
          'commands.run',
          'git.commit',
          'git.push',
          'network',
        ],
      },
    ];
    for (const m of this.repo.listMounts(workspaceId))
      roots.push({
        id: m.id,
        kind: 'external',
        logicalPrefix: m.logicalPath,
        hostRoot: m.hostRoot,
        capabilities: m.capabilities,
        sensitivityPolicyId: m.sensitivityPolicyId,
      });
    return roots;
  }
}
