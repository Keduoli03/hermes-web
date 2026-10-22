import type { BuiltinSlashCommand } from "../components/ChatInput";
import type { BuiltinSlashCommandResult } from "../hooks/useAgentSession";

export const HERMES_COMMANDS: readonly BuiltinSlashCommand[] = [
  { name: "compact", description: "hermes.ui.command.compact", source: "builtin" },
  { name: "name", description: "chat.commandName", source: "builtin" },
  { name: "session", description: "chat.commandSession", source: "builtin", availableWhileStreaming: true },
  { name: "copy", description: "chat.commandCopy", source: "builtin", availableWhileStreaming: true },
];

export async function runHermesCommand(message: string, actions: {
  busy: boolean; hasSession: boolean;
  compact: () => Promise<boolean>; rename: (title: string) => Promise<void>;
  copy: () => Promise<void>; info: () => void;
}): Promise<BuiltinSlashCommandResult> {
  const match = /^\/([A-Za-z][A-Za-z0-9-]*)(?:\s+([\s\S]*))?$/.exec(message.trim());
  if (!match) return { handled: false };
  const command = HERMES_COMMANDS.find(item => item.name === match[1].toLowerCase());
  const fail = (error: string): BuiltinSlashCommandResult => ({ handled: true, error });
  if (!command) return fail("当前面板不支持此命令，请使用菜单中的命令。");
  const argument = match[2]?.trim() ?? "";
  if (actions.busy && !command.availableWhileStreaming) return fail("请等待当前操作完成后再执行命令。");
  if (command.name !== "copy" && !actions.hasSession) return fail("请先选择一个会话。");
  if (command.name === "name" && (!argument || argument.length > 200)) return fail("请输入 /name 和不超过 200 个字符的会话名称。");
  if (command.name !== "name" && argument) return fail("此命令不接受附加参数。");
  try {
    if (command.name === "compact" && !await actions.compact()) return fail("压缩未完成，请检查错误后重试。");
    if (command.name === "name") await actions.rename(argument);
    if (command.name === "copy") await actions.copy();
    if (command.name === "session") actions.info();
    return { handled: true };
  } catch (error) { return fail(error instanceof Error ? error.message : "命令执行失败，请重试。"); }
}
