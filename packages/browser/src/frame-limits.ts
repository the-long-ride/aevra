/**
 * Largest payload a single extension socket frame may declare.
 *
 * Lives apart from `ws-server.ts` because both ends need it and only one of
 * them runs under Node: the extension's service worker cannot load a module
 * that imports `node:crypto`, and it must refuse to send what the worker would
 * refuse to read.
 */
export const MAX_FRAME_BYTES = 8 * 1024 * 1024;
