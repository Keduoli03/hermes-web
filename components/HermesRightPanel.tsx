"use client";

import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { useHermesI18n } from "@/hooks/useHermesI18n";
import { useResizablePanel } from "@/hooks/useResizablePanel";
import { TabBar, type Tab } from "./TabBar";
import { FileViewer } from "./FileViewer";
import { TerminalPanel } from "./TerminalPanel";
import { newTerminalTab, type TerminalTab } from "./terminal-tab-state";

export type HermesRightPanelHandle = { openFile:(path:string)=>void; openTerminal:(cwd:string)=>void };

export function HermesRightPanel({ref,open,cwd,isMobile,inert,onOpen,onHide,onError,onExpandedChange}:{ref:Ref<HermesRightPanelHandle>;open:boolean;cwd:string|null;isMobile:boolean;inert:boolean;onOpen:()=>void;onHide:()=>void;onError:(message:string)=>void;onExpandedChange:(expanded:boolean)=>void}) {
  const {ht}=useHermesI18n();
  const [files,setFiles]=useState<Tab[]>([]);
  const [terminals,setTerminals]=useState<TerminalTab[]>([]);
  const [active,setActive]=useState("");
  const [expanded,setExpanded]=useState(false);
  const widthRef=useRef(460);
  useEffect(()=>{onExpandedChange(expanded && open && !isMobile);},[expanded,open,isMobile,onExpandedChange]);
  const resize=useResizablePanel({ariaLabel:ht("调整右侧面板宽度"),cssVariable:"--hermes-right-panel-width",defaultWidth:460,getMaxWidth:()=>Math.max(280,window.innerWidth-500),growthDirection:"left",maxWidth:1400,minWidth:280,persistClamp:false,storageKey:"hermes-right-panel-width",widthRef});
  const reclampWidth=resize.reclampWidth;
  const tabs=[...files,...terminals.map(tab=>({id:tab.id,label:ht("终端"),filePath:"",kind:"terminal" as const,closing:Boolean(tab.closing)}))];
  const file=files.find(tab=>tab.id===active);
  useEffect(()=>{if(open && !isMobile)reclampWidth();},[open,isMobile,reclampWidth]);
  useImperativeHandle(ref,()=>({
    openFile(path){const id=`file:${path}`;setFiles(previous=>previous.some(tab=>tab.id===id) ? previous : [...previous,{id,label:path.split(/[\\/]/).at(-1) || path,filePath:path}]);setActive(id);onOpen();},
    openTerminal(directory){const existing=terminals.find(tab=>tab.cwd===directory && !tab.closing);const tab=existing ?? newTerminalTab(directory);if(!existing)setTerminals(previous=>[...previous,tab]);setActive(tab.id);onOpen();},
  }),[terminals,onOpen]);
  function closeTab(id:string){
    const terminal=terminals.find(tab=>tab.id===id);
    if(terminal){setTerminals(previous=>previous.map(tab=>tab.id===id ? {...tab,closing:"close"}:tab));return;}
    setFiles(previous=>previous.filter(tab=>tab.id!==id));
    if(active===id)setActive(tabs.filter(tab=>tab.id!==id).at(-1)?.id ?? "");
  }
  return <>
    {open && !isMobile && !expanded && <div className="hermes-right-panel-resizer" inert={inert} {...resize.separatorProps} aria-controls="hermes-right-panel"/>}
    <div ref={resize.panelRef} id="hermes-right-panel" role="complementary" aria-label={ht("右侧面板")} className={`hermes-right-panel ${expanded && !isMobile ? "is-expanded" : ""}`} hidden={!open} inert={inert || !open}>
      <header><div className="hermes-right-panel-tabs"><TabBar tabs={tabs} activeTabId={active} onSelectTab={setActive} onCloseTab={closeTab}/></div>{!isMobile && <button type="button" aria-label={ht(expanded ? "还原面板宽度" : "展开右侧面板")} onClick={()=>setExpanded(!expanded)}>{expanded ? "↙" : "↗"}</button>}<button type="button" aria-label={ht("隐藏右侧面板")} onClick={()=>{setExpanded(false);onHide();}}>×</button></header>
      <div className="hermes-right-panel-body">
        {file && <FileViewer key={file.id} filePath={file.filePath} cwd={cwd ?? undefined} watchEnabled={open} initialState={file.viewerState} onStateChange={viewerState=>setFiles(previous=>previous.map(tab=>tab.id===file.id ? {...tab,viewerState}:tab))} onOpenFile={path=>{const id=`file:${path}`;setFiles(previous=>previous.some(tab=>tab.id===id) ? previous : [...previous,{id,label:path.split(/[\\/]/).at(-1)||path,filePath:path}]);setActive(id);}}/>}
        {terminals.map(tab=><div key={tab.id} hidden={active!==tab.id} className="hermes-right-terminal"><TerminalPanel tab={tab} active={open && active===tab.id} onRestart={()=>setTerminals(previous=>previous.map(item=>item.id===tab.id ? {...item,closing:"restart"}:item))} onClosed={()=>{
          const replacement=tab.closing === "restart" ? newTerminalTab(tab.cwd) : null;
          setTerminals(previous=>replacement ? previous.map(item=>item.id===tab.id ? replacement:item) : previous.filter(item=>item.id!==tab.id));
          setActive(previous=>previous===tab.id ? replacement?.id ?? tabs.filter(item=>item.id!==tab.id).at(-1)?.id ?? "" : previous);
        }} onCloseError={()=>{setTerminals(previous=>previous.map(item=>item.id===tab.id ? {...item,closing:undefined}:item));onError(ht("关闭终端失败"));}}/></div>)}
        {!active && <div className="hermes-right-panel-empty"><strong>{ht("暂无打开的文件或终端")}</strong><p>{ht("从左侧文件浏览器打开文件，或点击终端按钮。")}</p></div>}
      </div>
    </div>
  </>;
}
