import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { applyMigrations } from './migrations.js';
export class AevraDatabase {
  private constructor(private readonly db:DatabaseSync, readonly path:string){}
  static open(file:string){if(file!==':memory:')mkdirSync(path.dirname(file),{recursive:true,mode:0o700});const db=new DatabaseSync(file);db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');if(file!==':memory:')db.exec('PRAGMA journal_mode=WAL;');applyMigrations(db);return new AevraDatabase(db,file);}
  raw(){return this.db;}
  integrityCheck(){const rows=this.db.prepare('PRAGMA integrity_check').all() as Array<{integrity_check:string}>;const msg=rows.map(r=>r.integrity_check).join(';');return msg==='ok'?{ok:true as const}:{ok:false as const,message:msg};}
  backup(destination:string){mkdirSync(path.dirname(destination),{recursive:true});if(existsSync(destination))unlinkSync(destination);const q=destination.replaceAll("'","''");this.db.exec(`VACUUM INTO '${q}'`);}
  transaction<T>(fn:()=>T):T{this.db.exec('BEGIN IMMEDIATE');try{const v=fn();this.db.exec('COMMIT');return v}catch(e){this.db.exec('ROLLBACK');throw e}}
  tableNames(){return (this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as Array<{name:string}>).map(r=>r.name);}
  tableColumns(table:string){if(!/^[a-z_]+$/i.test(table))throw new Error('Invalid table');return (this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{name:string}>).map(r=>r.name);}
  close(){this.db.close();}
}
