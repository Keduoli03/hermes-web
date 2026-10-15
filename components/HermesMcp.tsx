"use client";
import { useEffect, useState, useRef } from "react";
import { Plug, Search, Plus, RefreshCw, BookOpen, X, Server as ServerIcon } from "lucide-react";
import { useHermesI18n } from "@/hooks/useHermesI18n";
import {
  useHermesOperation,
  useHermesResource,
} from "@/hooks/useHermesResource";
import { hermesJson } from "@/lib/hermes-client";
import { envPairs, scoped, waitHermesAction } from "@/lib/hermes-advanced";
import { HermesResourceState } from "./HermesResourceState";
import {
  ConfigButton,
  ConfigDetail,
  ConfigDetailTitle,
  ConfigEmptyState,
  ConfigField,
  ConfigNotice,
  ConfigSidebar,
  ConfigSidebarItem,
  ConfigSidebarList,
  ConfigSplitView,
  ConfigSwitch,
} from "./SettingsUi";
type Server = {
  name: string;
  transport: string;
  command?: string;
  url?: string;
  args?: string[];
  enabled: boolean;
  auth?: string;
  source?: string;
  plugin?: string;
};
type Entry = {
  name: string;
  description: string;
  installed: boolean;
  required_env: { name: string; prompt: string; required: boolean }[];
  command?: string;
  args?: string[];
  url?: string;
  bootstrap?: string[];
  needs_install: boolean;
};
function catalogFieldLabel(name: string) {
  return /TOKEN/.test(name)
    ? "访问令牌"
    : /SECRET/.test(name)
      ? "连接密钥"
      : /KEY/.test(name)
        ? "接口密钥"
        : /URL|HOST/.test(name)
          ? "服务地址"
          : "连接参数";
}
type Flow = {
  flow_id: string;
  status: string;
  authorization_url?: string;
  error?: string;
};
const empty = {
  name: "",
  transport: "http",
  url: "",
  command: "",
  args: "[]",
  env: "",
  auth: "none",
  token: "",
};
export function HermesMcp({
  profile,
  onDirtyChange,
}: {
  profile: string;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const { ht } = useHermesI18n();
  const [query,setQuery]=useState("");
  const op = useHermesOperation();
  const [revision, setRevision] = useState(0),
    [selected, setSelected] = useState(""),
    [draft, setDraft] = useState(empty),
    [baseline, setBaseline] = useState(JSON.stringify(empty)),
    [catalogOpen, setCatalogOpen] = useState(false),
    [catalogEnv, setCatalogEnv] = useState<Record<string, string>>({}),
    [flow, setFlow] = useState<Flow | null>(null),
    [tools, setTools] = useState<{ name: string; description?: string }[]>([]);
  const flowRef = useRef<Flow | null>(null);
  useEffect(() => {
    flowRef.current = flow;
  }, [flow]);
  useEffect(
    () => () => {
      if (flowRef.current)
        void hermesJson(
          `/api/mcp/oauth/flows/${encodeURIComponent(flowRef.current.flow_id)}`,
          { method: "DELETE" },
        ).catch(() => {});
    },
    [],
  );
  const setOperationError = op.setError,
    setOperationNotice = op.setNotice;
  const servers = useHermesResource<{ servers: Server[] }>(
    scoped("/api/mcp/servers", profile),
    revision,
  );
  const catalog = useHermesResource<{ entries: Entry[] }>(
    catalogOpen ? scoped("/api/mcp/catalog", profile) : null,
    revision,
  );
  const row = servers.data?.servers.find((item) => item.name === selected),
    entry = catalog.data?.entries.find(
      (item) => `catalog:${item.name}` === selected,
    );
  const dirty =
    JSON.stringify(draft) !== baseline || Object.keys(catalogEnv).length > 0;
  useEffect(() => {
    onDirtyChange(dirty || op.busy || Boolean(flow));
  }, [dirty, op.busy, flow, onDirtyChange]);
  useEffect(() => {
    if (!flow) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const data = await hermesJson<Flow>(
          `/api/mcp/oauth/flows/${encodeURIComponent(flow!.flow_id)}`,
          { signal: controller.signal },
        );
        if (controller.signal.aborted) return;
        if (data.status === "approved") {
          setFlow(null);
          setOperationNotice(ht("MCP 授权完成"));
          setRevision((v) => v + 1);
        } else if (data.status === "error") {
          setFlow(null);
          setOperationError(data.error || ht("MCP 授权失败"));
        } else {
          setFlow(data);
          timer = setTimeout(poll, 2000);
        }
      } catch (e) {
        if (!controller.signal.aborted) {
          setFlow(null);
          setOperationError(e instanceof Error ? e.message : String(e));
        }
      }
    }
    timer = setTimeout(poll, 2000);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [flow, setOperationError, setOperationNotice, ht]);
  function choose(name: string) {
    if (op.busy || flow || (dirty && !window.confirm(ht("放弃未保存的修改？"))))
      return false;
    const item = servers.data?.servers.find((s) => s.name === name);
    const next = item
      ? {
          ...empty,
          name: item.name,
          transport: item.transport,
          url: item.url ?? "",
          command: item.command ?? "",
          args: JSON.stringify(item.args ?? []),
          auth: item.auth || "none",
        }
      : { ...empty };
    setDraft(next);
    setBaseline(JSON.stringify(next));
    setSelected(name);
    setCatalogEnv({});
    setTools([]);
    op.setNotice("");
    return true;
  }
  const change = (key: keyof typeof empty, value: string) =>
    setDraft((old) => ({ ...old, [key]: value }));
  function payload() {
    const args: unknown = JSON.parse(draft.args);
    if (
      !Array.isArray(args) ||
      !args.every((value) => typeof value === "string")
    )
      throw new Error(ht("启动参数必须为字符串数组。"));
    return draft.transport === "http"
      ? {
          name: draft.name.trim(),
          url: draft.url,
          auth: draft.auth,
          ...(draft.auth === "header" ? { bearer_token: draft.token } : {}),
        }
      : {
          name: draft.name.trim(),
          command: draft.command,
          args,
          env: envPairs(draft.env),
        };
  }
  const activeResource = catalogOpen ? catalog : servers;
  if (!dirty && !op.busy && !flow && !activeResource.data && (activeResource.loading || activeResource.error)) {
    return <HermesResourceState loading={activeResource.loading} error={activeResource.error} onRetry={() => setRevision(v => v + 1)} />;
  }
  return (
    <div className="hermes-module-content hermes-mcp">
      <div className="hermes-mcp-toolbar"><nav aria-label={ht("MCP 列表分类")}><button type="button" aria-pressed={!catalogOpen} disabled={op.busy || dirty || Boolean(flow)} onClick={()=>{if(choose(""))setCatalogOpen(false);}}><ServerIcon size={16}/>{ht("已添加服务器")}</button><button type="button" aria-pressed={catalogOpen} disabled={op.busy || dirty || Boolean(flow)} onClick={()=>{if(choose(""))setCatalogOpen(true);}}><BookOpen size={16}/>{ht("官方 MCP 目录")}</button></nav><ConfigButton disabled={op.busy || Boolean(flow)} onClick={()=>{if(choose("new"))setCatalogOpen(false);}}><Plus size={16}/>{ht("添加 MCP 服务器")}</ConfigButton><button className="hermes-mcp-refresh" type="button" aria-label={ht("刷新 MCP 列表")} title={ht("刷新 MCP 列表")} disabled={op.busy || dirty || Boolean(flow)} onClick={()=>setRevision(v=>v+1)}><RefreshCw size={16}/></button></div>
      {(op.error || activeResource.error) && (
        <div role="alert">
          <ConfigNotice>
            {op.error || activeResource.error}
          </ConfigNotice>
        </div>
      )}
      {op.notice && (
        <div role="status">
          <ConfigNotice>{op.notice}</ConfigNotice>
        </div>
      )}
      <ConfigSplitView>
        <ConfigSidebar>
          <label className="hermes-mcp-search"><Search size={15}/><input aria-label={ht("搜索 MCP 服务器")} placeholder={ht("搜索服务器…")} value={query} onChange={event=>setQuery(event.target.value)}/></label>
          <div className="hermes-mcp-list-heading">{ht(catalogOpen ? "可安装的连接" : "我的服务器")}</div>
          {!catalogOpen &&
          <ConfigSidebarList>
            {servers.data?.servers.filter(item=>item.name.toLowerCase().includes(query.toLowerCase())).map((item) => (
              <ConfigSidebarItem
                key={item.name}
                active={selected === item.name}
                onClick={() => choose(item.name)}
              >
                <span className="hermes-mcp-list-icon"><Plug size={17}/></span><span className="hermes-mcp-list-name"><strong>{item.name}</strong><small>{ht(item.transport==="http" ? "远程服务" : "本地程序")}</small></span><span className={`hermes-channel-dot ${item.enabled ? "is-connected":"is-disabled"}`} role="img" aria-label={ht(item.enabled ? "已启用" : "已关闭")}/>
              </ConfigSidebarItem>
            ))}
          </ConfigSidebarList>}
          {catalogOpen && (
            <ConfigSidebarList>
              {catalog.data?.entries.filter(item=>`${item.name} ${item.description}`.toLowerCase().includes(query.toLowerCase())).map((item) => (
                <ConfigSidebarItem
                  key={item.name}
                  active={selected === `catalog:${item.name}`}
                  onClick={() => choose(`catalog:${item.name}`)}
                >
                  <span className="hermes-mcp-list-icon"><Plug size={17}/></span><span className="hermes-mcp-list-name"><strong>{item.name}</strong><small>{ht(item.installed ? "已安装" : "可安装")}</small></span>
                </ConfigSidebarItem>
              ))}
            </ConfigSidebarList>
          )}
        </ConfigSidebar>
        <ConfigDetail>
          {entry ? (
            <div className="hermes-form">
              <div className="hermes-mcp-heading"><span><Plug size={22}/></span><div><ConfigDetailTitle>{entry.name}</ConfigDetailTitle><p>{ht("官方目录")}</p></div></div>
              <p>{entry.description}</p>
              <p>{ht("安装将使用以下连接和启动配置。")}</p>
              <pre className="hermes-module-code">
                {entry.url || [entry.command, ...(entry.args ?? [])].join(" ")}
                {entry.bootstrap?.length
                  ? `\n${entry.bootstrap.join("\n")}`
                  : ""}
              </pre>
              {entry.required_env.map((field) => (
                <ConfigField
                  label={`${ht(catalogFieldLabel(field.name))}${entry.required_env.length > 1 ? ` ${entry.required_env.indexOf(field) + 1}` : ""}`}
                  key={field.name}
                >
                  <input
                    aria-label={`${ht(catalogFieldLabel(field.name))}${entry.required_env.length > 1 ? ` ${entry.required_env.indexOf(field) + 1}` : ""}`}
                    type="password"
                    autoComplete="new-password"
                    value={catalogEnv[field.name] ?? ""}
                    disabled={op.busy}
                    onChange={(e) =>
                      setCatalogEnv((old) => ({
                        ...old,
                        [field.name]: e.target.value,
                      }))
                    }
                  />
                </ConfigField>
              ))}
              <ConfigButton
                variant="primary"
                disabled={
                  op.busy ||
                  entry.installed ||
                  entry.required_env.some(
                    (field) =>
                      field.required && !catalogEnv[field.name]?.trim(),
                  )
                }
                onClick={() =>
                  void op.run(async (signal) => {
                    const result = await hermesJson<{
                      background: boolean;
                      action?: string;
                    }>(scoped("/api/mcp/catalog/install", profile), {
                      method: "POST",
                      signal,
                      body: JSON.stringify({
                        name: entry.name,
                        env: catalogEnv,
                        enable: true,
                      }),
                    });
                    if (result.background && result.action) {
                      op.setNotice(ht("任务已启动，正在等待结果…"));
                      const state = await hermesJson<{ pid: number }>(
                        `/api/actions/${encodeURIComponent(result.action)}/status?lines=0`,
                        { signal },
                      );
                      await waitHermesAction(
                        { name: result.action, pid: state.pid },
                        signal,
                      );
                    }
                    setCatalogEnv({});
                    setRevision((v) => v + 1);
                    op.setNotice(ht("MCP 安装完成"));
                  })
                }
              >
                {entry.installed ? ht("已安装") : ht("安装并启用")}
              </ConfigButton>
            </div>
          ) : selected && (selected === "new" || row) ? (
            <div className="hermes-form">
              <div className="hermes-mcp-heading"><span><Plug size={22}/></span><div><ConfigDetailTitle>
                {selected === "new" ? ht("添加 MCP 服务器") : row?.name}
              </ConfigDetailTitle><p>{ht(selected === "new" ? "连接远程服务或本地程序，为 Hermes 添加工具。" : "管理连接地址、身份验证和可用工具。")}</p></div></div>
              {row?.plugin && (
                <ConfigNotice>
                  {ht("由插件提供，请在对应插件中管理。")}
                </ConfigNotice>
              )}
              {row && (
                <div className="hermes-preference-row">
                  <div>
                    <strong>{ht("启用服务器")}</strong>
                    <p>{ht("允许 Hermes 使用这个服务器提供的工具。")}</p>
                  </div>
                  <ConfigSwitch
                    label={ht("启用服务器")}
                    checked={row.enabled}
                    disabled={
                      op.busy ||
                      dirty ||
                      row.source === "plugin" ||
                      Boolean(flow)
                    }
                    onChange={(enabled) =>
                      void op.run(async (signal) => {
                        await hermesJson(
                          scoped(
                            `/api/mcp/servers/${encodeURIComponent(row.name)}/enabled`,
                            profile,
                          ),
                          {
                            method: "PUT",
                            signal,
                            body: JSON.stringify({ enabled }),
                          },
                        );
                        setRevision((v) => v + 1);
                      })
                    }
                  />
                </div>
              )}
              <ConfigField label={<div>{ht("服务器名称")}<p>{ht("给这个连接起一个容易辨认的名称。")}</p></div>}>
                <input
                  aria-label={ht("MCP 服务器名称")}
                  value={draft.name}
                  disabled={op.busy || Boolean(row)}
                  onChange={(e) => change("name", e.target.value)}
                />
              </ConfigField>
              <ConfigField label={ht("连接方式")}>
                <select
                  aria-label={ht("MCP 连接方式")}
                  value={draft.transport}
                  disabled={op.busy || Boolean(row)}
                  onChange={(e) => change("transport", e.target.value)}
                >
                  <option value="http">{ht("远程 HTTP 服务")}</option>
                  <option value="stdio">{ht("本地程序")}</option>
                </select>
              </ConfigField>
              {draft.transport === "http" ? (
                <>
                  <ConfigField label={ht("服务地址")}>
                    <input
                      aria-label={ht("MCP 服务地址")}
                      type="url"
                      value={draft.url}
                      disabled={op.busy || row?.source === "plugin"}
                      onChange={(e) => change("url", e.target.value)}
                    />
                  </ConfigField>
                  <ConfigField label={ht("身份验证")}>
                    <select
                      aria-label={ht("MCP 身份验证")}
                      value={draft.auth}
                      disabled={op.busy || Boolean(row)}
                      onChange={(e) => change("auth", e.target.value)}
                    >
                      <option value="none">{ht("无需验证")}</option>
                      <option value="oauth">{ht("账号授权")}</option>
                      <option value="header">{ht("访问令牌")}</option>
                    </select>
                  </ConfigField>
                  {draft.auth === "header" && !row && (
                    <ConfigField label={ht("访问令牌")}>
                      <input
                        aria-label={ht("MCP 访问令牌")}
                        type="password"
                        autoComplete="new-password"
                        value={draft.token}
                        disabled={op.busy}
                        onChange={(e) => change("token", e.target.value)}
                      />
                    </ConfigField>
                  )}
                </>
              ) : (
                <>
                  <ConfigField label={ht("启动命令")}>
                    <input
                      aria-label={ht("MCP 启动命令")}
                      value={draft.command}
                      disabled={op.busy || row?.source === "plugin"}
                      onChange={(e) => change("command", e.target.value)}
                    />
                  </ConfigField>
                  <ConfigField label={ht("启动参数")}>
                    <div className="hermes-mcp-args">{(JSON.parse(draft.args) as string[]).map((argument,index)=><div key={index}><input aria-label={ht("启动参数 {index}",{index:index+1})} value={argument} disabled={op.busy || row?.source==="plugin"} onChange={event=>change("args",JSON.stringify((JSON.parse(draft.args) as string[]).map((item,position)=>position===index?event.target.value:item)))}/><button className="hermes-mcp-refresh" type="button" aria-label={ht("移除启动参数 {index}",{index:index+1})} title={ht("移除参数")} disabled={op.busy || row?.source==="plugin"} onClick={()=>change("args",JSON.stringify((JSON.parse(draft.args) as string[]).filter((_,position)=>position!==index)))}><X size={16}/></button></div>)}<ConfigButton disabled={op.busy || row?.source==="plugin"} onClick={()=>change("args",JSON.stringify([...JSON.parse(draft.args),""]))}><Plus size={15}/>{ht("添加参数")}</ConfigButton></div>
                  </ConfigField>
                  <ConfigField label={ht("新增环境变量")}>
                    <textarea
                      aria-label={ht("MCP 新增环境变量")}
                      rows={3}
                      value={draft.env}
                      disabled={op.busy || row?.source === "plugin"}
                      onChange={(e) => change("env", e.target.value)}
                    />
                  </ConfigField>
                  <p>{ht("每行一个 NAME=VALUE；已保存的变量会保留。")}</p>
                </>
              )}
              <div className="hermes-module-actions">
                <ConfigButton
                  variant="primary"
                  disabled={
                    op.busy ||
                    !dirty ||
                    !draft.name.trim() ||
                    row?.source === "plugin" ||
                    Boolean(flow)
                  }
                  onClick={() =>
                    void op.run(async (signal) => {
                      const value = payload();
                      if (row) {
                        const patch =
                          draft.transport === "http"
                            ? { url: draft.url }
                            : {
                                command: draft.command,
                                args: "args" in value ? value.args : [],
                                ...("env" in value &&
                                Object.keys(value.env ?? {}).length
                                  ? { env: value.env }
                                  : {}),
                              };
                        await hermesJson(scoped("/api/config", profile), {
                          method: "PUT",
                          signal,
                          body: JSON.stringify({
                            config: { mcp_servers: { [row.name]: patch } },
                          }),
                        });
                      } else
                        await hermesJson(scoped("/api/mcp/servers", profile), {
                          method: "POST",
                          signal,
                          body: JSON.stringify(value),
                        });
                      const next = {
                        ...draft,
                        name: draft.name.trim(),
                        env: "",
                        token: "",
                      };
                      setDraft(next);
                      setBaseline(JSON.stringify(next));
                      setSelected(draft.name.trim());
                      setRevision((v) => v + 1);
                      op.setNotice(ht("MCP 服务器已保存"));
                    })
                  }
                >
                  {ht("保存服务器")}
                </ConfigButton>
                {row && (
                  <>
                    <ConfigButton
                      disabled={op.busy || dirty || Boolean(flow)}
                      onClick={() =>
                        void op.run(async (signal) => {
                          const result = await hermesJson<{
                            ok: boolean;
                            error?: string;
                            tools: { name: string; description?: string }[];
                          }>(
                            scoped(
                              `/api/mcp/servers/${encodeURIComponent(row.name)}/test`,
                              profile,
                            ),
                            { method: "POST", signal, body: "{}" },
                          );
                          if (!result.ok)
                            throw new Error(
                              result.error || ht("MCP 连接检测失败"),
                            );
                          setTools(result.tools ?? []);
                          op.setNotice(ht("MCP 连接检测通过"));
                        })
                      }
                    >
                      {ht("测试连接")}
                    </ConfigButton>
                    {row.auth === "oauth" && (
                      <ConfigButton
                        disabled={op.busy || dirty || Boolean(flow)}
                        onClick={() =>
                          void op.run(async (signal) => {
                            setFlow(
                              await hermesJson(
                                scoped(
                                  `/api/mcp/servers/${encodeURIComponent(row.name)}/auth`,
                                  profile,
                                ),
                                { method: "POST", signal, body: "{}" },
                              ),
                            );
                          })
                        }
                      >
                        {ht("连接账号")}
                      </ConfigButton>
                    )}
                    <ConfigButton
                      variant="danger"
                      disabled={
                        op.busy ||
                        dirty ||
                        row.source === "plugin" ||
                        Boolean(flow)
                      }
                      onClick={() => {
                        if (
                          window.confirm(
                            ht("删除 MCP 服务器「{name}」？", {
                              name: row.name,
                            }),
                          )
                        )
                          void op.run(async (signal) => {
                            await hermesJson(
                              scoped(
                                `/api/mcp/servers/${encodeURIComponent(row.name)}`,
                                profile,
                              ),
                              { method: "DELETE", signal },
                            );
                            setSelected("");
                            setRevision((v) => v + 1);
                          });
                      }}
                    >
                      {ht("删除服务器")}
                    </ConfigButton>
                  </>
                )}
              </div>
              {flow && (
                <ConfigNotice>
                  <p>{ht("请打开授权页面完成 MCP 登录。")}</p>
                  {flow.authorization_url &&
                    /^https?:\/\//.test(flow.authorization_url) && (
                      <a
                        href={flow.authorization_url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {ht("打开授权页面")}
                      </a>
                    )}
                  <ConfigButton
                    disabled={op.busy}
                    onClick={() =>
                      void op.run(async (signal) => {
                        await hermesJson(
                          `/api/mcp/oauth/flows/${encodeURIComponent(flow.flow_id)}`,
                          { method: "DELETE", signal },
                        );
                        setFlow(null);
                      })
                    }
                  >
                    {ht("取消授权")}
                  </ConfigButton>
                </ConfigNotice>
              )}
              {tools.length > 0 && (
                <section>
                  <h3>{ht("可用工具")}</h3>
                  {tools.map((tool) => (
                    <p key={tool.name}>
                      <strong>{tool.name}</strong>
                      {tool.description && <span> — {tool.description}</span>}
                    </p>
                  ))}
                </section>
              )}
            </div>
          ) : (
            <ConfigEmptyState>
              {servers.loading
                ? ht("正在读取 MCP…")
                : ht("选择服务器，添加连接或从官方目录安装。")}
            </ConfigEmptyState>
          )}
        </ConfigDetail>
      </ConfigSplitView>
    </div>
  );
}
