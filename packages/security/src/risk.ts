import type {RiskTier} from '../../protocol/src/index.js';
export function maxRisk(a:RiskTier,b:RiskTier):RiskTier{const order:RiskTier[]=['LOW','MEDIUM','HIGH','CRITICAL'];return order[Math.max(order.indexOf(a),order.indexOf(b))]!;}
export function isPersistentAlwaysAllowed(risk:RiskTier){return risk!=='CRITICAL';}
