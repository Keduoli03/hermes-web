import { WebSocket } from "ws";

/** A bounded, server-only bridge to the official manual-compression RPC. */
/** @param {string} sessionId @param {{signal?: AbortSignal, dashboardUrl: string, token: string, reconnect?: () => Promise<string>}} options */
export async function compressHermesSession(sessionId, {signal, dashboardUrl, token, reconnect = undefined}) {
  const url = new URL("/api/ws", dashboardUrl);
  const origin = url.origin;
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("token", token);
  const socket = new WebSocket(url, {origin, maxPayload: 16 * 1024 * 1024});
  const pending = new Map(); let sequence = 0; let runtimeId; let connected = false;
  function rpc(method, params, timeout = 30000) {
    return new Promise((resolve,reject)=>{
      const id=++sequence;
      const timer=setTimeout(()=>{pending.delete(id);reject(new Error("Hermes 会话操作超时，请重新打开会话检查结果。"));},timeout);
      pending.set(id,{resolve,reject,timer});
      socket.send(JSON.stringify({jsonrpc:"2.0",id,method,params}));
    });
  }
  function failPending() {for(const call of pending.values()){clearTimeout(call.timer);call.reject(new Error("Hermes 会话连接已断开。"));}pending.clear();}
  socket.on("message",raw=>{
    for(const line of raw.toString().split("\n")) {
      let frame;try{frame=JSON.parse(line);}catch{continue;}
      const call=pending.get(frame.id);if(!call)continue;
      pending.delete(frame.id);clearTimeout(call.timer);
      if(frame.error)call.reject(new Error(String(frame.error.message || "Hermes 会话操作失败。").split(token).join("[已隐藏]")));else call.resolve(frame.result);
    }
  });
  socket.on("error",failPending);socket.on("close",failPending);
  const cancel=()=>{if(socket.readyState===WebSocket.OPEN && runtimeId) socket.send(JSON.stringify({jsonrpc:"2.0",id:++sequence,method:"session.interrupt",params:{session_id:runtimeId}}));failPending();};
  signal?.addEventListener("abort",cancel,{once:true});
  try {
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{socket.terminate();reject(new Error("无法连接 Hermes 会话服务。"));},10000);socket.once("open",()=>{clearTimeout(timer);resolve();});socket.once("error",()=>{clearTimeout(timer);reject(new Error("无法连接 Hermes 会话服务，请检查管理服务是否启用聊天。"));});socket.once("close",()=>{clearTimeout(timer);reject(new Error("Hermes 会话服务拒绝了连接。"));});});
    connected = true;
    if(signal?.aborted)throw new Error("操作已取消。");
    const resumed=await rpc("session.resume",{session_id:sessionId,omit_messages:true,inline_images:false,close_on_disconnect:true});
    runtimeId=resumed.session_id;
    if(resumed.running || ["working","streaming","starting","resuming"].includes(resumed.status))throw new Error("会话正在运行，请等待完成后再压缩。");
    if(signal?.aborted)throw new Error("操作已取消。");
    const result=await rpc("session.compress",{session_id:runtimeId},180000);
    if(result.status !== "compressed" || result.compressed === false)throw new Error(result.message || "Hermes 尚未完成压缩，请重新打开会话检查结果。");
    return {status:result.status,before_tokens:result.before_tokens,after_tokens:result.after_tokens,before_messages:result.before_messages,after_messages:result.after_messages};
  } catch(error) {
    if (!connected && reconnect && !signal?.aborted) return compressHermesSession(sessionId,{signal,dashboardUrl,token:await reconnect()});
    throw error;
  } finally {signal?.removeEventListener("abort",cancel);failPending();socket.close();}
}
