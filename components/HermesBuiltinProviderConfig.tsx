"use client";

import { useEffect, useState } from "react";
import { hermesJson } from "@/lib/hermes-client";
import { useHermesI18n } from "@/hooks/useHermesI18n";
import type { ProviderChoice } from "./HermesProviderPicker";
import { ConfigButton, ConfigDetailTitle, ConfigField, ConfigNotice } from "./SettingsUi";

type Login = {session_id:string; user_code:string; verification_url:string};
export function HermesBuiltinProviderConfig({choice, modelBusy, onDirtyChange, onModelChange}: {choice:ProviderChoice; modelBusy:boolean; onDirtyChange:(dirty:boolean)=>void; onModelChange:(model:string,provider?:string)=>void}) {
  const {ht}=useHermesI18n();
  const {provider,oauth}=choice;
  const [key,setKey]=useState(""); const [model,setModel]=useState(provider.models?.[0] ?? "");
  const [busy,setBusy]=useState(false); const [error,setError]=useState(""); const [notice,setNotice]=useState("");
  const [login,setLogin]=useState<Login|null>(null);
  useEffect(()=>{onDirtyChange(Boolean(key)||busy||Boolean(login));},[key,busy,login,onDirtyChange]);
  useEffect(()=>{
    if (!login) return;
    const controller=new AbortController(); let timer:ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const result=await hermesJson<{status:string;error_message?:string}>(`/api/providers/oauth/${oauth!.id}/poll/${login!.session_id}`,{signal:controller.signal});
        if (controller.signal.aborted) return;
        if (result.status === "approved") {setLogin(null);setNotice(ht("账号已连接"));}
        else if (result.status !== "pending") {setLogin(null);setError(result.error_message || ht("授权未完成，请重新登录。"));}
        else timer=setTimeout(poll,3000);
      } catch(e) {if (!controller.signal.aborted) {setLogin(null);setError(e instanceof Error?e.message:String(e));}}
    }
    timer=setTimeout(poll,3000);
    return ()=>{controller.abort();clearTimeout(timer);};
  },[login,oauth,ht]);
  async function run(action:()=>Promise<void>) {setBusy(true);setError("");setNotice("");try{await action();}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}}
  return <div className="hermes-form hermes-builtin-provider"><ConfigDetailTitle>{provider.name}</ConfigDetailTitle><p className="hermes-provider-intro">{ht("连接提供商后，选择模型并设为默认；仅打开此页面不会修改配置。")}</p>{error && <div role="alert"><ConfigNotice>{error}</ConfigNotice></div>}{notice && <div role="status"><ConfigNotice>{notice}</ConfigNotice></div>}
    {oauth && <section className="hermes-provider-auth"><h3>{ht("账号登录")}</h3>{oauth.flow === "external" ? <><p>{ht("这个服务使用官方命令行完成登录。在 Hermes 所在电脑的终端运行：")}</p><pre>{oauth.cli_command}</pre></> : login ? <><p>{ht("打开授权页面，输入下方代码完成登录。")}</p><strong className="hermes-device-code">{login.user_code}</strong>{/^https:\/\//.test(login.verification_url) && <a href={login.verification_url} target="_blank" rel="noopener noreferrer">{ht("打开授权页面")}</a>}<ConfigButton disabled={busy} onClick={()=>void run(async()=>{await hermesJson(`/api/providers/oauth/sessions/${login.session_id}`,{method:"DELETE"});setLogin(null);})}>{ht("取消登录")}</ConfigButton></> : <ConfigButton disabled={busy} onClick={()=>void run(async()=>{const result=await hermesJson<Login>(`/api/providers/oauth/${oauth.id}/start`,{method:"POST",body:"{}"});setLogin(result);})}>{ht("连接账号")}</ConfigButton>}</section>}
    {provider.key_env ? <section className="hermes-provider-auth"><ConfigField label={ht("接口密钥")}><input aria-label={ht("提供商接口密钥")} type="password" autoComplete="new-password" value={key} disabled={busy} placeholder={ht("输入新的密钥，已保存的密钥不会显示")} onChange={e=>setKey(e.target.value)}/></ConfigField><ConfigButton disabled={busy||!key.trim()} onClick={()=>void run(async()=>{await hermesJson("/api/env",{method:"PUT",body:JSON.stringify({key:provider.key_env,value:key.trim()})});setKey("");setNotice(ht("接口密钥已保存"));})}>{ht("保存密钥")}</ConfigButton></section> : !oauth && <ConfigNotice>{ht("这个提供商使用本地服务或专用身份验证，请先在 Hermes 中完成对应的连接配置。")}</ConfigNotice>}
    <ConfigField label={ht("模型")}><input aria-label={ht("模型 ID")} list="hermes-builtin-models" value={model} disabled={busy} onChange={e=>setModel(e.target.value)}/><datalist id="hermes-builtin-models">{provider.models?.map(id=><option key={id} value={id}/>)}</datalist></ConfigField>
    <ConfigButton variant="primary" disabled={busy||modelBusy||!model.trim()||Boolean(key)||Boolean(login)} onClick={()=>void run(async()=>{
      const body={scope:"main",provider:provider.slug,model:model.trim()};
      let result=await hermesJson<{confirm_required?:boolean;confirm_message?:string}>("/api/model/set",{method:"POST",body:JSON.stringify(body)});
      if (result.confirm_required) {if (!window.confirm(result.confirm_message || ht("确认使用这个模型？"))) return;result=await hermesJson("/api/model/set",{method:"POST",body:JSON.stringify({...body,confirm_expensive_model:true})});if(result.confirm_required) throw new Error(ht("模型切换仍需确认，请在 Hermes 中检查。"));}
      onModelChange(model.trim(),provider.slug);setNotice(ht("默认模型已更新"));
    })}>{ht("设为默认模型")}</ConfigButton>{modelBusy && <ConfigNotice>{ht("对话运行时暂不能切换模型。")}</ConfigNotice>}
  </div>;
}
