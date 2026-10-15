import { unified } from "unified";
import remarkParse from "remark-parse";
import type { RootContent } from "mdast";

export type ArtifactKind = "image" | "video" | "audio" | "code" | "file";
export type ArtifactSession = { id: string; title?: string | null; preview?: string; cwd?: string; last_active?: number | string; updated_at?: number | string; message_count?: number };
export type ArtifactMessage = { role: string; text?: string; content?: unknown; tool_name?: string; name?: string };
export type HermesArtifact = {
  id: string; kind: ArtifactKind; title: string; sessionId: string; sessionTitle: string;
  language: string; content: string; source: string;
};

const parser = unified().use(remarkParse);
const producerPattern = /(?:^|_)(?:creat(?:e|ion)|download|export|generat(?:e|ion)|render|save|speech|tts|write)(?:_|$)/i;
const strongKey = /^(?:artifact_(?:file|image|path|url)|files?_(?:created|modified|written)|generated_(?:file|image|path|url)|media_tag|output_(?:file|path|url)|result_(?:file|path|url)|saved_to|screenshot_path)$/i;
const producerKey = /^(?:artifacts?|attachments?|downloads?|(?:audio|image|video)(?:_(?:file|path|url))?|file_path|local_path|media(?:_(?:file|path|url))?|path|url)$/i;
const extensions: Record<string, ArtifactKind> = Object.fromEntries([
  ..."png jpg jpeg gif webp svg bmp avif".split(" ").map(ext => [ext, "image"]),
  ..."mp4 webm mov mkv avi m4v".split(" ").map(ext => [ext, "video"]),
  ..."mp3 wav ogg opus m4a flac aac".split(" ").map(ext => [ext, "audio"]),
  ..."pdf txt json md markdown mdown csv tsv yaml yml xml log css jsx tsx zip tar gz html js ts py docx xlsx pptx".split(" ").map(ext => [ext, "file"]),
]) as Record<string, ArtifactKind>;

function hash(text: string): string {
  let value = 2166136261;
  for (let i = 0; i < text.length; i++) value = Math.imul(value ^ text.charCodeAt(i), 16777619);
  return (value >>> 0).toString(36);
}

export function artifactSource(value: string, cwd?: string): string | null {
  let path = value.trim();
  if (!path || /[\x00-\x1f]/.test(path)) return null;
  if (path.startsWith("#media:")) { try { path = decodeURIComponent(path.slice(7)); } catch { return null; } }
  if (/^data:(?:image|video|audio)\/[\w.+-]+;base64,[a-z\d+/=\s]+$/i.test(path)) return path;
  if (/^https?:\/\//i.test(path)) {
    try { const url = new URL(path); return url.username || url.password ? null : url.href; } catch { return null; }
  }
  if (path.startsWith("file://")) {
    try { const url = new URL(path); if (url.hostname && url.hostname !== "localhost") return null; path = decodeURIComponent(url.pathname).replace(/^\/([a-z]:\/)/i, "$1"); } catch { return null; }
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(path) && !/^[a-z]:[\\/]/i.test(path)) return null;
  if (!/^(?:\/|~\/|[a-z]:[\\/]|\\\\)/i.test(path)) {
    if (!cwd) return null;
    path = `${cwd.replace(/[\\/]$/, "")}/${path.replace(/^\.\//, "")}`;
  }
  return path;
}

export function artifactMediaUrl(source: string, download = false): string {
  if (/^(?:https?:|data:)/i.test(source)) return source;
  return `/api/hermes/api/files/${download ? "download" : "stream"}?${new URLSearchParams({ path: source })}`;
}

export function artifactDocumentUrl(value: string, source: string): string {
  if (value.startsWith("#")) return value;
  let resolved: string | null;
  if (/^https?:/i.test(source)) {
    try { resolved = artifactSource(new URL(value, source).href); } catch { return ""; }
  } else {
    const parent = source.replace(/[\\/][^\\/]*$/, "");
    resolved = artifactSource(value, parent || undefined);
  }
  return resolved ? artifactMediaUrl(resolved) : "";
}

