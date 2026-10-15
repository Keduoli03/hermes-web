// Fixture-only checks for the selected session's stored system prompt.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import nextEnv from "@next/env";
import { createWebSessionToken } from "../lib/web-auth.ts";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

nextEnv.loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
const origin = process.env.HERMES_TEST_URL ?? "http://127.0.0.1:30142";
const browser = await chromium.launch({ headless: true, channel: process.env.HERMES_TEST_BROWSER ?? "msedge" });
const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, reducedMotion: "reduce" });
await context.addCookies([{ name: "pi_web_session", value: createWebSessionToken(process.env.PI_WEB_PASSWORD), url: origin }]);
await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin });
const page = await context.newPage();
const errors = [];
page.on("pageerror", error => errors.push(error.message));
const firstPrompt = "You are Hermes.\n\n<SOUL>\nBe precise and helpful.\n</SOUL>\n\n<MEMORY>\nPrefer Chinese answers.\n</MEMORY>\n\n<script>window.promptUnsafe=true</script>\n\n" + "Follow the saved session rules.\n".repeat(90);
let prompt = firstPrompt;
let failDetail = false;
await page.route("**/api/hermes/**", async route => {
  const path = new URL(route.request().url()).pathname.replace("/api/hermes", "");
  let data = { ok: true };
  if (path === "/v1/models") data = { data: [{ id: "fixture-model" }] };
  else if (path === "/api/model/options") data = { providers: [] };
  else if (path === "/api/sessions") data = { sessions: [{ id: "prompt-one", title: "Prompt one" }, { id: "prompt-two", title: "Prompt two" }] };
  else if (path.endsWith("/latest-descendant")) data = { session_id: path.split("/")[3] };
  else if (path.endsWith("/messages")) data = { messages: [{ role: "user", content: "A fixture question" }, { role: "assistant", content: "Saved fixture answer.\n\n".repeat(50) }] };
  else if (path === "/api/sessions/prompt-one" || path === "/api/sessions/prompt-two") {
    if (failDetail) { await route.fulfill({ status: 503, json: { error: "Fixture unavailable" } }); return; }
    data = { id: path.split("/").at(-1), model: "fixture-model", input_tokens: 1000, system_prompt: path.endsWith("prompt-one") ? prompt : null };
  }
  await route.fulfill({ json: data });
});
const toggle = page.getByRole("button", { name: "系统", exact: true });
const panel = page.locator("#hermes-system-prompt");
const geometry = () => page.locator(".hermes-messages").evaluate(el => ({ top: el.getBoundingClientRect().top, height: el.clientHeight, scroll: el.scrollTop }));
const out = join(tmpdir(), "hermes-web-qa");
await mkdir(out, { recursive: true });
try {
  await page.goto(`${origin}/?session=prompt-one`);
  await page.getByRole("button", { name: "会话信息与用量", exact: true }).locator('[data-usage="input"]').waitFor();
  await page.locator(".hermes-messages").evaluate(el => { el.scrollTop = 300; });
  const before = await geometry();
  await toggle.click();
  await panel.getByText(firstPrompt, { exact: true }).waitFor();
  assert.equal(await page.getByRole("dialog").count(), 0, "System opens in chat, not settings");
  assert.deepEqual(await geometry(), before, "opening System preserves transcript geometry and scroll");
  assert.equal(await panel.locator("script").count(), 0, "prompt is plain text");
  assert.equal(await toggle.getAttribute("aria-expanded"), "true");
  await panel.getByRole("button", { name: "复制提示词", exact: true }).click();
  await panel.getByRole("button", { name: "已复制", exact: true }).waitFor();
  assert.equal((await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, "\n"), firstPrompt);
  await page.screenshot({ path: join(out, "system-prompt-desktop.png") });

  prompt = "Updated stored prompt.\n\n<SOUL>Updated session soul.</SOUL>";
  await panel.getByRole("button", { name: "刷新系统提示词", exact: true }).click();
  await panel.getByText(prompt, { exact: true }).waitFor();
  assert.deepEqual(await geometry(), before);
  failDetail = true;
  await panel.getByRole("button", { name: "刷新系统提示词", exact: true }).click();
  await panel.getByRole("alert").getByText("无法读取系统提示词，请重试。", { exact: true }).waitFor();
  assert.equal(await panel.getByText("本会话尚未保存系统提示词。", { exact: true }).count(), 0);
  failDetail = false;
  await panel.getByRole("button", { name: "重试", exact: true }).click();
  await panel.getByText(prompt, { exact: true }).waitFor();
  await page.keyboard.press("Escape");
  await panel.waitFor({ state: "detached" });
  assert.equal(await toggle.evaluate(el => el === document.activeElement), true);
  await toggle.click();
  await panel.getByText(prompt, { exact: true }).waitFor();
  await page.locator(".chat-input-textarea").click();
  await panel.waitFor({ state: "detached" });

  await toggle.click();
  await panel.getByText(prompt, { exact: true }).waitFor();
  await page.getByRole("button", { name: "会话信息与用量", exact: true }).click();
  await panel.waitFor({ state: "detached" });
  await page.getByRole("region", { name: "会话信息", exact: true }).waitFor();
  await toggle.click();
  await panel.getByText(prompt, { exact: true }).waitFor();
  assert.equal(await page.getByRole("region", { name: "会话信息", exact: true }).count(), 0);
  await page.getByRole("complementary", { name: "会话侧栏", exact: true }).getByText("Prompt two", { exact: true }).click();
  await page.waitForURL("**/?session=prompt-two");
  await panel.waitFor({ state: "detached" });
  await toggle.click();
  await panel.getByText("本会话尚未保存系统提示词。", { exact: true }).waitFor();
  assert.equal(await panel.getByText(prompt, { exact: true }).count(), 0);
  assert.equal(await panel.getByRole("button", { name: "复制提示词", exact: true }).isDisabled(), true);
  await page.keyboard.press("Escape");
  await page.getByRole("complementary", { name: "会话侧栏", exact: true }).getByText("Prompt one", { exact: true }).click();
  await page.waitForURL("**/?session=prompt-one");
  prompt = firstPrompt;
  for (const width of [768, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await toggle.click();
    await panel.getByText(firstPrompt, { exact: true }).waitFor();
    const bounds = await panel.boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    if (width === 390) await page.screenshot({ path: join(out, "system-prompt-mobile.png") });
    await panel.getByRole("button", { name: "关闭系统提示词", exact: true }).click();
  }
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.getByRole("button", { name: "新建对话", exact: true }).click();
  assert.equal(await toggle.isDisabled(), true);
  assert.equal(await panel.count(), 0);
  assert.deepEqual(errors, []);
  console.log("PASS: stored prompt/SOUL/memory, copy, refresh/retry, plain-text safety, session ownership, non-shifting overlay, dismissal/focus, mobile layout and fresh drafts.");
} catch (error) {
  await page.screenshot({ path: join(out, "system-prompt-failure.png") });
  throw error;
} finally { await browser.close(); }
