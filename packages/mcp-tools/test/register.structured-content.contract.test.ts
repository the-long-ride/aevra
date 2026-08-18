import assert from 'node:assert/strict';
import test from 'node:test';
import {handleJsonRpc} from '../src/register.js';

test('tools/call always emits object structuredContent for array tool results',async()=>{
  const service={call:async()=>[{name:'one'},{name:'two'}]} as any;
  const response:any=await handleJsonRpc(service,'session',{jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'file_list',arguments:{path:'/'}}});
  assert.deepEqual(response.result.structuredContent,{result:[{name:'one'},{name:'two'}]});
  assert.equal(response.result.content[0].text,JSON.stringify([{name:'one'},{name:'two'}]));
});

test('tools/call preserves object structuredContent without double wrapping',async()=>{
  const service={call:async()=>({path:'/a.txt',content:'hello'})} as any;
  const response:any=await handleJsonRpc(service,'session',{jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'file_read',arguments:{path:'/a.txt'}}});
  assert.deepEqual(response.result.structuredContent,{path:'/a.txt',content:'hello'});
});
