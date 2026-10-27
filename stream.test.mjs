import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

// Exercise the actual browser parser without requiring Monaco or a provider.
const html=await readFile(new URL('./index.html',import.meta.url),'utf8');
const start=html.indexOf('  async function streamAI(');
const end=html.indexOf('  async function generate(',start);
assert.ok(start>=0&&end>start);
const source=html.slice(start,end);
function parser(chunks,status=200){
  const fetch=async()=>new Response(new ReadableStream({
    start(controller){for(const chunk of chunks)controller.enqueue(chunk);controller.close();}
  }),{status});
  return new Function('fetch',source+';return streamAI;')(fetch);
}
const bytes=text=>new TextEncoder().encode(text);
const packet=(event,payload)=>`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;

test('SSE deltas update SQL with actual line breaks between events',async()=>{
  const parts=['SELECT\n    user_id,\n    SUM(amount',') AS total_amount\nFROM orders\n',
    'WHERE order_date >= DATE_SUB(CUR','DATE(), INTERVAL 1 MONTH)\nGROUP',
    ' BY user_id\nORDER BY total_amount',' DESC;'];
  const stream=parts.map(text=>packet('delta',{text})).join('')+packet('done',{});
  const received=[];
  await parser([bytes(stream)])('SELECT 1','rewrite',new AbortController().signal,text=>received.push(text));
  assert.deepEqual(received,parts);
});

test('handles byte boundaries, CRLF events, and escaped characters inside SQL',async()=>{
  const sql="-- 中文说明\nSELECT 'a\\nb', 'c\\rd';\r\n";
  const encoded=bytes((packet('delta',{text:sql})+packet('done',{})).replace(/\n/g,'\r\n'));
  const chunks=Array.from(encoded,byte=>new Uint8Array([byte]));
  let received='';
  await parser(chunks)('SELECT 1','rewrite',new AbortController().signal,text=>received+=text);
  assert.equal(received,sql);
});

test('surfaces SSE provider errors instead of reporting success',async()=>{
  const stream=packet('delta',{text:'SELECT '})+packet('error',{message:'Provider failed'});
  await assert.rejects(parser([bytes(stream)])('SELECT 1','rewrite',new AbortController().signal,()=>{}),/Provider failed/);
});

test('surfaces HTTP errors',async()=>{
  await assert.rejects(parser([bytes('AI_API_KEY is not set')],503)('SELECT 1','rewrite',new AbortController().signal,()=>{}),/AI_API_KEY/);
});
