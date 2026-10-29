export interface ToolSwitchEntry {
  name: string;
  /** `aevra` for built-in tools, otherwise the upstream server slug. */
  source: string;
  group: string;
  /** Core tools cannot be switched off. */
  locked: boolean;
  enabled: boolean;
  /** False when the owning upstream server is not currently connected. */
  available: boolean;
  description: string;
}
export interface ToolSwitchesResponse {
  tools: ToolSwitchEntry[];
}
export interface ToolSwitchesUpdate {
  disabled: string[];
}