export function collectHermesArtifacts(session: ArtifactSession, messages: ArtifactMessage[]): HermesArtifact[] {
  const result = new Map<string, HermesArtifact>();
  const sessionTitle = session.title?.trim() || session.preview?.trim() || session.id;
  function add(value: string, title = "", hint?: ArtifactKind) {
    const source = artifactSource(value, session.cwd);
    if (!source) return;
    const mime = /^data:(image|video|audio)\//i.exec(source)?.[1]?.toLowerCase() as ArtifactKind | undefined;
    const pathname = /^https?:/i.test(source) ? new URL(source).pathname : source;
    const ext = /\.([a-z\d]+)$/i.exec(pathname)?.[1]?.toLowerCase();
    const kind = mime || (ext && extensions[ext]) || hint;
    if (!kind || kind === "code") return;
    let filename = pathname.split(/[\\/]/).pop() || "";
    try { filename = decodeURIComponent(filename); } catch { /* Preserve literal filenames with percent signs. */ }
    const id = `${session.id}:media:${hash(source)}`;
    if (!result.has(id)) result.set(id, { id, kind, title: title || (mime ? mime : filename), sessionId: session.id, sessionTitle, language: "", content: "", source });
  }
  function mediaTags(text: string) {
    for (const match of text.matchAll(/MEDIA:\s*(`[^`\n]+`|"[^"\n]+"|'[^'\n]+'|[^\s<>]+)/g)) {
      const raw = match[1];
      const value = /^[`"']/.test(raw) ? raw.slice(1, -1) : raw.replace(/[`"'*_,.;)]+$/, "");
      add(value);
    }
  }
  function payload(value: unknown, producer: boolean, explicit = false, depth = 0) {
    if (depth > 16) return;
    if (typeof value === "string") { if (explicit) { mediaTags(value); add(value); } return; }
    if (Array.isArray(value)) { value.forEach(item => payload(item, producer, explicit, depth + 1)); return; }
    if (!value || typeof value !== "object") return;
    const obj = value as Record<string, unknown>;
    if (producer && (obj.type === "image_url" || obj.type === "image")) {
      const image = obj.image_url as { url?: string } | string | undefined;
      const url = typeof image === "string" ? image : image?.url;
      if (url) add(url, "", "image");
      if (typeof obj.data === "string" && typeof obj.mimeType === "string") add(`data:${obj.mimeType};base64,${obj.data}`);
    }
    for (const [key, child] of Object.entries(obj)) {
      const mediaKind = /^(image|video|audio)(?:_url|_path|_file)?$/.exec(key)?.[1] as ArtifactKind | undefined;
      if (producer && mediaKind && typeof child === "string") add(child, "", mediaKind);
      payload(child, producer, explicit || strongKey.test(key) || (producer && producerKey.test(key)), depth + 1);
    }
  }
  for (const message of messages) {
    const assistant = message.role === "assistant";
    const tool = message.role === "tool" || message.role === "toolResult";
    if (!assistant && !tool) continue;
    const name = message.tool_name || message.name || "";
    const producer = producerPattern.test(name) || name.startsWith("bfl_flux3_");
    const content = message.content ?? message.text ?? "";
    const texts = typeof content === "string" ? [content] : Array.isArray(content) ? content.flatMap(part => typeof part === "string" ? [part] : part && typeof part.text === "string" ? [part.text] : []) : [];
    if (assistant) payload(content, true);
    else if (content && typeof content === "object") {
      const obj = content as Record<string, unknown>;
      payload(obj._multimodal ? obj.meta : content, producer);
    }
    for (const text of texts) {
      if (assistant) {
        const tree = parser.parse(text);
        const definitions = new Map<string, { url: string }>();
        tree.children.forEach(node => { if (node.type === "definition") definitions.set(node.identifier.toLowerCase(), node); });
        function visit(node: RootContent) {
          if (node.type === "code" && node.value.trim()) {
            const language = node.lang || "text";
            const id = `${session.id}:code:${hash(`${language}:${node.value}`)}`;
            if (!result.has(id)) result.set(id, { id, kind: "code", title: node.meta || `${language} · ${result.size + 1}`, language, content: node.value, source: "", sessionId: session.id, sessionTitle });
          } else if (node.type === "image" || node.type === "link") add(node.url, node.type === "image" ? node.alt || "" : "", node.type === "image" ? "image" : undefined);
          else if (node.type === "imageReference" || node.type === "linkReference") {
            const definition = definitions.get(node.identifier.toLowerCase());
            if (definition) add(definition.url, node.type === "imageReference" ? node.alt || "" : "", node.type === "imageReference" ? "image" : undefined);
          } else if (node.type === "inlineCode") { mediaTags(node.value); add(node.value); }
          else if (node.type === "text") {
            mediaTags(node.value);
            for (const match of node.value.matchAll(/(?:^|[\s("'`])((?:https?:\/\/|\/|~\/|[a-z]:[\\/])[^\s<>"'`]+)/gi)) add(match[1].replace(/[),.;]+$/, ""));
          }
          if ("children" in node) node.children.forEach(child => visit(child as RootContent));
        }
        tree.children.forEach(visit);
      } else {
        if (producer) mediaTags(text);
        if (name === "browser_vision") for (const match of text.matchAll(/Screenshot path:\s*([^\r\n<>]+)/gi)) add(match[1]);
        const wrapped = text.match(/^<untrusted_tool_result\b[^>]*>\s*[\s\S]*?\n\n([\s\S]*)<\/untrusted_tool_result>\s*$/)?.[1];
        try { payload(JSON.parse(wrapped ?? text), producer); } catch { /* Non-JSON tool prose is not an artifact declaration. */ }
      }
    }
  }
  return [...result.values()];
}

export async function loadArtifactSessions(load: (path: string) => Promise<{ sessions?: ArtifactSession[]; total?: number }>): Promise<ArtifactSession[]> {
  const sessions = new Map<string, ArtifactSession>();
  for (let offset = 0; ; offset += 100) {
    const body = await load(`/api/sessions?limit=100&archived=include&order=recent&offset=${offset}`);
    const rows = body.sessions ?? [];
    const previous = sessions.size;
    rows.forEach(session => sessions.set(session.id, session));
    if (!rows.length || sessions.size === previous || (body.total !== undefined ? offset + rows.length >= body.total : rows.length < 100)) break;
  }
  return [...sessions.values()];
}

export async function loadSessionArtifacts(session: ArtifactSession, load: (path: string) => Promise<{ messages?: ArtifactMessage[] }>): Promise<HermesArtifact[]> {
  const artifacts = new Map<string, HermesArtifact>();
  for (let offset = 0; ; offset += 100) {
    const body = await load(`/api/sessions/${encodeURIComponent(session.id)}/messages?limit=100&order=oldest&include_compacted=true&offset=${offset}`);
    const rows = body.messages ?? [];
    collectHermesArtifacts(session, rows).forEach(artifact => artifacts.set(artifact.id, artifact));
    if (rows.length < 100) break;
  }
  return [...artifacts.values()];
}
