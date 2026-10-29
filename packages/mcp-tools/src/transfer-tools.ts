import { handleFilesDownload } from './files-download-tool.js';
import { handleFilesUpload } from './files-upload-tool.js';
import type { McpRuntimeContext } from './service-types.js';

export const TRANSFER_TOOL_NAMES = new Set(['files_download', 'files_upload']);

export function handleTransferTool(
  context: McpRuntimeContext,
  sessionId: string,
  name: string,
  args: any,
) {
  return name === 'files_upload'
    ? handleFilesUpload(context, sessionId, args)
    : handleFilesDownload(context, sessionId, args);
}
