import assert from "node:assert/strict";
import test from "node:test";
import { hermesChatMessages } from "./hermes-chat-messages.ts";

test("Hermes history preserves OpenAI tool names and arguments without dumping them as assistant text", () => {
  const rows = hermesChatMessages([
    { role: "assistant", content: null, tool_calls: [{ id: "call-1", function: { name: "read_file", arguments: '{"path":"README.md"}' } }] },
    { role: "tool", tool_call_id: "call-1", content: "Long output" },
    { role: "assistant", content: "Done" },
  ]);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0].tool, { id: "call-1", name: "read_file", input: { path: "README.md" }, isError: false });
  assert.equal(rows[1].text, "Done");
});

test("native tool blocks retain result errors and do not become inline JSON", () => {
  const rows = hermesChatMessages([
    { role: "assistant", content: [{ type: "text", text: "Checking" }, { type: "toolCall", toolCallId: "native-1", toolName: "terminal", input: { command: "pwd" } }] },
    { role: "toolResult", toolCallId: "native-1", isError: true, content: [{ type: "text", text: "Command failed" }] },
  ]);
  assert.equal(rows[0].text, "Checking");
  assert.equal(rows[1].tool.name, "terminal");
  assert.equal(rows[1].tool.isError, true);
  assert.deepEqual(rows[1].tool.input, { command: "pwd" });
});

test("legacy results without a paired call remain readable and reasoning-only messages survive", () => {
  const rows = hermesChatMessages([
    { role: "system", content: "hidden" },
    { role: "tool", id: 12, name: "skill_view", content: [{ type: "text", text: "Skill contents" }] },
    { role: "assistant", content: [{ type: "thinking", thinking: "Reasoning" }] },
  ]);
  assert.equal(rows[0].tool.id, "12");
  assert.equal(rows[0].tool.name, "skill_view");
  assert.equal(rows[1].reasoning, "Reasoning");
});
