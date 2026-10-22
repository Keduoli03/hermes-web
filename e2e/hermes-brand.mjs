import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import nextEnv from "@next/env";
import { createWebSessionToken, revokeWebSessionToken } from "../lib/web-auth.ts";

nextEnv.loadEnvConfig(process.cwd(),true,{info(){},error(){}});
const origin=process.env.HERMES_TEST_URL || "http://127.0.0.1:30141";
const output=join(tmpdir(),"hermes-brand-qa");await mkdir(output,{recursive:true});
const token=createWebSessionToken(process.env.PI_WEB_PASSWORD);
const browser=await chromium.launch({headless:true,channel:process.env.HERMES_TEST_BROWSER || "msedge"});
try {
  const context=await browser.newContext({viewport:{width:1365,height:900},reducedMotion:"reduce"});
  const page=await context.newPage(), errors=[];
  page.on("pageerror",error=>errors.push(error.message));
  await page.goto(origin+"/login",{waitUntil:"networkidle"});
  const loginAvatar=page.locator(".web-login-brand .hermes-avatar");
  assert.equal(await loginAvatar.getAttribute("src"),"/icons/hermes-avatar.png");
  assert.equal(await loginAvatar.evaluate(image=>image.complete && image.naturalWidth>0),true);
  assert.match(await page.title(),/Hermes Web/);
  assert.ok((await page.locator('link[rel="icon"]').evaluateAll(links=>links.map(link=>link.getAttribute("href")))).some(path=>path.includes("hermes-icon")));
  await page.screenshot({path:join(output,"login.png")});
  const manifest=await (await context.request.get(origin+"/manifest.webmanifest")).json();
  assert.equal(manifest.name,process.env.PI_WEB_APP_NAME?.trim() || "Hermes Web");
  assert.ok(manifest.icons.every(icon=>icon.src.includes("hermes-icon")));
  for(const icon of manifest.icons){
    const response=await context.request.get(origin+icon.src);assert.equal(response.status(),200);
    const bytes=await response.body(), size=Number(icon.sizes.split("x")[0]);
    assert.equal(bytes.readUInt32BE(16),size);assert.equal(bytes.readUInt32BE(20),size);
  }
  const alias=await (await context.request.get(origin+"/icons/icon-192.png")).body();
  const canonical=await (await context.request.get(origin+"/icons/hermes-icon-192.png")).body();
  assert.deepEqual(alias,canonical);
  assert.equal((await context.request.get(origin+"/favicon.ico")).status(),200);
  const offline=await (await context.request.get(origin+"/offline.html")).text();
  assert.match(offline,/Hermes Web is offline/);assert.doesNotMatch(offline,/Pi Web/);
  await context.addCookies([{name:"pi_web_session",value:token,url:origin}]);
  await page.route("**/api/hermes/**",route=>{
    const path=new URL(route.request().url()).pathname.replace("/api/hermes","");
    return route.fulfill({json:path==="/api/sessions" ? {sessions:[],total:0} : path==="/v1/models" ? {data:[{id:"fixture-model"}]} : path==="/api/model/options" ? {providers:[]} : path==="/api/skills" ? [] : {version:"fixture"}});
  });
  for(const [name,width,height,theme] of [["desktop",1365,900,"light"],["dark",1365,900,"dark"],["mobile",390,844,"light"],["narrow",320,740,"dark"]]){
    await page.setViewportSize({width,height});
    await page.goto(origin,{waitUntil:"networkidle"});
    await page.evaluate(theme=>document.documentElement.setAttribute("data-theme",theme),theme);
    const rail=page.locator(".hermes-rail-brand .hermes-avatar"), hero=page.locator(".new-session-brand .hermes-avatar");
    await rail.waitFor();await hero.waitFor();
    for(const avatar of [rail,hero]) assert.equal(await avatar.evaluate(image=>image.complete && image.naturalWidth>0),true);
    const bounds=await rail.boundingBox();assert.equal(bounds.width,32);assert.equal(bounds.height,32);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    assert.equal(await page.locator(".new-session-meta").innerText(),"Hermes Agent");
    await page.screenshot({path:join(output,`${name}.png`)});
  }
  assert.deepEqual(errors,[]);
  console.log(`PASS: official Hermes avatar, login/rail/new-chat identity, favicon, PWA sizes, legacy URLs, offline branding and desktop/mobile rendering. Screenshots: ${output}`);
}finally{await browser.close();revokeWebSessionToken(token);}
