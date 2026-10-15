import { hermesJson } from "./hermes-client";
export const scoped = (path:string,profile:string,params:Record<string,string>={})=>`${path}?${new URLSearchParams({...params,...(profile?{profile}:{})})}`;
export async function waitHermesAction(result:{name?:string;pid?:number},signal:AbortSignal) {
  if(!result.name || !result.pid)throw new Error("Hermes 未返回可确认的任务标识。");
  for(let attempt=0;attempt<180;attempt++){
    const status=await hermesJson<{running:boolean;exit_code:number|null;pid:number|null}>(`/api/actions/${encodeURIComponent(result.name)}/status?lines=0`,{signal});
    if(status.pid!==result.pid)throw new Error("任务状态已被另一次操作替换，请在 Hermes 中检查结果。");
    if(!status.running){if(status.exit_code!==0)throw new Error(status.exit_code==null ? "任务结果未知，请在 Hermes 中检查。" : `任务失败（退出码 ${status.exit_code}）。`);return;}
    await new Promise<void>((resolve,reject)=>{const abort=()=>{clearTimeout(timer);reject(new DOMException("Aborted","AbortError"));};const timer=setTimeout(()=>{signal.removeEventListener("abort",abort);resolve();},1500);signal.addEventListener("abort",abort,{once:true});if(signal.aborted)abort();});
  }
  throw new Error("任务仍在运行，请稍后刷新检查结果。");
}
export function envPairs(text:string) {
  const result:Record<string,string>=Object.create(null);for(const line of text.split(/\r?\n/)){if(!line.trim())continue;const index=line.indexOf("=");if(index<1 || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(line.slice(0,index).trim()))throw new Error("请按每行一个 NAME=VALUE 填写环境变量。");result[line.slice(0,index).trim()]=line.slice(index+1);}return result;
}
