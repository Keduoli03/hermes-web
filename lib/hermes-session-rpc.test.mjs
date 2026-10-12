import test from "node:test";
import assert from "node:assert/strict";
import { WebSocketServer } from "ws";
import { compressHermesSession } from "./hermes-session-rpc.mjs";

async function fixture(handler) {
  const server=new WebSocketServer({port:0});await new Promise(resolve=>server.once("listening",resolve));
  const methods=[];server.on("connection",(socket,request)=>{assert.equal(new URL(request.url,"http://localhost").searchParams.get("token"),"server-secret");socket.on("message",raw=>{const frame=JSON.parse(raw);methods.push(frame);handler(socket,frame);});});
  return {server,methods,url:`http://127.0.0.1:${server.address().port}`,close:()=>new Promise(resolve=>server.close(resolve))};
}
test("compression resumes the stored session and compresses its runtime id, with no secret or transcript returned",async()=>{
  const f=await fixture((socket,frame)=>socket.send(JSON.stringify({id:frame.id,result:frame.method === "session.resume" ? {session_id:"runtime-1",running:false} : {status:"compressed",before_tokens:1000,after_tokens:200,messages:[{content:"private"}],info:{secret:"private"}}})));
  try{const result=await compressHermesSession("stored-1",{dashboardUrl:f.url,token:"server-secret"});assert.deepEqual(f.methods.map(f=>f.method),["session.resume","session.compress"]);assert.equal(f.methods[1].params.session_id,"runtime-1");assert.equal(result.after_tokens,200);assert.equal(JSON.stringify(result).includes("private"),false);}finally{await f.close();}
});
test("a running session is refused without sending a compression request",async()=>{
  const f=await fixture((socket,frame)=>socket.send(JSON.stringify({id:frame.id,result:{session_id:"runtime-1",running:true}})));
  try{await assert.rejects(compressHermesSession("stored-1",{dashboardUrl:f.url,token:"server-secret"}),/正在运行/);assert.deepEqual(f.methods.map(f=>f.method),["session.resume"]);}finally{await f.close();}
});
test("a refused or aborted compression is not reported as success",async()=>{
  const f=await fixture((socket,frame)=>socket.send(JSON.stringify({id:frame.id,result:frame.method === "session.resume" ? {session_id:"runtime-1"} : {status:"aborted",compressed:false,message:"summary failed"}})));
  try{await assert.rejects(compressHermesSession("stored-1",{dashboardUrl:f.url,token:"server-secret"}),/summary failed/);}finally{await f.close();}
});
test("request cancellation asks the runtime session to interrupt",async()=>{
  const controller=new AbortController();
  const f=await fixture((socket,frame)=>{
    if(frame.method === "session.resume")socket.send(JSON.stringify({id:frame.id,result:{session_id:"runtime-1"}}));
    else if(frame.method === "session.compress")controller.abort();
  });
  try{await assert.rejects(compressHermesSession("stored-1",{dashboardUrl:f.url,token:"server-secret",signal:controller.signal}));await new Promise(resolve=>setTimeout(resolve,20));assert.equal(f.methods.some(frame=>frame.method === "session.interrupt" && frame.params.session_id === "runtime-1"),true);}finally{await f.close();}
});
