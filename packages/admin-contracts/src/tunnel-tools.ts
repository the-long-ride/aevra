export type TunnelToolId = 'cloudflared' | 'ngrok';

export interface TunnelToolStatus {
  available: boolean;
  version?: string;
}

export interface TunnelToolsStatus {
  cloudflared: TunnelToolStatus;
  ngrok: TunnelToolStatus;
  recommended: TunnelToolId | null;
}

export const TUNNEL_TOOL_DOWNLOADS: Record<TunnelToolId, string> = {
  cloudflared:
    'https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/',
  ngrok: 'https://ngrok.com/download',
};

/** Product rule: when both tools are ready, Cloudflare Tunnel wins. */
export function recommendTunnelTool(
  tools: Record<TunnelToolId, Pick<TunnelToolStatus, 'available'>>,
): TunnelToolId | null {
  if (tools.cloudflared.available) return 'cloudflared';
  if (tools.ngrok.available) return 'ngrok';
  return null;
}
