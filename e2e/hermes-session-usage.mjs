import assert from "node:assert/strict";
import { chromium } from "playwright";
import nextEnv from "@next/env";
import { createWebSessionToken } from "../lib/web-auth.ts";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatUsageCount, formatUsageCost } from "../lib/hermes-usage.ts";

assert.equal(formatUsageCount(0), "0");
assert.equal(formatUsageCount(999), "999");
assert.equal(formatUsageCount(1200), "1.2k");
assert.equal(formatUsageCount(999950), "1M");
assert.equal(formatUsageCount(1234567), "1.2M");
assert.equal(formatUsageCount(1234567890), "1.2B");
assert.equal(formatUsageCount(undefined), "—");
assert.equal(formatUsageCount(NaN), "—");
assert.equal(formatUsageCost(0), "$0");
assert.equal(formatUsageCost(0.0004), "<$0.01");
assert.equal(formatUsageCost(null), "—");

nextEnv.loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
const origin = process.env.HERMES_TEST_URL ?? "http://127.0.0.1:30142";
const browser = await chromium.launch({ headless: true, channel: "msedge" });
const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, reducedMotion: "reduce" });
await context.addCookies([{ name: "pi_web_session", value: createWebSessionToken(process.env.PI_WEB_PASSWORD), url: origin }]);
const page = await context.newPage();
const errors = [];
page.on("pageerror", error => errors.push(error.message));
let inputTokens=1234567;
let resolveDetail;
const secondDetailGate=new Promise(resolve=>{resolveDetail=resolve;});
await page.route("**/api/hermes/**", async route => {
  const path=new URL(route.request().url()).pathname.replace("/api/hermes", "");
  let data={ok:true};
  if(path==="/v1/models")data={data:[{id:"fixture-model"}]};
  else if(path==="/api/model/options")data={providers:[]};
  else if(path==="/api/sessions")data={sessions:[{id:"usage-one",title:"Usage one"},{id:"usage-two",title:"Usage two"}]};
  else if(path.endsWith("/messages"))data={messages:[{role:"user",content:"A fixture question"},{role:"assistant",content:"## Fixture answer\n\n"+"A paragraph of content for scrolling.\n\n".repeat(60)}]};
  else if(path==="/api/sessions/usage-one")data={id:"usage-one",title:"Usage one",model:"fixture-model",cwd:"/workspace/a-project-with-a-long-directory-name/example",started_at:1791766800,input_tokens:inputTokens,output_tokens:45678,cache_read_tokens:987654321,cache_write_tokens:1200,reasoning_tokens:5000,message_count:1234,tool_call_count:345,estimated_cost_usd:0.0004};
  else if(path==="/api/sessions/usage-two"){
    await secondDetailGate;
    data={id:"usage-two",title:"Usage two",model:"fixture-model",input_tokens:7000,output_tokens:200,actual_cost_usd:0,estimated_cost_usd:12};
  }
  await route.fulfill({json:data});
});
const usage=page.getByRole("button",{name:"会话信息与用量",exact:true});
const panel=page.getByRole("region",{name:"会话信息",exact:true});
const out=join(tmpdir(),"hermes-web-qa");
await mkdir(out,{recursive:true});
const geometry=()=>page.locator(".hermes-messages").evaluate(el=>({top:el.getBoundingClientRect().top,height:el.clientHeight,scroll:el.scrollTop}));
try {
  await page.goto(`${origin}/?session=usage-one`);
  await usage.locator('[data-usage="input"]').getByText("1.2M",{exact:true}).waitFor();
  assert.equal(await usage.locator('[data-usage="cache"]').textContent(),"987.7M");
  assert.equal(await usage.locator('[data-usage="cost"]').textContent(),"≈<$0.01");
  assert.ok((await usage.getAttribute("title")).includes("1,234,567"));
  await page.locator(".hermes-messages").evaluate(el=>{el.scrollTop=300;});
  const before=await geometry();
  await usage.click();
  await panel.waitFor();
  assert.deepEqual(await geometry(),before,"opening information must not resize or move chat");
  assert.ok(await panel.getByTitle("1,234,567",{exact:true}).isVisible());
  await page.screenshot({path:join(out,"session-usage-desktop.png")});
  inputTokens=2345678;
  await panel.getByRole("button",{name:"刷新",exact:true}).click();
  await usage.locator('[data-usage="input"]').getByText("2.3M",{exact:true}).waitFor();
  assert.deepEqual(await geometry(),before,"refreshing information must preserve scroll");
  await page.keyboard.press("Escape");
  await panel.waitFor({state:"detached"});
  assert.equal(await usage.evaluate(el=>el===document.activeElement),true);
  await usage.click();await panel.waitFor();
  await page.locator(".chat-input-textarea").click();
  await panel.waitFor({state:"detached"});
  await usage.click();await panel.waitFor();await usage.click();await panel.waitFor({state:"detached"});
  await page.getByRole("button",{name:"显示右侧面板",exact:true}).click();
  await usage.click();await panel.waitFor();
  const mainBox=await page.locator(".hermes-main").boundingBox(),panelBox=await panel.boundingBox();
  assert.ok(Math.abs(mainBox.width-panelBox.width)<1);
  await page.keyboard.press("Escape");
  await page.getByRole("complementary",{name:"右侧面板",exact:true}).getByRole("button",{name:"隐藏右侧面板",exact:true}).click();
  for(const width of [768,390,320]){
    await page.setViewportSize({width,height:844});
    await usage.click();await panel.waitFor();
    const bounds=await panel.boundingBox();
    assert.ok(bounds.x>=0 && bounds.x+bounds.width<=width);
    assert.ok(await usage.evaluate(el=>el.scrollWidth<=el.clientWidth));
    const toolbar=await page.locator(".hermes-top").evaluate(el=>({width:el.clientWidth,scrollWidth:el.scrollWidth,children:[...el.children].map(child=>({width:child.getBoundingClientRect().width,className:child.className}))}));
    assert.ok(toolbar.scrollWidth<=toolbar.width,JSON.stringify({viewport:width,...toolbar}));
    assert.equal(await page.locator(".hermes-top").evaluate(el=>el.getBoundingClientRect().height),40);
    if(width===390)await page.screenshot({path:join(out,"session-usage-mobile.png")});
    await page.keyboard.press("Escape");
  }
  await page.setViewportSize({width:1440,height:960});
  await page.getByRole("complementary",{name:"会话侧栏",exact:true}).getByText("Usage two",{exact:true}).click();
  await page.waitForURL("**/?session=usage-two");
  assert.equal(await usage.locator('[data-usage="input"]').count(),0,"new session must not show old session counters");
  resolveDetail();
  await usage.locator('[data-usage="input"]').getByText("7k",{exact:true}).waitFor();
  assert.equal(await usage.locator('[data-usage="cost"]').textContent(),"$0","actual zero cost takes precedence over estimate");
  assert.deepEqual(errors,[]);
  console.log("PASS: compact usage, exact tooltips, non-shifting overlay, dismissal/focus, refresh, side panel, mobile sizing and session ownership.");
} finally {
  resolveDetail();
  await browser.close();
}
