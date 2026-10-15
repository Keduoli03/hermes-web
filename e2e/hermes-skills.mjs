import assert from "node:assert/strict";
import { chromium } from "playwright";
import nextEnv from "@next/env";
import { createWebSessionToken } from "../lib/web-auth.ts";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

nextEnv.loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
const origin = process.env.HERMES_TEST_URL ?? "http://127.0.0.1:30142";
const browser = await chromium.launch({ headless: true, channel: process.env.HERMES_TEST_BROWSER ?? "msedge" });
const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, reducedMotion: "reduce" });
await context.addCookies([{ name: "pi_web_session", value: createWebSessionToken(process.env.PI_WEB_PASSWORD), url: origin }]);
const page = await context.newPage(), errors = [], writes = [];
page.on("pageerror", error => errors.push(error.message));
const skills = [
  { name: "hermes-server-ops", category: "devops", provenance: "agent", usage: 101, enabled: true },
  { name: "hermes-agent", category: "autonomous-ai-agents", provenance: "bundled", usage: 97, enabled: true },
  { name: "browser-research", category: "research", provenance: "hub", usage: 26, enabled: false },
  { name: "a-long-skill-name-for-responsive-layout-and-wrapping", category: "software-development", provenance: "external", usage: 12345, enabled: true },
  { name: "new-local-skill", category: "general", provenance: "agent", enabled: true },
  ...Array.from({ length: 15 }, (_, index) => ({ name: `project-tool-${index + 1}`, category: "development", provenance: "bundled", usage: index, enabled: true })),
].map(skill => ({ ...skill, description: "管理项目环境，检查运行状态并整理维护记录。" }));
let failToggle = false;
await page.route("**/api/hermes/**", async route => {
  const request = route.request(), path = new URL(request.url()).pathname.replace("/api/hermes", "");
  let json = {};
  if (path === "/api/status") json = { version: "fixture" };
  else if (path === "/api/sessions") json = { sessions: [], total: 0 };
  else if (path === "/v1/models") json = { data: [{ id: "hermes-agent" }] };
  else if (path === "/api/profiles") json = { profiles: [{ name: "default", is_default: true }] };
  else if (path === "/api/profiles/active") json = { current: "default", active: "default" };
  else if (path === "/api/skills") json = skills;
  else if (path === "/api/skills/content") json = { content: "# 项目维护\n\n检查项目运行状态，整理维护结果。\n\n## 工作流程\n\n1. 检查服务状态\n2. 整理变更记录\n\n```sh\nhermes status\n```" };
  else if (path === "/api/skills/toggle") {
    const body = request.postDataJSON(); writes.push(body);
    if (failToggle) { await route.fulfill({ status: 500, json: { error: "技能状态保存失败" } }); return; }
    skills.find(skill => skill.name === body.name).enabled = body.enabled;
  }
  await route.fulfill({ json });
});
const out = join(tmpdir(), "hermes-web-qa"); await mkdir(out, { recursive: true });
try {
  await page.goto(origin, { waitUntil: "networkidle" });
  await page.getByRole("navigation", { name: "主要导航" }).getByRole("button", { name: "技能工具", exact: true }).click();
  const list = page.locator(".hermes-skills .config-sidebar");
  await page.getByRole("button", { name: "hermes-server-ops", exact: true }).waitFor();
  assert.equal(await list.locator(".hermes-skill-row").count(), 20);
  assert.equal(await list.getByLabel("搜索技能", { exact: true }).count(), 1);
  assert.equal(await page.locator(".hermes-skills .hermes-management-toolbar").count(), 0);
  const rail = page.getByRole("navigation", { name: "主要导航" });
  assert.equal(await rail.getByRole("button").last().getAttribute("aria-label"), "配置档案");
  assert.equal(await list.locator(".hermes-skill-select").first().getAttribute("aria-label"), "a-long-skill-name-for-responsive-layout-and-wrapping");
  assert.equal(await list.getByLabel("已使用 101 次", { exact: true }).textContent(), "×101");
  assert.equal(await list.getByLabel("暂无使用统计", { exact: true }).textContent(), "—");
  assert.equal((await list.boundingBox()).width >= 400, true);
  assert.equal(await list.locator(".hermes-skill-row").evaluateAll(rows => rows.every(row => row.getBoundingClientRect().height >= 64)), true);
  await page.getByRole("button", { name: "hermes-server-ops", exact: true }).click();
  await page.getByRole("heading", { name: "项目维护", exact: true }).waitFor();
  await page.screenshot({ path: join(out, "skills-redesign.png") });
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.getByLabel("SKILL.md 内容", { exact: true }).fill("# Unsaved skill draft");
  await page.getByRole("switch", { name: "启用 browser-research", exact: true }).click();
  await page.getByText("技能已启用", { exact: true }).waitFor();
  assert.deepEqual(writes.at(-1), { name: "browser-research", enabled: true });
  assert.equal(await page.getByLabel("SKILL.md 内容", { exact: true }).inputValue(), "# Unsaved skill draft");
  assert.equal(await page.getByRole("button", { name: "hermes-server-ops", exact: true }).getAttribute("aria-current"), "page");
  failToggle = true;
  await page.getByRole("switch", { name: "启用 browser-research", exact: true }).click();
  await page.getByRole("alert").getByText("技能状态保存失败", { exact: true }).waitFor();
  assert.equal(await page.getByRole("switch", { name: "启用 browser-research", exact: true }).getAttribute("aria-checked"), "true");
  assert.equal(await page.getByLabel("SKILL.md 内容", { exact: true }).inputValue(), "# Unsaved skill draft");
  await page.getByLabel("技能排序", { exact: true }).selectOption("name");
  assert.equal(await list.locator(".hermes-skill-select").first().getAttribute("aria-label"), "a-long-skill-name-for-responsive-layout-and-wrapping");
  assert.equal(await list.locator(".hermes-skill-select").nth(1).getAttribute("aria-label"), "browser-research");
  await page.getByLabel("搜索技能", { exact: true }).fill("运维");
  assert.equal(await list.locator(".hermes-skill-row").count(), 1);
  await page.getByLabel("搜索技能", { exact: true }).fill("不存在"); await page.getByText("没有匹配的技能", { exact: true }).waitFor();
  await page.getByLabel("搜索技能", { exact: true }).fill("");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "预览", exact: true }).click();
  await page.screenshot({ path: join(out, "mobile-skills-redesign.png") });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.equal(await list.locator(".hermes-skill-row").evaluateAll(rows => rows.every(row => {
    const name = row.querySelector(".hermes-skill-select").getBoundingClientRect();
    const usage = row.querySelector(".hermes-skill-usage").getBoundingClientRect();
    const toggle = row.querySelector(".config-switch").getBoundingClientRect();
    return name.right <= usage.left && usage.right <= toggle.left && toggle.right <= row.getBoundingClientRect().right;
  })), true);
  page.once("dialog", dialog => dialog.dismiss());
  await rail.getByRole("button", { name: "配置档案", exact: true }).click();
  assert.equal(await page.getByRole("dialog", { name: "Hermes 设置", exact: true }).count(), 0);
  page.once("dialog", dialog => dialog.accept());
  await rail.getByRole("button", { name: "配置档案", exact: true }).click();
  await page.getByRole("dialog", { name: "Hermes 设置", exact: true }).waitFor();
  assert.equal(await page.getByRole("navigation", { name: "设置分类" }).getByRole("button", { name: "配置档案", exact: true }).count(), 0);
  await page.getByRole("button", { name: "新建配置档案", exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log("PASS: Spacious skill list, official usage, ordering/search, independent toggles, failed-write recovery, preserved draft and mobile layout. Fixture writes only.");
} finally { await browser.close(); }
