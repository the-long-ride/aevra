import type { BrowserExtensionPairing } from '../../protocol/src/browser.js';
import { verifyExtensionToken } from '../../security/src/extension-token.js';
import type { Duplex } from 'node:stream';
import { encodeFrame } from './ws-server.js';

export interface ExtensionPairingAuthOptions {
  secret: Buffer;
  extensionId?: string;
  pairings?: () => BrowserExtensionPairing[];
  epoch: () => number;
}

export interface ExtensionPeerIdentity {
  pairingId: string;
  profileId: string | null;
  profileName: string;
  extensionId: string;
  credentialId: string | null;
}

export type ActiveExtensionProfile = Omit<ExtensionPeerIdentity, 'credentialId'>;

function configuredPairings(options: ExtensionPairingAuthOptions): BrowserExtensionPairing[] {
  if (options.pairings) return options.pairings();
  return options.extensionId
    ? [
        {
          pairingId: `legacy-${options.extensionId}`,
          profileId: null,
          profileName: 'Legacy browser profile',
          extensionId: options.extensionId,
          credentialId: null,
          legacy: true,
        },
      ]
    : [];
}

export function verifyExtensionPairing(
  options: ExtensionPairingAuthOptions,
  token: string,
  originExtensionId: string,
  presentedProfileId?: string,
): BrowserExtensionPairing | null {
  try {
    const claims = verifyExtensionToken(options.secret, token, { epoch: options.epoch() });
    if (claims.extensionId !== originExtensionId) return null;
    const pairings = configuredPairings(options);
    if (claims.profileId === undefined) {
      if (presentedProfileId !== undefined) return null;
      return (
        pairings.find(
          (pairing) =>
            pairing.legacy &&
            pairing.profileId === null &&
            pairing.credentialId === null &&
            pairing.extensionId === originExtensionId,
        ) ?? null
      );
    }
    if (presentedProfileId !== claims.profileId) return null;
    return (
      pairings.find(
        (pairing) =>
          !pairing.legacy &&
          pairing.profileId === claims.profileId &&
          pairing.credentialId === claims.credentialId &&
          pairing.extensionId === originExtensionId,
      ) ?? null
    );
  } catch {
    return null;
  }
}

export function activeExtensionProfile(
  peer: ExtensionPeerIdentity | null,
): ActiveExtensionProfile | null {
  if (!peer) return null;
  const { credentialId: _credentialId, ...profile } = peer;
  return profile;
}

export function rejectExtensionAuthentication(socket: Duplex): void {
  if (socket.destroyed) return;
  socket.write(encodeFrame(JSON.stringify({ type: 'auth_error', code: 'AUTH_REJECTED' })), () =>
    socket.end(),
  );
}

export function pairingStillAllowed(
  peer: ExtensionPeerIdentity | null,
  pairings: BrowserExtensionPairing[],
): boolean {
  if (!peer) return true;
  return pairings.some(
    (pairing) =>
      pairing.pairingId === peer.pairingId &&
      pairing.profileId === peer.profileId &&
      pairing.extensionId === peer.extensionId &&
      pairing.credentialId === peer.credentialId,
  );
}
