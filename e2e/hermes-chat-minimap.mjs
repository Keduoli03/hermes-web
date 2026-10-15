import assert from "node:assert/strict";
import { chromium } from "playwright";
import nextEnv from "@next/env";
import { createWebSessionToken } from "../lib/web-auth.ts";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

nextEnv.loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
const origin = process.env.HERMES_TEST_URL ?? "http://127.0.0.1:30142";
const browser = await chromium.launch({ headless: true, channel: "msedge" });
const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, reducedMotion: "reduce" });
await context.addCookies([{ name: "pi_web_session", value: createWebSessionToken(process.env.PI_WEB_PASSWORD), url: origin }]);
const page = await context.newPage();
const errors = [], requests = [];
page.on("pageerror", error => errors.push(error.message));
const messages = Array.from({ length: 8 }, (_, i) => [
  { role: "user", content: `Question ${i + 1}` },
  { role: "tool", content: `Tool output ${i + 1}` },
  { role: "assistant", content: `## Answer ${i + 1}\n\n${"A paragraph of fixture answer content.\n\n".repeat(8)}` },
]).flat();
await page.route("**/api/hermes/**", async route => {
  const path = new URL(route.request().url()).pathname.replace("/api/hermes", "");
  requests.push(path);
  let data = { ok: true };
  if (path === "/v1/models") data = { data: [{ id: "fixture-model" }] };
  else if (path === "/api/sessions") data = { sessions: [{ id: "fixture", title: "Navigation fixture" }] };
  else if (path === "/api/sessions/fixture/messages") data = { messages };
  else if (path === "/api/sessions/fixture") data = { id: "fixture", model: "fixture-model" };
  else if (path === "/api/model/options") data = { providers: [] };
  await route.fulfill({ json: data });
});
const out = join(tmpdir(), "hermes-web-qa");
await mkdir(out, { recursive: true });
const nodes = page.locator("[data-minimap-node-index]");
const lock = page.locator("[data-minimap-lock]");
const scroll = page.locator(".hermes-messages");
const waitForScroll = async target => {
  await page.waitForFunction(expected => Math.abs(document.querySelector(".hermes-messages").scrollTop - expected) < 3, target);
};
try {
  await page.goto(`${origin}/?session=fixture`);
  await nodes.nth(7).waitFor({ state: "attached" });
  assert.equal(await nodes.count(), 8);
  const rail = lock.locator("..");
  const railBox = await rail.boundingBox(), scrollBox = await scroll.boundingBox();
  assert.ok(railBox.x >= scrollBox.x + scrollBox.width - 1);
  assert.ok(railBox.height > 500);
  assert.ok(Math.abs(railBox.y - scrollBox.y) < 1);
  assert.ok(Math.abs(railBox.height - scrollBox.height) < 1);
  const inputBox = await page.locator(".hermes-chat > :last-child").boundingBox();
  assert.ok(railBox.y + railBox.height <= inputBox.y + 1);
  await rail.hover();
  await page.locator('[data-minimap-preview-user="0"]').waitFor();
  assert.equal(await page.locator("[data-minimap-preview-user]").count(), 8);
  assert.equal(await page.locator("[data-minimap-preview-assistant]").count(), 8);
  await page.screenshot({ path: join(out, "chat-minimap-desktop.png") });
  await page.locator('[data-minimap-preview-user="2"]').click();
  const expected = await scroll.evaluate(el => {
    const row = [...el.querySelectorAll(".hermes-user-row")][2];
    return Math.max(0, row.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop - el.clientHeight * 0.3);
  });
  await waitForScroll(expected);
  await rail.hover();
  await page.locator('[data-minimap-preview-assistant="3-0"]').click();
  const answerTarget = await scroll.evaluate(el => {
    const row = el.querySelectorAll(".hermes-assistant-row")[7];
    return Math.max(0, row.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop - el.clientHeight * 0.3);
  });
  await waitForScroll(answerTarget);
  assert.equal(requests.filter(path => path.endsWith("/messages")).length, 1);
  await page.getByRole("button", { name: "显示右侧面板", exact: true }).click();
  const resizedRail = await rail.boundingBox(), resizedScroll = await scroll.boundingBox();
  assert.ok(resizedRail.x >= resizedScroll.x + resizedScroll.width - 1);
  await page.setViewportSize({ width: 390, height: 844 });
  await lock.waitFor({ state: "detached" });
  await page.getByRole("complementary", { name: "右侧面板", exact: true }).getByRole("button", { name: "隐藏右侧面板", exact: true }).click();
  await page.screenshot({ path: join(out, "chat-minimap-mobile.png") });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.goto(origin);
  await page.locator(".hermes-new-session-brand").waitFor();
  assert.equal(await nodes.count(), 0);
  assert.deepEqual(errors, []);
  console.log("Hermes chat minimap: right rail, previews, tool-safe anchors, navigation, resized panel, mobile and empty state passed.");
} finally {
  await browser.close();
}
