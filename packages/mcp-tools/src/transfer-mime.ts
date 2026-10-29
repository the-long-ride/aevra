const BY_EXTENSION: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  html: 'text/html',
  json: 'application/json',
  xml: 'application/xml',
  zip: 'application/zip',
  js: 'text/javascript',
  ts: 'text/plain',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  mp4: 'video/mp4',
  blend: 'application/x-blender',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

/** Extension fallback when the executor could not sniff the content. */
export function mimeFromPath(path: string): string {
  const name = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
  const dot = name.lastIndexOf('.');
  const extension = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
  return BY_EXTENSION[extension] ?? 'application/octet-stream';
}
