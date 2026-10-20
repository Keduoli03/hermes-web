"use client";

import { useMemo } from "react";
import type { HermesChatMessage } from "@/lib/hermes-chat-messages";
import type { AssistantMessage, ToolResultMessage } from "@/lib/types";
import { MessageView } from "./MessageView";

export function HermesToolMessage({ message, scope, cwd, onOpenFile }: {
  message: HermesChatMessage;
  scope: string;
  cwd?: string;
  onOpenFile?: (filePath: string, page?: number) => void;
}) {
  const { call, results } = useMemo(() => {
    const tool = message.tool ?? { id: "tool", name: "tool", input: {}, isError: false };
    const id = `${scope}:${tool.id}`;
    const call: AssistantMessage = { role: "assistant", model: "", provider: "", content: [{ type: "toolCall", toolCallId: id, toolName: tool.name, input: tool.input }] };
    const result: ToolResultMessage = { role: "toolResult", toolCallId: id, toolName: tool.name, content: [{ type: "text", text: message.text }], isError: tool.isError };
    return { call, results: new Map([[id, result]]) };
  }, [message, scope]);
  return <div data-hermes-tool-result><MessageView message={call} toolResults={results} cwd={cwd} onOpenFile={onOpenFile} /></div>;
}
