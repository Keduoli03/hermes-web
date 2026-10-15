"use client";
import { useEffect, useRef, useState } from "react";
import { hermesJson } from "@/lib/hermes-client";

export function useHermesResource<T>(path:string|null,revision=0,load:typeof hermesJson=hermesJson) {
  const [data,setData]=useState<T|null>(null),[error,setError]=useState(""),[loading,setLoading]=useState(true);
  useEffect(()=>{const controller=new AbortController();if(!path){setData(null);setError("");setLoading(false);return;}setLoading(true);setData(null);setError("");load<T>(path,{signal:controller.signal}).then(value=>{if(!controller.signal.aborted)setData(value);}).catch(e=>{if(!controller.signal.aborted)setError(e.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});return()=>controller.abort();},[path,revision,load]);
  return {data,error,loading};
}
export function useHermesOperation(){
  const [busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
  const controllerRef=useRef<AbortController|null>(null);
  useEffect(()=>()=>controllerRef.current?.abort(),[]);
  async function run(action:(signal:AbortSignal)=>Promise<void>){if(controllerRef.current)return;const controller=new AbortController();controllerRef.current=controller;setBusy(true);setError("");setNotice("");try{await action(controller.signal);}catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:String(e));}finally{if(!controller.signal.aborted)setBusy(false);controllerRef.current=null;}}
  return {busy,error,notice,run,setError,setNotice};
}
