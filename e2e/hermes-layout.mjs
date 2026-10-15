// Visual and interaction checks against an existing dev server.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import nextEnv from "@next/env";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWebSessionToken } from "../lib/web-auth.ts";

nextEnv.loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
const origin = process.env.HERMES_TEST_URL ?? "http://127.0.0.1:30141";
const output = join(tmpdir(), "hermes-layout-qa");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: process.env.HERMES_TEST_BROWSER ?? "msedge" });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  await context.addCookies([{ name: "pi_web_session", value: createWebSessionToken(process.env.PI_WEB_PASSWORD), url: origin }]);
  await context.addInitScript(() => { if (!localStorage.getItem("pi-theme")) localStorage.setItem("pi-theme", "light"); });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/hermes/**", route => {
    const path = new URL(route.request().url()).pathname.replace("/api/hermes", "");
    let json = {};
    if (path === "/api/sessions") json = { sessions: [], total: 0 };
    else if (path === "/v1/models") json = { data: [{ id: "hermes-agent" }] };
    else if (path === "/api/models") json = { models: [] };
    else if (path === "/api/skills") json = [];
    else if (path === "/health" || path === "/api/status") json = { version: "fixture", gateway_running: true };
    return route.fulfill({ json });
  });
  await page.route("**/api/hermes-session/project", route => route.fulfill({ json: { cwd: null } }));
  await page.goto(origin, { waitUntil: "networkidle" });
  const toggle = page.locator(".hermes-right-panel-toggle");
  const panel = page.locator("#hermes-right-panel");
  const main = page.locator(".hermes-main");
  await toggle.waitFor();
  await page.screenshot({ path: join(output, "desktop-closed.png") });
  assert.equal(await page.locator(".hermes-toolbar-action").first().evaluate(el => getComputedStyle(el).borderRightWidth), "0px");
  await toggle.click();
  await panel.getByText("暂无打开的文件或终端", { exact: true }).waitFor();
  let bounds = await panel.boundingBox();
  const chatBounds = await main.boundingBox();
  assert.ok(bounds.width >= 280 && bounds.width <= 420);
  assert.ok(Math.abs(bounds.x - chatBounds.x - chatBounds.width) < 1, "No blank gutter between chat and panel");
  assert.ok(chatBounds.width >= 420);
  await page.screenshot({ path: join(output, "desktop-open.png") });
  const separator = page.getByRole("separator", { name: "调整右侧面板宽度" });
  await separator.focus();
  await separator.press("ArrowLeft");
  assert.ok((await panel.boundingBox()).width > bounds.width, "Keyboard resize works");
  await panel.getByRole("button", { name: "展开右侧面板", exact: true }).click();
  assert.equal(await main.getAttribute("inert"), "");
  await page.screenshot({ path: join(output, "desktop-expanded.png") });
  await panel.getByRole("button", { name: "还原面板宽度", exact: true }).click();
  assert.equal(await main.getAttribute("inert"), null);
  await panel.getByRole("button", { name: "隐藏右侧面板", exact: true }).click();
  assert.equal(await panel.isVisible(), false);
  await toggle.click();
  for (const [name, width, height, theme] of [
    ["desktop-dark", 1440, 900, "dark"],
    ["tablet", 820, 900, "light"],
    ["mobile", 390, 844, "light"],
    ["mobile-dark", 390, 844, "dark"],
  ]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(theme => localStorage.setItem("pi-theme", theme), theme);
    await page.reload({ waitUntil: "networkidle" });
    await toggle.click();
    assert.equal(await page.locator("html").getAttribute("data-theme"), theme);
    await page.screenshot({ path: join(output, `${name}.png`) });
    bounds = await panel.boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    const empty = await page.locator(".hermes-right-panel-empty").boundingBox();
    assert.ok(empty.y + empty.height <= height + 1, "Empty state fits panel");
    if (width <= 640) assert.equal(Math.round(bounds.width), width);
    if (width === 820) assert.ok((await main.boundingBox()).width >= 500, "Tablet panel overlays instead of squeezing chat");
  }
  await panel.getByRole("button", { name: "隐藏右侧面板", exact: true }).click();
  await page.screenshot({ path: join(output, "mobile-closed.png") });
  assert.equal(await toggle.getAttribute("aria-expanded"), "false");
  assert.deepEqual(errors, []);
  console.log(`Layout checks passed. Screenshots: ${output}`);
} finally {
  await browser.close();
}
