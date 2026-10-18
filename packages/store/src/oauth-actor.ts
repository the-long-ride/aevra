export function redirectOrigin(uri: string): string {
  const url = new URL(uri);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw new Error('Unsupported OAuth redirect origin');
  return url.origin;
}

export function oauthActor(clientName: string, redirectUri: string) {
  return `oauth:${clientName}@${redirectOrigin(redirectUri)}`;
}
