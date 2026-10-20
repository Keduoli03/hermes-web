import assert from "node:assert/strict";
import { chromium } from "playwright";
import nextEnv from "@next/env";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createWebSessionToken } from "../lib/web-auth.ts";

nextEnv.loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
const origin = process.env.HERMES_TEST_URL ?? "http://127.0.0.1:30141";
const output = join(tmpdir(), "hermes-tools-qa");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: "msedge" });
try {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport, reducedMotion: "reduce" });
    await context.addCookies([{ name: "pi_web_session", value: process.env.HERMES_TEST_SESSION_COOKIE ?? createWebSessionToken(process.env.PI_WEB_PASSWORD), url: origin }]);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    let streamRequests = 0, finish;
    const finished = new Promise(resolve => { finish = resolve; });
    await page.route("**/api/hermes/**", async route => {
      const path = new URL(route.request().url()).pathname.replace("/api/hermes", "");
      let json = {};
      if (path === "/api/status") json = { version: "fixture" };
      else if (path === "/v1/models") json = { data: [{ id: "fixture-model" }] };
      else if (path === "/api/sessions") json = { sessions: [{ id: "tool-session", title: "Tool results", message_count: 5 }], total: 1 };
      else if (path === "/api/sessions/tool-session") json = { id: "tool-session", model: "fixture-model", message_count: 5 };
      else if (path === "/api/sessions/tool-session/messages") json = { total: 5, messages: [
        { role: "user", content: "Inspect the project" },
        { role: "assistant", content: null, tool_calls: [{ id: "read-1", function: { name: "read_file", arguments: '{"path":"README.md"}' } }] },
        { role: "tool", tool_call_id: "read-1", content: "TOOL_OUTPUT_START\n" + "Long tool output with details.\n".repeat(120) },
        { role: "assistant", content: [{ type: "toolCall", toolCallId: "skill-1", toolName: "skill_view", input: { name: "server-ops" } }] },
        { role: "toolResult", toolCallId: "skill-1", content: [{ type: "text", text: "NATIVE_OUTPUT" }] },
      ] };
      else if (path === "/v1/runs") json = { run_id: "tool-run", session_id: "tool-session" };
      else if (path === "/v1/runs/tool-run/events") {
        if (streamRequests++) await finished;
        return route.fulfill({ contentType: "text/event-stream", body: streamRequests === 1
          ? 'id: 1\ndata: {"event":"tool.started","tool":"read_file","preview":"README.md"}\n\n'
          : 'id: 2\ndata: {"event":"run.completed","output":"Stream done"}\n\n' });
      }
      await route.fulfill({ json });
    });
    await page.goto(origin + "/?session=tool-session", { waitUntil: "domcontentloaded", timeout: 60000 });
    const cards = page.locator("[data-hermes-tool-result]");
    await cards.nth(1).waitFor();
    assert.equal(await cards.count(), 2);
    const toggle = cards.first().getByRole("button").first();
    assert.equal(await toggle.getAttribute("aria-expanded"), "false");
    assert.equal(await cards.first().getByText(/TOOL_OUTPUT_START/).count(), 0);
    assert.ok((await cards.first().boundingBox()).height < 100);
    await page.screenshot({ path: join(output, `${viewport.width}-collapsed.png`), fullPage: true });
    await toggle.click();
    assert.equal(await toggle.getAttribute("aria-expanded"), "true");
    assert.equal(await cards.first().getByText(/TOOL_OUTPUT_START/).first().isVisible(), true);
    await Promise.all([
      page.waitForResponse(response => response.url().includes("/tool-session/messages")),
      page.getByRole("button", { name: "完整历史", exact: true }).click(),
    ]);
    assert.equal(await toggle.getAttribute("aria-expanded"), "true");
    await toggle.click();
    await page.locator(".chat-input-textarea").fill("Continue");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    const activity = page.locator(".hermes-tool-activity");
    await activity.waitFor();
    assert.equal(await activity.evaluate(element => element.open), false);
    await activity.locator("summary").click();
    assert.equal(await activity.evaluate(element => element.open), true);
    finish();
    await page.getByText("Stream done", { exact: true }).waitFor();
    assert.equal(await activity.evaluate(element => element.open), true);
    assert.equal(await toggle.getAttribute("aria-expanded"), "false");
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log("PASS: desktop/mobile tool results collapsed, manual expansion retained, live activity stays under user control; " + output);
} finally { await browser.close(); }
