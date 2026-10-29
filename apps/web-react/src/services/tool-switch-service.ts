import type { ToolSwitchesResponse, ToolSwitchesUpdate } from '@aevra/admin-contracts';
import { requestJson } from './api-client';

export function fetchToolSwitches(): Promise<ToolSwitchesResponse> {
  return requestJson<ToolSwitchesResponse>('/api/tool-switches');
}

export function saveToolSwitches(disabled: string[]): Promise<ToolSwitchesResponse> {
  const body: ToolSwitchesUpdate = { disabled };
  return requestJson<ToolSwitchesResponse>('/api/tool-switches', {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}
