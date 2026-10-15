"use client";

import { useState } from "react";
import { useHermesI18n } from "@/hooks/useHermesI18n";
import { HermesAdvancedModules } from "./HermesAdvancedModules";
import { HermesManagement } from "./HermesManagement";
import { HermesArtifacts } from "./HermesArtifacts";
import { workspaceViews, type HermesWorkspaceView } from "./HermesActivityRail";

type ToolTab="skills"|"skills-hub"|"mcp"|"tools";
export function HermesWorkspacePage({view,dirty,onDirtyChange,cwd,onCwdChange,messages,sessionId,refreshKey}:{view:Exclude<HermesWorkspaceView,"home">;dirty:boolean;onDirtyChange:(dirty:boolean)=>void;cwd:string|null;onCwdChange:(cwd:string|null)=>Promise<void>;messages:{role:string;text:string}[];sessionId:string|null;refreshKey:number}) {
  const {ht}=useHermesI18n();
  const [tab,setTab]=useState<ToolTab>("skills");
  return <section className="hermes-workspace-page" aria-label={ht(workspaceViews.find(item=>item.id===view)!.label)}>
    {view!=="artifacts" && <header className="hermes-workspace-page-header"><h1>{ht(workspaceViews.find(item=>item.id===view)!.label)}</h1>{view==="tools" && <nav aria-label={ht("技能工具分类")}>{([["skills","已安装技能"],["skills-hub","技能市场"],["mcp","MCP 连接"],["tools","内置工具"]] as const).map(([id,label])=><button type="button" key={id} aria-current={tab===id ? "page":undefined} onClick={()=>{if(tab===id)return;if(dirty && !window.confirm(ht("放弃未保存的修改？")))return;onDirtyChange(false);setTab(id);}}>{ht(label)}</button>)}</nav>}</header>}
    <div className="hermes-workspace-page-body">{view==="tools" ? (tab==="mcp" || tab==="skills-hub" ? <HermesAdvancedModules key={tab} section={tab} onDirtyChange={onDirtyChange}/> : <HermesManagement key={tab} page={tab} onDirtyChange={onDirtyChange}/>) : view==="channels" ? <HermesAdvancedModules section="channels" onDirtyChange={onDirtyChange}/> : view==="cron" ? <HermesManagement page="cron" onDirtyChange={onDirtyChange}/> : <HermesArtifacts cwd={cwd} onCwdChange={onCwdChange} messages={messages} sessionId={sessionId} refreshKey={refreshKey}/>}</div>
  </section>;
}
