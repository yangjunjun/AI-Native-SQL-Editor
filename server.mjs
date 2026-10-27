import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from 'node:process';
const htmlPath=fileURLToPath(new URL('./index.html',import.meta.url));
export function loadConfig(path=new URL('./.env',import.meta.url)){
  try{loadEnvFile(path);}catch(error){if(error.code!=='ENOENT')throw error;}
}
export function validate(v){
  return v&&typeof v.sql==='string'&&typeof v.instruction==='string'&&typeof v.dialect==='string'&&v.sql.length<=50000&&v.instruction.trim().length>0&&v.instruction.length<=2000&&v.dialect.length<=80;
}
function respond(res,status,message){res.writeHead(status,{'content-type':'text/plain; charset=utf-8'});res.end(message);}
const send=(res,event,payload)=>res.write('event: '+event+'\ndata: '+JSON.stringify(payload)+'\n\n');
export function createServer(){
return http.createServer(async(req,res)=>{
  if(req.method==='GET'&&(req.url==='/'||req.url==='/index.html')){
    res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});
    res.end(await readFile(htmlPath));return;
  }
  if(req.method!=='POST'||req.url!=='/api/rewrite'){respond(res,404,'Not found');return;}
  if(!process.env.AI_API_KEY){respond(res,503,'AI_API_KEY is not set on the Node server');return;}
  let raw='';try{for await(const chunk of req){raw+=chunk;if(raw.length>110000){respond(res,413,'Request too large');return;}}}catch{respond(res,400,'Invalid request');return;}
  let body;try{body=JSON.parse(raw)}catch{respond(res,400,'Invalid JSON');return;}
  if(!validate(body)){respond(res,400,'Invalid sql/instruction/dialect');return;}
  const controller=new AbortController();
  res.on('close',()=>{if(!res.writableEnded)controller.abort();});
  try{
    const base=(process.env.AI_BASE_URL||'https://api.openai.com/v1').replace(/\/$/,'');
    const upstream=await fetch(base+'/chat/completions',{
      method:'POST',signal:controller.signal,
      headers:{'content-type':'application/json','authorization':'Bearer '+process.env.AI_API_KEY},
      body:JSON.stringify({model:process.env.AI_MODEL||'gpt-4.1-mini',stream:true,messages:[
        {role:'system',content:'Rewrite the provided SQL according to the instruction in '+body.dialect+' syntax. Output ONLY complete SQL, no prose or markdown. Preserve unrelated statements, and do not invent unknown schema.'},
        {role:'user',content:'Instruction:\n'+body.instruction+'\n\nSQL:\n'+body.sql}
      ]})
    });
    if(!upstream.ok){respond(res,502,'Provider HTTP '+upstream.status+': '+(await upstream.text()).slice(0,250));return;}
    if(!upstream.body){respond(res,502,'Provider response is empty');return;}
    res.writeHead(200,{'content-type':'text/event-stream; charset=utf-8','cache-control':'no-cache, no-transform','x-accel-buffering':'no'});
    const decoder=new TextDecoder();let buffer='',response='';
    for await(const chunk of upstream.body){
      buffer+=decoder.decode(chunk,{stream:true}).replace(/\r/g,'');
      let index;
      while((index=buffer.indexOf('\n\n'))>=0){
        const packet=buffer.slice(0,index);buffer=buffer.slice(index+2);
        const line=packet.split('\n').find(x=>x.startsWith('data:'));
        if(!line||line.slice(5).trim()==='[DONE]')continue;
        try{const v=JSON.parse(line.slice(5));const part=v.choices?.[0]?.delta?.content||'';if(part){response+=part;send(res,'delta',{text:part});}}catch{/* ignore non-content events */}
      }
    }
    if(!response.trim()){send(res,'error',{message:'Provider returned empty SQL'});}
    else send(res,'done',{});
    res.end();
  }catch(e){if(!res.headersSent)respond(res,502,e.message||'Provider failed');else if(!res.destroyed){send(res,'error',{message:e.message||'Provider failed'});res.end();}}
});
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
  loadConfig();
  const port=Number(process.env.PORT||3000);
  createServer().listen(port,()=>console.log('SQL Editor on http://localhost:'+port));
}
