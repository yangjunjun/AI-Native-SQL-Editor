import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer,validate} from './server.mjs';
test('request validation',()=>{
  assert.equal(validate({sql:'SELECT 1',instruction:'add a filter',dialect:'MySQL'}),true);
  assert.equal(validate({sql:'SELECT 1',instruction:'',dialect:'MySQL'}),false);
  assert.equal(validate({sql:'x'.repeat(50001),instruction:'modify',dialect:'MySQL'}),false);
});
test('local proxy fails closed without API key',async()=>{
  const saved=process.env.AI_API_KEY; delete process.env.AI_API_KEY;
  const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const {port}=server.address();
    const r=await fetch('http://127.0.0.1:'+port+'/api/rewrite',{method:'POST',body:JSON.stringify({sql:'SELECT 1',instruction:'rewrite',dialect:'MySQL'})});
    assert.equal(r.status,503);
    assert.match(await r.text(),/AI_API_KEY/);
  }finally{await new Promise(resolve=>server.close(resolve));if(saved!==undefined)process.env.AI_API_KEY=saved;}
});
