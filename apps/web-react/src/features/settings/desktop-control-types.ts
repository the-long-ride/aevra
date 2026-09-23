export interface AppCatalogRow {
  displayName: string;
  version: string | null;
  executablePath?: string;
  exeBasename?: string;
  sources?: string[];
  grantable?: boolean;
  reason?: 'needs-manual-path' | 'shared-runtime';
  isCustom?: boolean;
  isGranted?: boolean;
  grantId?: string;
  customAppId?: string;
}

export interface DetectedApp extends AppCatalogRow {
  executablePath: string;
  exeBasename: string;
}

export interface DesktopAppGrantRow {
  id: string;
  executablePath: string;
  displayName: string;
  createdAt: string;
  createdBy?: string;
  sessionId?: string;
}

export interface DesktopAppCatalogResponse {
  apps: AppCatalogRow[];
  warnings?: string[];
}

export type DesktopAppsLoadResult = DesktopAppCatalogResponse | AppCatalogRow[];

export interface DesktopPolicySnapshot {
  mode: 'allowlist' | 'denylist';
  applications: string[];
  exposeExecutablePaths?: boolean;
  unattributedInput: 'allow' | 'deny';
  deniedTitlePatterns?: string[];
}
