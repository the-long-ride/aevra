import assert from 'node:assert/strict';
import test from 'node:test';
import {STABLE_TOOL_NAMES} from '../../packages/mcp-tools/src/registry.js';
import {PermissionRepository} from '../../packages/store/src/permissions.js';
import {AevraDatabase} from '../../packages/store/src/database.js';
import {PermissionEngine} from '../../apps/core/src/policy/permissions.js';

test('remote MCP has no filesystem-root administration tools',()=>{for(const name of ['workspace_add','workspace_remove','workspace_update','mount_add','mount_remove','mount_update'])assert.equal((STABLE_TOOL_NAMES as readonly string[]).includes(name),false,name);});

test('critical operation cannot be authorized by persistent allow rule',()=>{const db=AevraDatabase.open(':memory:');const repo=new PermissionRepository(db.raw());repo.upsert({id:'p',effect:'allow',capability:'commands.run',scope:'global',matcher:'security:disable',createdAt:new Date().toISOString()});const d=new PermissionEngine(repo).decide({capability:'commands.run',matcher:'security:disable',actor:'a',sessionId:'s',workspaceId:'w',risk:'CRITICAL'});assert.equal(d.outcome,'approval');db.close();});
