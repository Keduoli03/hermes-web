"use client";
import { useEffect, useState } from "react";
import { useHermesI18n } from "@/hooks/useHermesI18n";
import { useHermesOperation,useHermesResource } from "@/hooks/useHermesResource";
import { hermesJson } from "@/lib/hermes-client";
import { scoped } from "@/lib/hermes-advanced";
import { ConfigButton,ConfigEmptyState,ConfigNotice,ConfigSwitch } from "./SettingsUi";
import { HermesResourceState } from "./HermesResourceState";
import { HermesChannelOnboarding } from "./HermesChannelOnboarding";
type ChannelField={key:string;required:boolean;is_set:boolean;is_password:boolean;is_list?:boolean;value?:string|null;prompt?:string;advanced?:boolean};
type Channel={id:string;name:string;enabled:boolean;state:string;configured:boolean;error_message?:string;docs_url?:string;env_vars:ChannelField[]};
const stateNames:Record<string,string>={disabled:"已关闭",not_configured:"未配置",pending_restart:"等待重启",gateway_stopped:"网关未运行",startup_failed:"启动失败",connected:"已连接",running:"运行中",ready:"已就绪",error:"连接异常",fatal:"启动失败",connecting:"连接中",disconnected:"连接已断开"};
function fieldName(key:string){
  const special:Record<string,string>={EMAIL_ADDRESS:"邮箱地址",EMAIL_AUTHSERV_ID:"邮件认证服务标识",WHATSAPP_ENABLED:"启用连接",WHATSAPP_DM_POLICY:"私聊访问策略",FEISHU_DOMAIN:"服务区域",GOOGLE_CHAT_SERVICE_ACCOUNT_JSON:"服务账号凭据",GOOGLE_CHAT_HTTP_EVENTS_AUDIENCE:"事件接收方",GOOGLE_CHAT_HTTP_EVENTS_SERVICE_ACCOUNT_EMAIL:"事件服务账号邮箱",GOOGLE_CHAT_PROJECT_ID:"项目标识",GOOGLE_CHAT_SUBSCRIPTION_NAME:"订阅名称",QQ_SANDBOX:"沙箱环境",API_SERVER_ENABLED:"启用接口服务",API_SERVER_MODEL_NAME:"对外模型名称",WEBHOOK_ENABLED:"启用回调服务",A2A_AGENT_NAME:"智能体名称",A2A_PEER_TOKENS:"对端访问令牌",BUZZ_AUTH_TAG:"认证标签",BUZZ_CHANNELS:"频道列表",BUZZ_CLI_PATH:"客户端程序路径",BUZZ_CREDENTIALS_FILE:"凭据文件路径",BUZZ_POLL_INTERVAL:"轮询间隔",BUZZ_REPLY_IN_THREAD:"在线程中回复",BUZZ_TRANSPORT:"传输方式",PHOTON_PROJECT_ID:"项目标识",PHOTON_PROJECT_SECRET:"项目密钥",PHOTON_MARKDOWN:"消息格式",PHOTON_MENTION_PATTERNS:"提及匹配规则",PHOTON_NODE_BIN:"Node 程序路径",PHOTON_REACTIONS:"消息回应",PHOTON_READ_RECEIPTS:"已读回执",PHOTON_SIDECAR_AUTOSTART:"辅助服务自动启动",PHOTON_TELEMETRY:"运行统计",IRC_SERVER:"服务器地址",IRC_CHANNEL:"频道名称",IRC_NICKNAME:"昵称",IRC_NICKSERV_PASSWORD:"昵称服务密码",IRC_SERVER_PASSWORD:"服务器密码",IRC_USE_TLS:"启用加密连接",LINE_SLOW_RESPONSE_THRESHOLD:"慢响应阈值",TEAMS_TENANT_ID:"租户标识",NTFY_TOPIC:"订阅主题",NTFY_PUBLISH_TOPIC:"发布主题",NTFY_MARKDOWN:"消息格式",RAFT_PROFILE:"运行档案",SIMPLEX_AUTO_ACCEPT:"自动接受连接",SIMPLEX_GROUP_ALLOWED:"允许的群组"};
  if(special[key])return special[key];
  if(/ALLOWED/.test(key))return "允许访问的用户或群组";
  if(/BASE_URL|API_URL/.test(key))return "服务接口地址";
  if(/BOT_TOKEN/.test(key))return "机器人令牌";
  if(/APP_TOKEN/.test(key))return "应用令牌";
  if(/APP_ID|CLIENT_ID/.test(key))return "应用标识";
  if(/APP_SECRET|CLIENT_SECRET|CORP_SECRET/.test(key))return "应用密钥";
  if(/AES|ENCRYPT/.test(key))return "消息加密密钥";
  if(/VERIFICATION/.test(key))return "消息验证令牌";
  if(/SECRET|AUTH_TOKEN/.test(key))return "连接密钥";
  if(/TOKEN/.test(key))return "访问令牌";
  if(/CORP_ID/.test(key))return "企业标识";
  if(/AGENT_ID/.test(key))return "应用编号";
  if(/PORT/.test(key))return "服务端口";
  if(/IMAP_HOST/.test(key))return "收件服务器";
  if(/SMTP_HOST/.test(key))return "发件服务器";
  if(/PASSWORD|PASS/.test(key))return "登录密码";
  if(/USER|ACCOUNT|EMAIL/.test(key))return "登录账号";
  if(/PHONE|NUMBER/.test(key))return "电话号码";
  if(/MODE/.test(key))return "连接模式";
  if(/URL|HOST/.test(key))return "服务地址";
  if(/KEY/.test(key))return "接口密钥";
  if(/BOT_ID/.test(key))return "机器人标识";
  return "连接参数";
}
const platformNames:Record<string,string>={weixin:"微信（个人）",wechat:"微信（个人）",wecom:"企业微信",wecom_bot:"企业微信（群机器人）",wecom_app:"企业微信（应用）",feishu:"飞书",dingtalk:"钉钉",email:"电子邮件",sms:"短信",qq:"QQ 机器人",qqbot:"QQ 机器人",yuanbao:"元宝",api_server:"接口服务",webhook:"消息回调",webhooks:"消息回调"};
const platformColors:Record<string,string>={telegram:"#229ed9",discord:"#5865f2",slack:"#7c3a78",weixin:"#07b75b",wechat:"#07b75b",whatsapp:"#16ad65",feishu:"#3370ff",email:"#db4437",qq:"#eb3349"};
function platformName(row:Channel){return platformNames[row.id] || row.name;}
function channelTone(row:Channel){return !row.enabled ? "disabled" : ["connected","running","ready"].includes(row.state) ? "connected" : "attention";}
function PlatformIcon({row}:{row:Channel}){
  const color=platformColors[row.id] || "#718096";
  return <span className="hermes-channel-icon" style={{color,backgroundColor:`${color}18`}} aria-hidden="true">{row.id==="telegram" ? <svg viewBox="0 0 24 24" fill="currentColor"><path d="m21 3-3.3 17-5.3-4.1-2.9 2.8.5-5.3L18 6l-10 6-5-1.6L21 3Z"/></svg> : ["wechat","weixin","whatsapp"].includes(row.id) ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M20 11a8 8 0 0 1-8 8H6l-3 2 1-5a8 8 0 1 1 16-5Z"/><circle cx="9" cy="10" r=".8" fill="currentColor"/><circle cx="15" cy="10" r=".8" fill="currentColor"/></svg> : row.id==="email" ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 6 9 7 9-7"/></svg> : <span>{platformName(row).slice(0,1).toUpperCase()}</span>}</span>;
}
export function HermesChannels({profile,onDirtyChange}:{profile:string;onDirtyChange:(dirty:boolean)=>void}){
  const {ht}=useHermesI18n();const op=useHermesOperation();
  const [revision,setRevision]=useState(0),[selected,setSelected]=useState(""),[enabled,setEnabled]=useState(false),[values,setValues]=useState<Record<string,string>>({}),[clear,setClear]=useState<string[]>([]);
  const [query,setQuery]=useState(""),[filter,setFilter]=useState("all");
  const [onboarding,setOnboarding]=useState(false);
  const resource=useHermesResource<{platforms:Channel[];gateway_start_command:string}>(scoped("/api/messaging/platforms",profile),revision);
  const row=resource.data?.platforms.find(item=>item.id===selected);
  const configDirty=Boolean(row && (enabled!==row.enabled || Object.keys(values).length || clear.length));
  const dirty=configDirty || onboarding;
  useEffect(()=>{onDirtyChange(dirty || op.busy);},[dirty,op.busy,onDirtyChange]);
  function choose(item:Channel){if(op.busy || dirty && !window.confirm(ht("放弃未保存的修改？")))return;setSelected(item.id);setEnabled(item.enabled);setValues({});setClear([]);op.setNotice("");}
  const platforms=resource.data?.platforms.filter(item=>(filter==="all" || channelTone(item)===filter) && `${platformName(item)} ${item.name} ${item.id}`.toLowerCase().includes(query.toLowerCase().trim())) ?? [];
  function fieldView(field:ChannelField){
    if(!row)return null;
    const peers=row.env_vars.filter(other=>fieldName(other.key)===fieldName(field.key));
    const label=`${ht(fieldName(field.key))}${peers.length>1 ? ` ${peers.indexOf(field)+1}`:""}`;
    const removing=clear.includes(field.key),value=values[field.key] ?? (field.is_list ? field.value ?? "" : "");
    const placeholder=removing ? ht("保存后清除") : field.is_set ? ht("留空保留已保存的值") : ht("请输入{label}",{label});
    const inputProps={"aria-label":label,value,disabled:op.busy || removing,onChange:(e:React.ChangeEvent<HTMLInputElement|HTMLSelectElement>)=>setValues(old=>({...old,[field.key]:e.target.value}))};
    return <div className="hermes-channel-field" key={field.key}><div className="hermes-channel-field-label"><strong>{label}</strong>{field.is_set && <small className={removing ? "is-clearing" : ""}>{ht(removing ? "待清除" : "已保存")}</small>}</div><p>{field.is_list ? ht("填写用户或群组标识，多个标识用逗号分隔。") : field.is_password ? ht("用于验证平台连接；保存后不会显示完整凭据。") : /PORT$/.test(field.key) ? ht("平台服务使用的监听端口。") : /URL|HOST/.test(field.key) ? ht("填写该平台的服务地址。") : ht("从平台的应用或机器人设置中获取。")}</p><div className="hermes-channel-input-row">{field.key==="WHATSAPP_MODE" ? <select {...inputProps}><option value="">{ht("保持当前模式")}</option><option value="bot">{ht("机器人模式")}</option><option value="self-chat">{ht("与自己聊天")}</option></select> : ["WHATSAPP_ENABLED","API_SERVER_ENABLED","WEBHOOK_ENABLED","QQ_SANDBOX","IRC_USE_TLS"].includes(field.key) ? <select {...inputProps}><option value="">{ht("保持当前设置")}</option><option value="true">{ht("启用")}</option><option value="false">{ht("关闭")}</option></select> : <input {...inputProps} placeholder={placeholder} type={field.is_password ? "password" : /PORT$/.test(field.key) ? "number" : "text"} autoComplete="off"/>}{field.is_set && <button className="hermes-channel-clear" type="button" disabled={op.busy} aria-label={ht(removing ? "撤销清除{label}" : "清除{label}",{label})} title={ht(removing ? "撤销清除" : "清除已保存的此项")} onClick={()=>setClear(old=>removing ? old.filter(key=>key!==field.key):[...old,field.key])}>{removing ? <span aria-hidden="true">↶</span> : <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7"/></svg>}</button>}</div></div>;
  }
  function group(title:string,fields:ChannelField[]){return fields.length>0 && <section className="hermes-channel-group"><h3>{ht(title)}</h3>{fields.map(fieldView)}</section>;}
  if(!resource.data && (resource.loading || resource.error))return <HermesResourceState loading={resource.loading} error={resource.error} onRetry={()=>setRevision(v=>v+1)}/>;
  return <div className="hermes-module-content hermes-channels">
    <div className="hermes-channels-toolbar"><div className="hermes-channel-search"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/></svg><input aria-label={ht("搜索消息平台")} placeholder={ht("搜索消息平台…")} value={query} onChange={e=>setQuery(e.target.value)}/></div><div className="hermes-channel-filters" aria-label={ht("渠道状态筛选")}>{[["all","全部"],["attention","需要关注"],["connected","已连接"],["disabled","未启用"]].map(([key,label])=><button type="button" key={key} aria-pressed={filter===key} onClick={()=>setFilter(key)}>{ht(label)}</button>)}</div><ConfigButton disabled={op.busy || dirty} onClick={()=>setRevision(v=>v+1)}>{ht("刷新")}</ConfigButton></div>
    <div className="hermes-channels-layout"><aside className="hermes-channel-list" aria-label={ht("消息平台")}>{platforms.map(item=><button type="button" key={item.id} aria-current={item.id===selected ? "page":undefined} onClick={()=>choose(item)}><PlatformIcon row={item}/><span className="hermes-channel-name">{ht(platformName(item))}</span><span className={`hermes-channel-dot is-${channelTone(item)}`} role="img" aria-label={ht(stateNames[item.state] || "状态未知")}/></button>)}{!platforms.length && <p>{ht(resource.loading ? "正在读取消息渠道…" : "没有匹配的消息平台")}</p>}</aside>
    <div className="hermes-channel-detail">{row ? <><div className="hermes-channel-scroll"><div className="hermes-channel-body"><header className="hermes-channel-heading"><PlatformIcon row={row}/><h2>{ht(platformName(row))}</h2><span className={`hermes-channel-badge is-${channelTone(row)}`}><span className={`hermes-channel-dot is-${channelTone(row)}`}/>{ht(stateNames[row.state] || "状态未知")}</span></header><p className="hermes-channel-intro">{ht("连接此平台，让 Hermes 接收和回复消息。先在平台创建应用或机器人，再填写连接凭据。")}</p>{row.docs_url && /^https:\/\//.test(row.docs_url) && <a className="hermes-channel-guide" href={row.docs_url} target="_blank" rel="noopener noreferrer">{ht("打开官方设置指南")} ↗</a>}
    {(op.error || resource.error) && <div role="alert"><ConfigNotice>{op.error || resource.error}</ConfigNotice></div>}{op.notice && <div role="status"><ConfigNotice>{op.notice}</ConfigNotice></div>}{row.error_message && <ConfigNotice>{row.error_message}</ConfigNotice>}
    {(row.id === "telegram" || row.id === "whatsapp") && <HermesChannelOnboarding key={row.id} platform={row.id} profile={profile} disabled={configDirty || op.busy} onPending={setOnboarding} onSaved={()=>{setSelected("");setRevision(v=>v+1);}}/>}
    {group("必填凭据",row.env_vars.filter(field=>field.required))}{group("访问名单",row.env_vars.filter(field=>!field.required && field.is_list))}{group("可选配置",row.env_vars.filter(field=>!field.required && !field.is_list && !field.advanced))}{row.env_vars.some(field=>field.advanced && !field.required && !field.is_list) && <details className="hermes-channel-advanced"><summary>{ht("高级选项")}</summary>{row.env_vars.filter(field=>field.advanced && !field.required && !field.is_list).map(fieldView)}</details>}
    </div></div><footer className="hermes-channel-footer"><label><ConfigSwitch label={ht("启用渠道")} checked={enabled} disabled={op.busy} onChange={setEnabled}/><span>{ht(enabled ? "已启用" : "未启用")}</span></label><div><ConfigButton disabled={op.busy || dirty} onClick={()=>void op.run(async signal=>{const result=await hermesJson<{ok:boolean;message?:string}>(scoped(`/api/messaging/platforms/${row.id}/test`,profile),{method:"POST",signal,body:"{}"});if(!result.ok)throw new Error(result.message || ht("渠道连接检测未通过"));op.setNotice(ht("渠道连接检测通过"));})}>{ht("测试连接")}</ConfigButton><ConfigButton variant="primary" disabled={op.busy || !dirty} onClick={()=>void op.run(async signal=>{const env=Object.fromEntries(Object.entries(values).filter(([key,value])=>value!=="" && !clear.includes(key)));const result=await hermesJson<{hot_served:boolean}>(scoped(`/api/messaging/platforms/${row.id}`,profile),{method:"PUT",signal,body:JSON.stringify({enabled,env,clear_env:clear})});setValues({});setClear([]);setRevision(v=>v+1);op.setNotice(result.hot_served ? ht("渠道已保存并加载") : ht("渠道已保存，需要启动或重启网关后生效。"));})}>{ht("保存渠道")}</ConfigButton></div></footer></> : <ConfigEmptyState>{ht("选择左侧消息平台，查看连接状态并配置。")}{(op.error || resource.error) && <ConfigNotice>{op.error || resource.error}</ConfigNotice>}</ConfigEmptyState>}</div></div>
  </div>;
}
