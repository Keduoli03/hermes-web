// Read-only checks against the configured local Hermes Dashboard.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const origin = process.env.HERMES_TEST_URL ?? "http://127.0.0.1:30142";
const browser = await chromium.launch({ headless: true, channel: process.env.HERMES_TEST_BROWSER ?? "msedge" });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
const errors = []; page.on("pageerror", error => errors.push(error.message));
const out = join(tmpdir(), "hermes-web-qa"); await mkdir(out, { recursive: true });
try {
  const schema = await page.request.get(`${origin}/api/hermes/api/config/schema`);
  assert.equal(schema.status(), 200);
  const fields = (await schema.json()).fields;
  assert.ok(Object.keys(fields).length > 100);
  await page.goto(origin, { waitUntil: "networkidle" });
  const rail=page.getByRole("navigation",{name:"主要导航",exact:true});
  await rail.getByRole("button",{name:"技能工具",exact:true}).click();await page.getByRole("navigation",{name:"技能工具分类",exact:true}).getByRole("button",{name:"MCP 连接",exact:true}).click();await page.getByLabel("搜索 MCP 服务器",{exact:true}).waitFor();assert.equal((await page.request.get(`${origin}/api/hermes/api/mcp/servers`)).status(),200);
  await rail.getByRole("button",{name:"消息平台",exact:true}).click();await page.getByLabel("搜索消息平台",{exact:true}).waitFor();assert.equal((await page.request.get(`${origin}/api/hermes/api/messaging/platforms`)).status(),200);
  await rail.getByRole("button",{name:"定时任务",exact:true}).click();await page.getByRole("button",{name:"＋ 新建任务",exact:true}).waitFor();assert.equal((await page.request.get(`${origin}/api/hermes/api/cron/jobs`)).status(),200);
  await rail.getByRole("button",{name:"首页",exact:true}).click();
  await page.getByRole("navigation", { name: "工作区设置", exact: true }).getByRole("button", { name: "设置", exact: true }).click();
  const nav = page.getByRole("navigation", { name: "设置分类", exact: true });
  async function choose(label) {
    const target = nav.getByRole("button",{name:label,exact:true,includeHidden:true}).first();
    if (!await target.isVisible()) await nav.locator(".hermes-settings-menu-group").filter({has:page.getByRole("button", {name:label,exact:true,includeHidden:true})}).locator(".hermes-settings-group-toggle").click();
    await target.click();
  }
  await choose("记忆内容");
  for (const name of ["我的笔记","用户画像","灵魂"]) {
    const card = page.getByRole("region",{name,exact:true});
    await card.getByRole("button",{name:"编辑",exact:true}).waitFor();
    await card.getByText("正在读取记忆…",{exact:true}).waitFor({state:"hidden"});
    assert.equal(await card.getByRole("alert").count(),0);
    assert.equal(await card.getByRole("button",{name:"编辑",exact:true}).isEnabled(),true);
  }
  await choose("持久记忆");
  await page.getByRole("switch", { name: "持久记忆", exact: true }).waitFor();
  assert.equal(await page.getByRole("combobox", { name: "记忆提供方", exact: true }).count(), 1);
  assert.equal(await page.getByRole("spinbutton", { name: "记忆预算", exact: true }).count(), 1);
  assert.equal(await page.locator(".hermes-config-field code, .hermes-config-field details, .hermes-config-toolbar > code").count(), 0);
  assert.equal(await page.locator(".hermes-config-editor .config-sidebar").count(), 0);
  await page.screenshot({ path: join(out, "live-memory.png") });
  await choose("高级配置");
  const breadcrumb = page.getByRole("navigation", { name: "设置路径", exact: true });
  assert.equal(await breadcrumb.locator("button, summary, select").count(),0);

  assert.equal(await page.locator(".hermes-config-editor .config-sidebar").count(), 0);
  await page.screenshot({path:join(out,"live-config-breadcrumb.png")});
  await choose("任务执行");
  await page.getByLabel("最大执行步数",{exact:true}).waitFor();
  assert.equal(await page.getByRole("combobox",{name:"回复详细程度",exact:true}).count(),1);
  assert.equal(await page.getByRole("combobox",{name:"图片输入方式",exact:true}).count(),1);
  assert.equal(await page.getByRole("spinbutton",{name:"单次运行时限",exact:true}).count(),1);
  const labels = await page.locator(".hermes-config-field-info label").allTextContents();
  assert.equal(labels.length <= 6,true);
  assert.equal(labels.some(label=>/switch|nofile|ratio|lease|run/i.test(label)),false);
  assert.equal(await page.locator(".hermes-config-field-info p").count(),labels.length);
  await page.screenshot({path:join(out,"live-task-settings.png")});
  for(const [label,path] of [["技能市场","/api/skills/hub/official"],["消息渠道","/api/messaging/platforms"],["MCP 连接","/api/mcp/servers"]]){
    await choose(label);
    const check=await page.request.get(`${origin}/api/hermes${path}`);
    assert.equal(check.status(),200);
    assert.equal(await page.locator(".hermes-advanced-module").count(),1);
  }
  await choose("模型");
  await page.getByRole("button", { name: "＋ 添加提供商", exact: true }).waitFor();
  await page.getByRole("button", { name: "＋ 添加提供商", exact: true }).click();
  await page.getByRole("dialog", {name:"选择提供商",exact:true}).waitFor();
  await page.getByRole("button", {name:/Nous Portal/}).waitFor();
  await page.screenshot({path:join(out,"live-provider-picker.png")});
  await page.getByRole("button", {name:"OpenAI / Anthropic compatible"}).click();
  await page.getByText("自动发现模型",{exact:true}).waitFor();
  await page.screenshot({path:join(out,"live-provider-form.png")});
  await page.getByRole("textbox", { name: "提供商名称", exact: true }).waitFor();
  assert.equal(await page.getByRole("combobox", { name: "接口协议", exact: true }).count(), 1);
  assert.deepEqual(errors, []);
  console.log(`PASS: live Dashboard schema (${Object.keys(fields).length} fields), Chinese memory controls, provider editor. No settings were written.`);
} finally { await browser.close(); }
