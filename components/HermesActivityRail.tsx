"use client";

import { Home, Wrench, MessagesSquare, PanelsTopLeft, Clock3, Settings2, UserRound } from "lucide-react";
import { useHermesI18n } from "@/hooks/useHermesI18n";

export type HermesWorkspaceView = "home" | "tools" | "channels" | "artifacts" | "cron";
export const workspaceViews: {id:HermesWorkspaceView;label:string;icon:typeof Home}[] = [
  {id:"home",label:"首页",icon:Home},
  {id:"tools",label:"技能工具",icon:Wrench},
  {id:"channels",label:"消息平台",icon:MessagesSquare},
  {id:"artifacts",label:"产物",icon:PanelsTopLeft},
  {id:"cron",label:"定时任务",icon:Clock3},
];

export function HermesActivityRail({view,inert,onNavigate,onSettings,onProfiles}:{view:HermesWorkspaceView;inert:boolean;onNavigate:(view:HermesWorkspaceView)=>void;onSettings:()=>void;onProfiles:()=>void}) {
  const {ht}=useHermesI18n();
  return <nav className="hermes-activity-rail" aria-label={ht("主要导航")} inert={inert}>
    <div className="hermes-rail-brand" aria-hidden="true">H</div>
    {workspaceViews.map(({id,label,icon:Icon})=><button key={id} type="button" aria-label={ht(label)} aria-current={view===id ? "page":undefined} onClick={()=>onNavigate(id)}><Icon size={21} strokeWidth={1.7}/><span className="hermes-rail-tooltip">{ht(label)}</span></button>)}
    <button type="button" className="hermes-rail-settings" aria-label={ht("偏好与设置")} onClick={onSettings}><Settings2 size={21} strokeWidth={1.7}/><span className="hermes-rail-tooltip">{ht("设置")}</span></button>
    <button type="button" className="hermes-rail-profiles" aria-label={ht("配置档案")} onClick={onProfiles}><UserRound size={21} strokeWidth={1.7}/><span className="hermes-rail-tooltip">{ht("配置档案")}</span></button>
  </nav>;
}
