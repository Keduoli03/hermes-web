// Run the built panel against an isolated local Dashboard fixture, never a real Hermes profile.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { WebSocketServer } from "ws";
import { tmpdir } from "node:os";
import { resolve,join } from "node:path";
import { access, mkdtemp, rm } from "node:fs/promises";
const directory=resolve(process.argv[2] || process.cwd());
await access(join(directory,".next","BUILD_ID"));
let token="production-fixture-token-one",handshakes=0,writes=0;
const backend=createServer((request,response)=>{
  if(request.url==="/v1/models"){
    response.setHeader("Content-Type","application/json");
    if(request.headers.authorization!=="Bearer production-fixture-api-key"){response.statusCode=401;response.end('{}');return;}
    response.end('{"data":[]}');return;
  }
  if(request.url==="/"){handshakes++;response.setHeader("Content-Type","text/html");response.end(`<script>window.__HERMES_SESSION_TOKEN__=${JSON.stringify(token)};</script>`);return;}
  response.setHeader("Content-Type","application/json");
  if(request.headers["x-hermes-session-token"]!==token){response.statusCode=401;response.end('{"error":"Unauthorized"}');return;}
  if(request.method==="PUT")writes++;
  response.end(JSON.stringify(request.url==="/api/config/schema" ? {fields:{}} : {automatic:true}));
});
const websocket=new WebSocketServer({noServer:true});
backend.on("upgrade",(request,socket,head)=>{
  if(new URL(request.url,"http://localhost").searchParams.get("token")!==token){socket.end("HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n");return;}
  websocket.handleUpgrade(request,socket,head,client=>websocket.emit("connection",client));
});
websocket.on("connection",client=>client.on("message",raw=>{
  const frame=JSON.parse(raw);assert.equal(frame.method,"gateway.ping");
  client.send(JSON.stringify({id:frame.id,result:{ok:true}}));
}));
backend.listen(0,"127.0.0.1");await once(backend,"listening");
const reservation=createServer();reservation.listen(0,"127.0.0.1");await once(reservation,"listening");
const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
const origin=`http://127.0.0.1:${port}`;
const authDirectory=await mkdtemp(join(tmpdir(),"hermes-production-auth-"));
const backendOrigin=`http://127.0.0.1:${backend.address().port}`;
const env={...process.env,HERMES_WEB_DATA_DIR:authDirectory,HERMES_DASHBOARD_URL:backendOrigin,HERMES_API_SERVER_URL:backendOrigin,API_SERVER_KEY:"production-fixture-api-key",HERMES_DASHBOARD_SESSION_TOKEN:"",PI_WEB_USERNAME:"fixture-admin",PI_WEB_PASSWORD:"production-fixture-password",HERMES_WEB_OAUTH_CLIENT_ID:"",PI_WEB_ALLOWED_HOSTS:"127.0.0.1,localhost",HERMES_TEST_URL:origin,HERMES_TEST_BROWSER:process.env.HERMES_TEST_BROWSER || "msedge"};
const server=spawn(process.execPath,["node_modules/next/dist/bin/next","start","-H","127.0.0.1","-p",String(port)],{cwd:directory,env,stdio:["ignore","ignore","pipe"],windowsHide:true});
let diagnostics="";server.stderr.on("data",data=>{diagnostics=(diagnostics+data.toString()).slice(-2000);});
try{
  let ready=false;
  for(let attempt=0;attempt<100;attempt++){
    if(server.exitCode!==null)throw new Error("Production server exited: "+diagnostics);
    try{if((await fetch(origin+"/login")).ok){ready=true;break;}}catch{}
    await new Promise(resolve=>setTimeout(resolve,200));
  }
  assert.equal(ready,true,"production server must start");
  assert.equal((await fetch(origin+"/api/hermes/api/config")).status,401);assert.equal(handshakes,0);
  const login=await fetch(origin+"/api/web-auth",{method:"POST",headers:{"Content-Type":"application/json",Origin:origin},body:JSON.stringify({username:env.PI_WEB_USERNAME,password:env.PI_WEB_PASSWORD})});
  assert.equal(login.status,200);const cookie=login.headers.get("set-cookie").split(";")[0];
  const result=await fetch(origin+"/api/hermes/api/config",{headers:{Cookie:cookie}});assert.equal(result.status,200);assert.equal((await result.json()).automatic,true);assert.equal(handshakes,1);
  token="production-fixture-token-two";
  const update=await fetch(origin+"/api/hermes/api/config",{method:"PUT",headers:{Cookie:cookie,Origin:origin,"Content-Type":"application/json"},body:'{"config":{"agent":{"max_turns":10}}}'});
  assert.equal(update.status,200);assert.equal(writes,1);assert.equal(handshakes,2);
  const status=await(await fetch(origin+"/api/hermes-connection",{headers:{Cookie:cookie}})).json();assert.equal(status.connected,true);assert.equal(status.automatic,true);assert.equal(JSON.stringify(status).includes(token),false);
  console.log("PASS: production login, automatic backend handshake, token rotation and credential isolation.");
  const runner=spawn(process.execPath,["e2e/run.mjs",...process.argv.slice(3)],{cwd:directory,env,stdio:"inherit",windowsHide:true});
  const [code]=await once(runner,"exit");assert.equal(code,0,"production browser suites must pass");
}finally{
  if(server.exitCode===null){server.kill();await once(server,"exit");}
  for(const client of websocket.clients)client.terminate();
  await new Promise(resolve=>websocket.close(resolve));
  backend.closeAllConnections();await new Promise(resolve=>backend.close(resolve));
  await rm(authDirectory,{recursive:true,force:true});
}
