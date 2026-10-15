"use client";
import { useEffect, useState } from "react";
import { HermesSkillsHub } from "./HermesSkillsHub";
import { HermesChannels } from "./HermesChannels";
import { HermesProfiles } from "./HermesProfiles";
import { HermesMcp } from "./HermesMcp";
import { HermesPlugins } from "./HermesPlugins";
import { HermesPairing } from "./HermesPairing";
import { HermesWebhooks } from "./HermesWebhooks";
import { HermesAgents } from "./HermesAgents";

export type AdvancedSection="skills-hub"|"channels"|"profiles"|"mcp"|"plugins"|"pairing"|"webhooks"|"agents";
export type ProfileInfo={name:string;display_name?:string;description?:string;model?:string;provider?:string;is_default?:boolean;skill_count?:number;gateway_running?:boolean};
export function HermesAdvancedModules({section,onDirtyChange}:{section:AdvancedSection;onDirtyChange:(dirty:boolean)=>void}){
  const [dirty,setDirty]=useState(false);
  useEffect(()=>{onDirtyChange(dirty);},[dirty,onDirtyChange]);
  useEffect(()=>{if(!dirty)return;const guard=(event:BeforeUnloadEvent)=>{event.preventDefault();};window.addEventListener("beforeunload",guard);return()=>window.removeEventListener("beforeunload",guard);},[dirty]);
  const props={profile:"",onDirtyChange:setDirty};
  return <div className="hermes-advanced-module">{section==="plugins" ? <HermesPlugins onDirtyChange={setDirty}/> : section==="pairing" ? <HermesPairing/> : section==="webhooks" ? <HermesWebhooks onDirtyChange={setDirty}/> : section==="agents" ? <HermesAgents onDirtyChange={setDirty}/> : section==="skills-hub" ? <HermesSkillsHub {...props}/> : section==="channels" ? <HermesChannels {...props}/> : section==="mcp" ? <HermesMcp {...props}/> : <HermesProfiles onDirtyChange={setDirty}/>}</div>;
}
