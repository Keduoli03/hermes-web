import assert from "node:assert/strict";
import { chromium } from "playwright";
import nextEnv from "@next/env";
import { createWebSessionToken } from "../lib/web-auth.ts";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
nextEnv.loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
const origin = process.env.HERMES_TEST_URL ?? "http://127.0.0.1:30141";
const browser = await chromium.launch({ headless: true, channel: process.env.HERMES_TEST_BROWSER ?? "msedge" });
const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, reducedMotion: "reduce" });
await context.addCookies([{ name: "pi_web_session", value: createWebSessionToken(process.env.PI_WEB_PASSWORD), url: origin }]);
const page = await context.newPage(), errors = [], writes = [];
page.on("pageerror", error => errors.push(error.message));
let answered = false, prompts = 0, paused = false, enabled = false, pairing = true;
let subscriptions = [], pluginEnabled = true, binding = "waiting", currentPlatform = "telegram";
const question = { request_id: "srq-question", questions: [{ qid: "branch", question: "Choose branches", choices: ["main (Recommended)", "dev"], multi_select: true }, { qid: "note", question: "Review note" }] };
const frame = (id, data) => `id: ${id}\ndata: ${JSON.stringify(data)}\n\n`;
const snapshot = () => frame(2, { event: "run.snapshot", run_id: "run-recovery", session_id: "test-session", status: "running", text: "Working", clarify: question, tools: [], reasoning: "" });
await page.route("**/api/cwd/validate", route => route.fulfill({ json: { cwd: "/project" } }));
await page.route("**/api/git/status**", route => route.fulfill({ json: { isGit: false, files: [] } }));
await page.route("**/api/file-index**", route => route.fulfill({ json: { files: [] } }));
await page.route("**/api/files/**", route => route.fulfill({ json: { entries: [] } }));
await page.route("**/api/hermes-session/chat**", async route => {
  const request = route.request();
  if (request.method() === "POST") {
    const body = request.postDataJSON();
    if (body.action === "clarify") { writes.push(body); answered = true; await route.fulfill({ json: { ok: true } }); return; }
    prompts++; await route.fulfill({ contentType: "text/event-stream", body: snapshot() }); return;
  }
  await route.fulfill({ contentType: "text/event-stream", body: answered ? frame(3, { event: "run.completed", output: "Recovered answer" }) : snapshot() });
});
await page.route("**/api/hermes-control**", async route => {
  const request = route.request(), url = new URL(request.url());
  let data;
  if (request.method() === "POST") {
    const body = request.postDataJSON(); writes.push(body);
    if (body.module === "agents") paused = body.paused;
    if (body.module === "plugins" && body.action === "toggle") pluginEnabled = body.enable;
    data = { ok: true, paused };
  } else if (url.searchParams.get("module") === "plugins") data = { plugins: [{ name: "fixture-plugin", key: "fixture/plugin", description: "Fixture plugin", status: pluginEnabled ? "enabled" : "disabled", source: "bundled", version: "1.0", settings_schema: [{ key: "region", type: "string", label: "Region", value: "west" }] }] };
  else data = { active: [{ subagent_id: "child-1", goal: "Review workspace", status: "running", depth: 1 }], paused, max_concurrent_children: 4, max_spawn_depth: 2 };
  await route.fulfill({ json: data });
});
await page.route("**/api/hermes/**", async route => {
  const request = route.request(), url = new URL(request.url()), path = url.pathname.replace("/api/hermes", "");
  const body = request.postData() ? request.postDataJSON() : {};
  if (request.method() !== "GET") writes.push({ path, body, method: request.method() });
  let data = { ok: true };
  if (path === "/api/status") data = { version: "fixture" };
  else if (path === "/v1/models") data = { data: [{ id: "model-1" }] };
  else if (path === "/api/model/options") data = { providers: [{ slug: "mock", models: ["model-1"] }] };
  else if (path === "/api/sessions") data = { sessions: [{ id: "test-session", title: "Recovery chat" }], total: 1 };
  else if (path === "/api/sessions/test-session") data = { id: "test-session", cwd: "/project", model: "model-1" };
  else if (path.endsWith("/messages")) data = { messages: [{ role: "user", content: "Original prompt" }, { role: "assistant", content: "Working" }] };
  else if (path === "/api/pairing") data = { pending: pairing ? [{ request_id: "request-one", platform: "telegram", user_id: "123", user_name: "Fixture user" }] : [], approved: [] };
  else if (path === "/api/pairing/approve") pairing = false;
  else if (path === "/api/webhooks/enable") { enabled = true; data = { ok: true, needs_restart: true }; }
  else if (path === "/api/webhooks") {
    if (request.method() === "POST") { const row = { ...body, enabled: true, url: "https://fixture.test/webhooks/review" }; subscriptions.push(row); data = { ...row, secret: "one-time-fixture-secret" }; }
    else data = { enabled, subscriptions };
  } else if (path.endsWith("/enabled")) subscriptions[0].enabled = body.enabled;
  else if (path === "/api/messaging/platforms") data = { platforms: ["telegram", "whatsapp"].map(id => ({ id, name: id === "telegram" ? "Telegram" : "WhatsApp", enabled: false, state: "disabled", env_vars: [] })) };
  else if (path.includes("/onboarding/start")) { currentPlatform = path.includes("telegram") ? "telegram" : "whatsapp"; binding = "waiting"; data = { pairing_id: "pairing-one", status: "waiting", qr_payload: "https://t.me/fixture?start=123", deep_link: "https://t.me/fixture?start=123", expires_at: new Date(Date.now() + 60000).toISOString() }; }
  else if (path.includes("/onboarding/") && path.endsWith("/apply")) data = { ok: true, needs_restart: true };
  else if (path.includes("/onboarding/")) { binding = currentPlatform === "telegram" ? "ready" : "connected"; data = { status: binding, owner_user_id: "123" }; }
  await route.fulfill({ json: data });
});
async function nav(label) {
  if (!await page.getByRole("dialog", { name: "Hermes 设置", exact: true }).count()) await page.getByRole("button", { name: "设置", exact: true }).click();
  const menu = page.getByRole("navigation", { name: "设置分类", exact: true });
  const target = menu.getByRole("button", { name: label, exact: true, includeHidden: true });
  if (!await target.isVisible()) await menu.locator(".hermes-settings-menu-group").filter({ has: page.getByRole("button", { name: label, exact: true, includeHidden: true }) }).locator(".hermes-settings-group-toggle").click();
  await target.click();
}
const out = join(tmpdir(), "hermes-web-qa"); await mkdir(out, { recursive: true });
try {
  await page.goto(`${origin}/?session=test-session`);
  await page.getByText("Original prompt", { exact: true }).waitFor();
  await page.waitForFunction(() => !document.querySelector(".hermes-project-trigger").disabled);
  await page.locator(".chat-input-textarea").fill("Review this project");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await page.getByRole("form", { name: "补充信息", exact: true }).waitFor();
  await page.reload();
  await page.getByRole("form", { name: "补充信息", exact: true }).waitFor();
  assert.equal(prompts, 1, "reload must attach to the original run without prompting twice");
  await page.getByRole("checkbox", { name: /^main/ }).check();
  await page.getByRole("checkbox", { name: "dev", exact: true }).check();
  await page.locator(".hermes-clarify textarea").last().fill("Inspect access boundaries");
  await page.screenshot({ path: join(out, "clarify-recovery-desktop.png") });
  await page.getByRole("button", { name: "提交回答", exact: true }).click();
  await page.getByText("Recovered answer", { exact: true }).waitFor();
  assert.deepEqual(writes.find(body => body.action === "clarify").answers, { branch: '["main","dev"]', note: "Inspect access boundaries" });
  assert.equal(await page.evaluate(() => sessionStorage.getItem("hermes-active-run")), null);
  await nav("插件"); await page.getByText("Fixture plugin", { exact: true }).waitFor();
  await page.getByRole("switch", { name: "启用 fixture-plugin", exact: true }).click();
  await page.getByText("Fixture plugin", { exact: true }).waitFor();
  assert.equal(pluginEnabled, false);
  await page.locator(".hermes-admin-select").click(); await page.getByLabel("Region", { exact: true }).fill("east");
  await page.getByRole("button", { name: "保存设置", exact: true }).click();
  await page.getByLabel("Region", { exact: true }).waitFor();
  assert.deepEqual(writes.find(body => body.action === "settings").values, { region: "east" });
  await nav("配对审批"); await page.getByRole("button", { name: "批准访问", exact: true }).click();
  await page.getByRole("button", { name: "批准访问", exact: true }).waitFor({ state: "detached" });
  assert.equal(writes.find(body => body.path === "/api/pairing/approve").body.request_id, "request-one");
  await nav("Webhooks"); await page.getByRole("button", { name: "启用 Webhooks", exact: true }).click();
  await page.getByRole("button", { name: "新建订阅", exact: true }).click();
  await page.getByLabel("名称", { exact: true }).fill("review");
  await page.getByLabel("任务提示词", { exact: true }).fill("Review the event");
  await page.getByRole("button", { name: "创建订阅", exact: true }).click();
  await page.getByText("one-time-fixture-secret", { exact: true }).waitFor();
  await page.screenshot({ path: join(out, "webhooks-desktop.png") });
  await page.getByRole("switch", { name: "启用 review", exact: true }).click();
  await page.getByRole("switch", { name: "启用 review", exact: true }).waitFor();
  assert.equal(subscriptions[0].enabled, false);
  await nav("多智能体任务"); await page.getByText("Review workspace", { exact: true }).waitFor();
  await page.getByRole("button", { name: "暂停任务派发", exact: true }).click();
  await page.getByRole("button", { name: "恢复任务派发", exact: true }).waitFor();
  assert.equal(paused, true);
  await nav("消息渠道"); await page.getByRole("button", { name: /^Telegram/ }).click();
  await page.getByRole("button", { name: "开始绑定", exact: true }).click();
  await page.getByRole("button", { name: "保存绑定", exact: true }).waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some(button => button.textContent.includes("保存绑定") && !button.disabled));
  await page.getByRole("button", { name: "保存绑定", exact: true }).click();
  await page.getByRole("button", { name: /^WhatsApp/ }).click();
  await page.getByRole("button", { name: "开始绑定", exact: true }).click();
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some(button => button.textContent.includes("保存绑定") && !button.disabled));
  await page.getByRole("button", { name: "保存绑定", exact: true }).click();
  assert.equal(writes.filter(body => body.path?.endsWith("/apply")).length, 2);
  assert.deepEqual(writes.find(body => body.path === "/api/messaging/telegram/onboarding/pairing-one/apply").body.allowed_user_ids, ["123"]);
  await nav("多智能体任务");
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: join(out, "agents-mobile.png") });
  assert.deepEqual(errors, []);
  console.log("PASS: run reload/reconnect, batched clarify, plugins, pairing approvals, webhooks, delegation and Telegram/WhatsApp onboarding. Fixture writes only.");
} catch (error) { await page.screenshot({ path: join(out, "completion-failure.png") }); console.error((await page.locator("body").innerText()).slice(-3500)); throw error; }
finally { await browser.close(); }
