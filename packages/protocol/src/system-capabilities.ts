export type SystemToolCategory =
  | 'source-control'
  | 'javascript'
  | 'python'
  | 'dotnet'
  | 'rust'
  | 'go'
  | 'jvm'
  | 'ruby'
  | 'php'
  | 'native'
  | 'containers';

export interface SystemToolCapability {
  id: string;
  label: string;
  category: SystemToolCategory;
  available: boolean;
  executable?: string;
  version?: string;
}

export interface SystemShellCapability {
  id: string;
  label: string;
  version?: string;
}

export interface SystemCapabilitySnapshot {
  scope: 'host';
  detectedAt: string;
  os: {
    platform: 'windows' | 'macos' | 'linux' | 'other';
    platformDetail?: string;
    arch: string;
    recommendedShell: string | null;
    availableShells: SystemShellCapability[];
  };
  toolchains: SystemToolCapability[];
}
