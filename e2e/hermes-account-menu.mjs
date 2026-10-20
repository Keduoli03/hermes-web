// Account/profile fixture checks. Never signs out the user's real account.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import nextEnv from "@next/env";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createWebSessionToken } from "../lib/web-auth.ts";

nextEnv.loadEnvConfig(process.cwd(),true,{info(){},error(){}});
const origin=process.env.HERMES_TEST_URL ?? "http://127.0.0.1:30141";
const output=join(tmpdir(),"hermes-account-menu-qa");await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,channel:"msedge"});
try {
  const context=await browser.newContext({viewport:{width:818,height:772},reducedMotion:"reduce"});
  await context.addCookies([{name:"pi_web_session",value:createWebSessionToken(process.env.PI_WEB_PASSWORD),url:origin}]);
  const page=await context.newPage();
  const errors=[],writes=[];
  let authenticated=true,authFailure=false,profileFailure=false,logoutFailure=false,active="default",reconnects=0,logouts=0;
  page.on("pageerror",error=>errors.push(error.message));
  await page.route("**/api/web-auth",route=>{
    if(route.request().method()==="DELETE"){
      logouts++;
      if(logoutFailure)return route.fulfill({status:500,json:{error:"Fixture logout failed"}});
      authenticated=false;return route.fulfill({json:{ok:true}});
    }
    if(authFailure)return route.fulfill({status:503,json:{error:"Fixture auth read failed"}});
    return route.fulfill({json:{enabled:true,authenticated,passwordEnabled:true,official:{enabled:true,ready:true},account:authenticated?"fixture-account":null}});
  });
  await page.route("**/api/hermes-connection",route=>{
    if(route.request().method()==="POST")reconnects++;
    return route.fulfill({json:{connected:true,automatic:true,local:true}});
  });
  await page.route("**/api/hermes/**",route=>{
    const request=route.request(),path=new URL(request.url()).pathname.replace("/api/hermes","");
    let json={};
    if(path==="/api/status")json={version:"fixture"};
    else if(path==="/v1/models")json={data:[{id:"hermes-agent"}]};
    else if(path==="/api/sessions")json={sessions:[],total:0};
    else if(path==="/api/profiles")json={profiles:[{name:"default",display_name:"默认方案",is_default:true},{name:"work",display_name:"工作方案"},{name:"research-with-a-long-profile-name",display_name:"研究与资料整理配置方案"}]};
    else if(path==="/api/profiles/active"){
      if(request.method()==="POST"){
        writes.push(request.postDataJSON());
        if(profileFailure)return route.fulfill({status:500,json:{error:"Fixture profile update failed"}});
        active=request.postDataJSON().name;json={ok:true,active};
      } else json={active,current:"default"};
    }
    return route.fulfill({json});
  });
  await page.goto(origin,{waitUntil:"networkidle"});
  const button=page.getByRole("navigation",{name:"主要导航",exact:true}).getByRole("button",{name:"账户与配置",exact:true});
  const menu=()=>page.getByRole("menu",{name:"账户与配置",exact:true});
  await button.click();
  await menu().getByRole("menuitemradio",{name:"工作方案",exact:true}).waitFor();
  assert.equal(await page.getByRole("dialog",{name:"Hermes 设置",exact:true}).count(),0);
  assert.equal(await menu().getByRole("menuitemradio",{name:"默认方案",exact:true}).getAttribute("aria-checked"),"true");
  await page.screenshot({path:join(output,"account-menu.png")});
  profileFailure=true;
  await menu().getByRole("menuitemradio",{name:"工作方案",exact:true}).click();
  await menu().getByText("Fixture profile update failed",{exact:true}).waitFor();
  assert.equal(active,"default");
  assert.equal(await menu().getByRole("menuitemradio",{name:"默认方案",exact:true}).getAttribute("aria-checked"),"true");
  profileFailure=false;
  await menu().getByRole("menuitemradio",{name:"工作方案",exact:true}).click();
  await menu().getByText("默认方案已更新，当前服务和已有会话保持原方案。",{exact:true}).waitFor();
  assert.deepEqual(writes.at(-1),{name:"work"});
  assert.equal(await menu().getByRole("menuitemradio",{name:"工作方案",exact:true}).getAttribute("aria-checked"),"true");
  await menu().getByText("当前服务方案：default",{exact:true}).waitFor();

  await menu().getByRole("menuitem",{name:"认证与登录",exact:true}).click();
  const auth=page.getByRole("dialog",{name:"账户与配置",exact:true});
  await auth.getByText("已自动连接本机 Hermes",{exact:true}).waitFor();
  await auth.getByRole("button",{name:"重新连接",exact:true}).click();
  await page.waitForFunction(()=>!Array.from(document.querySelectorAll(".hermes-account-panel button")).some(button=>button.textContent.includes("正在连接")));
  assert.equal(reconnects,1);
  await page.screenshot({path:join(output,"authentication.png")});
  await auth.getByRole("button",{name:"返回账户菜单",exact:true}).click();
  await page.keyboard.press("Escape");
  assert.equal(await button.getAttribute("aria-expanded"),"false");
  assert.equal(await button.evaluate(el=>document.activeElement===el),true);
  await button.click();
  await page.locator(".hermes-main").click({position:{x:200,y:80}});
  assert.equal(await button.getAttribute("aria-expanded"),"false");

  authFailure=true;await button.click();
  await page.getByText("无法读取登录配置，请刷新重试。",{exact:true}).waitFor();
  authFailure=false;await menu().getByRole("menuitem",{name:"重试",exact:true}).click();
  await menu().getByRole("menuitemradio",{name:"工作方案",exact:true}).waitFor();
  await page.keyboard.press("Escape");
  for(const [name,width,height,theme] of [["dark",818,772,"dark"],["mobile",390,844,"light"]]){
    await page.setViewportSize({width,height});
    await page.evaluate(theme=>localStorage.setItem("pi-theme",theme),theme);
    await page.reload({waitUntil:"networkidle"});
    await button.click();
    await menu().getByRole("menuitemradio",{name:"工作方案",exact:true}).waitFor();
    await page.screenshot({path:join(output,`${name}.png`)});
    const surface=page.locator(width<=640?".sidebar-sheet":".sidebar-menu");
    const bounds=await surface.boundingBox();
    assert.ok(bounds.x>=0 && bounds.y>=0 && bounds.x+bounds.width<=width+1 && bounds.y+bounds.height<=height+1);
    assert.equal(await surface.evaluate(el=>el.scrollWidth>el.clientWidth),false);
    await page.keyboard.press("Escape");
  }
  await page.setViewportSize({width:818,height:772});
  await button.click();
  logoutFailure=true;
  await menu().getByRole("menuitem",{name:"退出登录",exact:true}).click();
  await menu().getByText("退出失败，请重试。",{exact:true}).waitFor();
  assert.equal(new URL(page.url()).pathname,"/");
  logoutFailure=false;
  await menu().getByRole("menuitem",{name:"退出登录",exact:true}).click();
  await page.waitForURL("**/login");
  assert.equal(logouts,2);
  assert.equal(authenticated,false);
  await page.goto(origin,{waitUntil:"networkidle"});
  await button.click();
  await menu().getByRole("menuitem",{name:"登录面板",exact:true}).click();
  await page.waitForURL("**/login?next=*");
  assert.equal(new URL(page.url()).searchParams.get("next"),"/");
  await page.getByRole("link",{name:/使用 Nous 官方账号登录/}).waitFor();
  assert.deepEqual(errors,[]);
  console.log(`Account menu, inline authentication, default-profile semantics, failures, login/logout and responsive layout passed. Fixtures only. Screenshots: ${output}`);
} catch(error) {
  console.error(error);
  throw error;
} finally {await browser.close();}
