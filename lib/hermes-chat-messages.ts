export type HermesChatMessage = {
  role: "user" | "assistant" | "tool";
  text: string;
  reasoning?: string;
  images?: { data: string; mimeType: string }[];
  tool?: { id: string; name: string; input: Record<string, unknown>; isError: boolean };
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function toolInput(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try { return record(JSON.parse(value)); } catch { return { arguments: value }; }
  }
  return record(value);
}

function messageText(item: Record<string, unknown>): string {
  const content = item.content ?? item.text;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map(part => typeof part === "string" ? part : typeof part?.text === "string" ? part.text : part?.type === "image" ? "[图片]" : "").filter(Boolean).join("\n");
}

export function hermesChatMessages(rows: Record<string, unknown>[]): HermesChatMessage[] {
  const calls = new Map<string, { name: string; input: Record<string, unknown> }>();
  const messages: HermesChatMessage[] = [];
  rows.forEach((row, index) => {
    if (row.role === "assistant") {
      const blocks = Array.isArray(row.content) ? row.content.filter(part => part?.type === "toolCall") : [];
      for (const item of [...(Array.isArray(row.tool_calls) ? row.tool_calls : []), ...blocks]) {
        const call = record(item), fn = record(call.function);
        const id = call.id ?? call.toolCallId;
        if (typeof id === "string") calls.set(id, { name: String(fn.name ?? call.toolName ?? call.name ?? "tool"), input: toolInput(fn.arguments ?? call.input ?? call.arguments) });
      }
    }
    if (!["user", "assistant", "tool", "toolResult"].includes(String(row.role))) return;
    const role = row.role === "user" ? "user" : row.role === "assistant" ? "assistant" : "tool";
    const text = messageText(row);
    const reasoning = typeof row.reasoning_content === "string" ? row.reasoning_content : Array.isArray(row.content) ? row.content.filter(part => part?.type === "thinking").map(part => String(part.thinking ?? "")).join("\n") : "";
    if (!text && role !== "tool" && !reasoning) return;
    const message: HermesChatMessage = { role, text, reasoning };
    if (role === "tool") {
      const id = String(row.tool_call_id ?? row.toolCallId ?? row.id ?? `tool-${index}`);
      const call = calls.get(id);
      message.tool = { id, name: String(row.toolName ?? row.tool_name ?? row.name ?? call?.name ?? "tool"), input: call?.input ?? toolInput(row.arguments), isError: row.isError === true || row.is_error === true };
    }
    messages.push(message);
  });
  return messages;
}
