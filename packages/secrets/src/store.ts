export interface SecretStore{set(ref:string,value:string):Promise<void>;get(ref:string):Promise<string|null>;delete(ref:string):Promise<void>;}
