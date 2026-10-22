// Full-width titles, hover/focus actions and touch controls; fixture sessions only.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import nextEnv from "@next/env";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createWebSessionToken } from "../lib/web-auth.ts";

nextEnv.loadEnvConfig(process.cwd(),true,{info(){},error(){}});
const origin=process.env.HERMES_TEST_URL ?? "http://127.0.0.1:30141";
const output=join(tmpdir(),"hermes-session-row-qa");await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,channel:"msedge"});
const errors=[];
const sessions=[
  {id:"long",title:"这是一个很长的会话标题，用来检查默认宽度和悬停操作按钮",pinned:true,message_count:128,last_active:1792458000,cwd:"/workspace/a-long-project-folder-name"},
  {id:"other",title:"第二个会话的标题也应该充分利用整行的可用空间",message_count:8,last_active:1792457999,cwd:"/workspace/another-long-project-folder-name"},
];
async function openPage(options){
  const context=await browser.newContext({reducedMotion:"reduce",...options});
  await context.addCookies([{name:"pi_web_session",value:createWebSessionToken(process.env.PI_WEB_PASSWORD),url:origin}]);
  const page=await context.newPage();
  page.on("pageerror",error=>errors.push(error.message));
  await page.route("**/api/hermes/**",route=>{
    const path=new URL(route.request().url()).pathname.replace("/api/hermes","");
    let json={};
    if(path==="/api/status")json={version:"fixture"};
    else if(path==="/api/sessions")json={sessions,total:sessions.length};
    else if(path==="/v1/models")json={data:[{id:"hermes-agent"}]};
    else if(path.endsWith("/messages"))json={messages:[]};
    else if(path.startsWith("/api/sessions/"))json={id:path.split("/").at(-1),model:"hermes-agent"};
    return route.fulfill({json});
  });
  await page.goto(origin,{waitUntil:"networkidle"});
  return page;
}
const geometry=row=>row.evaluate(el=>{
  const title=el.querySelector(".hermes-session > span"),actions=el.querySelector(".hermes-session-row-actions");
  const box=el.getBoundingClientRect(),style=getComputedStyle(el);
  return {height:box.height,titleWidth:title.getBoundingClientRect().width,titleHeight:title.getBoundingClientRect().height,available:box.width-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight),actionsWidth:actions.getBoundingClientRect().width,nextTop:el.nextElementSibling?.getBoundingClientRect().top ?? null};
});
try {
  const page=await openPage({viewport:{width:1365,height:900}});
  const rows=page.locator(".hermes-session-row"),row=rows.first();
  const normal=await geometry(row);
  assert.equal(normal.actionsWidth,0);
  assert.ok(Math.abs(normal.titleWidth-normal.available)<1,"Hidden actions reserve no title width");
  await page.screenshot({path:join(output,"normal.png")});
  await row.hover();
  const hover=await geometry(row);
  assert.equal(hover.actionsWidth,68);
  assert.ok(Math.abs(normal.titleWidth-hover.titleWidth-74)<1);
  assert.equal(hover.height,normal.height);assert.equal(hover.nextTop,normal.nextTop);assert.equal(hover.titleHeight,normal.titleHeight);
  await page.screenshot({path:join(output,"hover.png")});
  await page.locator(".hermes-main").click({position:{x:200,y:80}});
  assert.equal((await geometry(row)).actionsWidth,0);
  await row.locator(".hermes-session").focus();
  assert.equal((await geometry(row)).actionsWidth,68);
  await page.keyboard.press("Tab");
  assert.ok((await page.evaluate(()=>document.activeElement.getAttribute("aria-label"))).startsWith("重命名 "));
  await page.keyboard.press("Tab");await page.keyboard.press("Enter");
  await row.getByRole("group",{name:"会话操作",exact:true}).waitFor();
  await page.locator(".hermes-main").click({position:{x:200,y:80}});
  assert.equal(await row.getAttribute("data-menu-open"),"true");
  assert.equal((await geometry(row)).actionsWidth,68,"An open menu keeps its action group revealed");
  await page.keyboard.press("Escape");
  assert.equal((await geometry(row)).actionsWidth,0);
  await row.hover();
  page.once("dialog",dialog=>dialog.dismiss());
  await row.getByRole("button",{name:`重命名 ${sessions[0].title}`,exact:true}).click();
  await page.locator(".hermes-main").click({position:{x:200,y:80}});
  assert.equal((await geometry(row)).height,normal.height);

  const phone=await openPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  await phone.getByRole("button",{name:"打开侧栏",exact:true}).click();
  const phoneRows=phone.locator(".hermes-session-row");
  assert.equal((await geometry(phoneRows.first())).actionsWidth,0);
  await phoneRows.first().locator(".hermes-session").tap();
  await phone.getByRole("button",{name:"打开侧栏",exact:true}).click();
  assert.equal(await phoneRows.first().evaluate(el=>el.classList.contains("active")),true);
  assert.equal((await geometry(phoneRows.first())).actionsWidth,68);
  assert.equal((await geometry(phoneRows.last())).actionsWidth,0);
  await phone.screenshot({path:join(output,"touch.png")});
  assert.equal(await phone.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.deepEqual(errors,[]);
  console.log(`Session title width, stable row heights, hover/keyboard/menu and touch passed. Screenshots: ${output}`);
}finally{await browser.close();}
