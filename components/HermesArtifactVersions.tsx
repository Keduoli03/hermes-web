"use client";
import { useEffect, useState } from "react";
import { Download, Save, History, Trash2 } from "lucide-react";
import type { HermesArtifact } from "@/lib/hermes-artifacts";
import type { ArtifactVersion } from "@/lib/hermes-artifact-versions";
import { useHermesI18n } from "@/hooks/useHermesI18n";
import { ConfigButton, ConfigNotice } from "./SettingsUi";
export function HermesArtifactVersions({ artifact }: { artifact: HermesArtifact }) {
  const { ht } = useHermesI18n();
  const [open, setOpen] = useState(false), [versions, setVersions] = useState<ArtifactVersion[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState(""), [revision, setRevision] = useState(0);
  const query = new URLSearchParams({ session_id: artifact.sessionId, artifact_id: artifact.id }).toString();
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    fetch(`/api/hermes-artifacts/versions?${query}`, { signal: controller.signal }).then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error); return data; }).then(data => { if (!controller.signal.aborted) { setVersions(data.versions); setError(""); } }).catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [open, query, revision]);
  return <div className="hermes-artifact-versions"><ConfigButton aria-expanded={open} onClick={() => setOpen(!open)}><History size={15} />{ht("版本记录")}</ConfigButton>{open && <div>{error && <ConfigNotice>{error}</ConfigNotice>}<ConfigButton disabled={busy} onClick={() => { setBusy(true); setError(""); void fetch("/api/hermes-artifacts/versions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ session_id: artifact.sessionId, artifact_id: artifact.id }) }).then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error); setRevision(v => v + 1); }).catch(e => setError(e.message)).finally(() => setBusy(false)); }}><Save size={15} />{ht("保存当前版本")}</ConfigButton>{versions.map(version => <div key={version.id}><time>{new Date(version.createdAt).toLocaleString()}</time><span>{(version.size / 1024).toFixed(1)} KB</span><a href={`/api/hermes-artifacts/versions?${query}&version=${version.id}`} download={version.title} aria-label={ht("下载版本")}><Download size={16} /></a><ConfigButton aria-label={ht("删除版本")} title={ht("删除版本")} disabled={busy} onClick={() => {
    if (!window.confirm(ht("删除此保存版本？"))) return;
    setBusy(true); void fetch("/api/hermes-artifacts/versions", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ session_id: artifact.sessionId, artifact_id: artifact.id, version: version.id }) }).then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error); setRevision(v => v + 1); }).catch(e => setError(e.message)).finally(() => setBusy(false));
  }}><Trash2 size={15}/></ConfigButton></div>)}</div>}</div>;
}
