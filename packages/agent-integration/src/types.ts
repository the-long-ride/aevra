export const AGENT_TARGETS = [
  'codex',
  'claude-code',
  'opencode',
  'antigravity',
  'antigravity-cli',
  'antigravity-ide',
] as const;
export type AgentTarget = (typeof AGENT_TARGETS)[number];
export type Product = 'aevra' | 'aevra-browser';
export type AgentTransport = 'stdio' | 'http';
export type AgentScope = 'user' | 'workspace';
export interface Credential {
  id: string;
  token: string;
}
export interface CredentialAdapter {
  create(name: string): Promise<Credential>;
  revoke(id: string): Promise<void>;
}
export interface AgentOptions {
  home: string;
  env: Record<string, string | undefined>;
  product: Product;
  target: AgentTarget | 'all';
  operation: 'install' | 'uninstall' | 'status';
  transport: AgentTransport;
  executable: string;
  entrypoint: string;
  stateDir: string;
  endpoint: string;
  caFile?: string;
  dryRun?: boolean;
  // `all` (uninstall only): every registration of the targets, user and workspace.
  scope?: AgentScope | 'all';
  workspaceRoot?: string;
  // Uninstall only: exactly the registration that issued this credential id.
  credentialId?: string;
  credentials: CredentialAdapter;
}
export interface AgentLocation {
  config: string;
  kind: 'toml' | 'json' | 'jsonc';
  entryPath: string[];
  skills: string[];
}
export interface Registration {
  target: AgentTarget;
  scope: AgentScope;
  workspaceRoot?: string;
  transport: AgentTransport;
  config: string;
  entryPath: string[];
  entryHash: string;
  credentialId: string;
  credentialFile: string;
  credentialHash: string;
  links: string[];
}
export interface AgentManifest {
  version: 1 | 2;
  product: Product;
  skillHash: string;
  registrations: Registration[];
}
export interface AgentChange {
  target: AgentTarget;
  file: string;
  action: 'create' | 'update' | 'remove';
}
export interface AgentResult {
  dryRun: boolean;
  registrations: Array<Registration & { state?: 'installed' | 'incomplete' | 'conflict' }>;
  message: string;
  notes: string[];
  changes: AgentChange[];
  // Uninstall only: the target of each registration removed (or, in a dry run, to be removed).
  removed?: AgentTarget[];
}
