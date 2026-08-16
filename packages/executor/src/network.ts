import type {NetworkPolicy} from '../../protocol/src/index.js';
export function normalizeDestination(value:string){const u=new URL(value.includes('://')?value:`https://${value}`);const protocol=u.protocol.replace(':','');const port=Number(u.port||({https:443,http:80,ssh:22}[protocol as 'https']??443));return{protocol,host:u.hostname.toLowerCase(),port};}
export function knownNetworkFamily(host:string){const h=host.toLowerCase();if(h==='registry.npmjs.org'||h.endsWith('.npmjs.org'))return'network.package.npm';if(h==='crates.io'||h.endsWith('.crates.io'))return'network.package.crates';if(h==='api.nuget.org'||h.endsWith('.nuget.org'))return'network.package.nuget';return null;}
export function denyAllPolicy():NetworkPolicy{return{mode:'deny-all',destinations:[],enforcement:'backend'};}
