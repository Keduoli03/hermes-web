"use client";
import { useEffect, useRef, type RefObject } from "react";
import { ArrowUp, ArrowDown, Copy, RefreshCw, RotateCcw, X, Info } from "lucide-react";
import { useHermesI18n } from "@/hooks/useHermesI18n";
import { formatUsageCount, formatUsageCost } from "@/lib/hermes-usage";
import { listenForStackedDialogEscape } from "@/lib/stacked-dialog";

export type HermesSessionDetail = {id?:string;title?:string;model?:string;cwd?:string;git_branch?:string;source?:string;started_at?:number;last_active?:number;ended_at?:number;message_count?:number;tool_call_count?:number;input_tokens?:number;output_tokens?:number;cache_read_tokens?:number;cache_write_tokens?:number;reasoning_tokens?:number;actual_cost_usd?:number|null;estimated_cost_usd?:number|null;billing_provider?:string;model_config?:string|Record<string,unknown>};
export function HermesSessionUsageButton({detail,open,onClick,buttonRef}:{detail:HermesSessionDetail|null;open:boolean;onClick:()=>void;buttonRef:RefObject<HTMLButtonElement|null>}) {
  const {ht,locale}=useHermesI18n();
  const cost=detail?.actual_cost_usd ?? detail?.estimated_cost_usd;
  const exact=(value:number|undefined)=>value == null ? "—" : value.toLocaleString(locale);
  const tooltip=[ht("会话累计用量"),`${ht("输入令牌")} ${exact(detail?.input_tokens)}`,`${ht("输出令牌")} ${exact(detail?.output_tokens)}`,`${ht("缓存读取")} ${exact(detail?.cache_read_tokens)}`,`${ht(detail?.actual_cost_usd == null ? "估算费用" : "实际费用")} ${cost == null ? "—" : `$${cost.toFixed(4)}`}`].join("\n");
  const hasUsage=detail && [detail.input_tokens,detail.output_tokens,detail.cache_read_tokens,cost].some(value=>value!=null && value>0);
  return <button ref={buttonRef} type="button" className="hermes-usage-button" aria-label={ht("会话信息与用量")} aria-expanded={open} aria-controls="hermes-session-info" title={tooltip} onClick={onClick}>
    {hasUsage ? <>
      <span className="hermes-usage-stat" data-usage="input"><ArrowUp aria-hidden="true"/>{formatUsageCount(detail.input_tokens)}</span>
      <span className="hermes-usage-stat" data-usage="output"><ArrowDown aria-hidden="true"/>{formatUsageCount(detail.output_tokens)}</span>
      {detail.cache_read_tokens!=null && detail.cache_read_tokens>0 && <span className="hermes-usage-stat hermes-usage-cache" data-usage="cache"><RotateCcw aria-hidden="true"/>{formatUsageCount(detail.cache_read_tokens)}</span>}
      {cost!=null && <span className="hermes-usage-cost" data-usage="cost">{detail.actual_cost_usd == null ? "≈" : ""}{formatUsageCost(cost)}</span>}
    </> : <span className="hermes-usage-stat"><Info aria-hidden="true"/><span className="hermes-usage-placeholder">{ht("会话信息")}</span></span>}
  </button>;
}

export function HermesSessionInfo({detail,sessionId,cwd,error,onRefresh,onClose,buttonRef}:{detail:HermesSessionDetail|null;sessionId:string|null;cwd:string|null;error:string;onRefresh:()=>void;onClose:()=>void;buttonRef:RefObject<HTMLButtonElement|null>}) {
  const {ht,locale}=useHermesI18n();
  const panelRef=useRef<HTMLElement>(null);
  useEffect(()=>{
    panelRef.current?.focus({preventScroll:true});
    const closeOnOutside=(event:PointerEvent)=>{
      if(event.target instanceof Node && !panelRef.current?.contains(event.target) && !buttonRef.current?.contains(event.target))onClose();
    };
    document.addEventListener("pointerdown",closeOnOutside);
    const removeEscape=listenForStackedDialogEscape(document,()=>{onClose();buttonRef.current?.focus({preventScroll:true});});
    return()=>{document.removeEventListener("pointerdown",closeOnOutside);removeEscape();};
  },[buttonRef,onClose]);
  const cost=detail?.actual_cost_usd ?? detail?.estimated_cost_usd;
  const rows=[
    [ht("名称"),detail?.title || ht("新会话")],
    [ht("会话 ID"),sessionId || "—"],
    [ht("模型"),detail?.model || "—"],
    [ht("开始时间"),detail?.started_at ? new Date(detail.started_at*1000).toLocaleString(locale):"—"],
    [ht("最近活动"),detail?.last_active ? new Date(detail.last_active*1000).toLocaleString(locale):"—"],
    [ht("项目目录"),detail?.cwd || cwd || "—"],
    [ht("Git 分支"),detail?.git_branch || "—"],
  ];
  const usageRows:[string,number|undefined][]=[
    [ht("输入令牌"),detail?.input_tokens],
    [ht("输出令牌"),detail?.output_tokens],
    [ht("缓存读取"),detail?.cache_read_tokens],
    [ht("缓存写入"),detail?.cache_write_tokens],
    [ht("推理令牌"),detail?.reasoning_tokens],
  ];
  return <section ref={panelRef} id="hermes-session-info" className="hermes-session-info" aria-label={ht("会话信息")} tabIndex={-1}>
    <header><strong>{ht("会话信息")}</strong><div>
      <button type="button" title={ht("刷新")} aria-label={ht("刷新")} onClick={onRefresh}><RefreshCw size={14}/></button>
      <button type="button" title={ht("关闭会话信息")} aria-label={ht("关闭会话信息")} onClick={()=>{onClose();buttonRef.current?.focus({preventScroll:true});}}><X size={14}/></button>
    </div></header>
    {error && <p role="alert">{error}</p>}
    <div className="hermes-session-info-grid">
      <dl>{rows.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd>{[ht("会话 ID"),ht("项目目录")].includes(label) && value!=="—" && <button type="button" title={ht("复制 {name}",{name:label})} aria-label={ht("复制 {name}",{name:label})} onClick={()=>void navigator.clipboard.writeText(value).catch(()=>{})}><Copy size={12}/></button>}</div>)}</dl>
      <div className="hermes-session-usage-details"><h3>{ht("会话累计用量")}</h3><dl>
        {usageRows.map(([label,value])=><div key={label}><dt>{label}</dt><dd title={value?.toLocaleString(locale)}>{formatUsageCount(value)}</dd></div>)}
        <div><dt>{ht(detail?.actual_cost_usd == null ? "估算费用" : "实际费用")}</dt><dd title={cost == null ? undefined : `$${cost.toFixed(4)}`}>{formatUsageCost(cost)}</dd></div>
      </dl><div className="hermes-session-counts"><span>{ht("消息总数")} <b>{formatUsageCount(detail?.message_count)}</b></span><span>{ht("工具调用")} <b>{formatUsageCount(detail?.tool_call_count)}</b></span></div></div>
    </div>
    <p className="hermes-info-note">{ht("累计用量包含本会话的所有请求，不代表当前上下文长度。")}</p>
  </section>;
}
