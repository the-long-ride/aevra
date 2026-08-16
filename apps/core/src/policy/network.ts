import {
  knownNetworkFamily,
  normalizeDestination,
} from '../../../../packages/executor/src/network.js';
export interface NetworkDecision {
  family: string;
  destination: { protocol: string; host: string; port: number };
  known: boolean;
}
export function classifyNetworkDestination(value: string): NetworkDecision {
  const destination = normalizeDestination(value),
    known = knownNetworkFamily(destination.host);
  return {
    family: known ?? `network.host:${destination.protocol}:${destination.host}:${destination.port}`,
    destination,
    known: Boolean(known),
  };
}
export function validateNetworkRuleHost(host: string) {
  if (host.includes('*'))
    throw new Error(
      'Wildcard hosts must be created explicitly through advanced local policy and are never inferred',
    );
  return host.toLowerCase();
}
