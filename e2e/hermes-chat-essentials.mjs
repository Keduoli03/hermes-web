// Real local attachment writes; deterministic Hermes search/command/chat fixtures.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import nextEnv from "@next/env";
import { createWebSessionToken, revokeWebSessionToken } from "../lib/web-auth.ts";

nextEnv.loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
const origin = process.env.HERMES_TEST_URL || "http://127.0.0.1:30141";
const directory = await mkdtemp(join(tmpdir(), "hermes-chat-attachments-"));
const output = join(tmpdir(), "hermes-chat-essentials-qa"); await mkdir(output, {recursive:true});
await writeFile(join(directory,"existing.txt"), "Keep original bytes");
const token = createWebSessionToken(process.env.PI_WEB_PASSWORD);
const browser = await chromium.launch({headless:true,channel:process.env.HERMES_TEST_BROWSER || "msedge"});
try {
  const context = await browser.newContext({viewport:{width:1365,height:900},permissions:["clipboard-read","clipboard-write"],reducedMotion:"reduce"});
  await context.addCookies([{name:"pi_web_session",value:token,url:origin}]);
  const page = await context.newPage(), errors = [], chats = [], searches = [];
  page.on("pageerror",error=>errors.push(error.message));
  let failedUpload = false, uploadGate = Promise.resolve(), releaseUpload, title = "Archived conversation", compactions = 0;
  const history = Array.from({length:115},(_,index)=>({role:"assistant",content:index===1 ? "Ancient needle target in archived history" : `Historical answer ${index}`}));
  await page.route("**/api/cwd/browse**",route=>route.fulfill({json:{path:directory,parentPath:tmpdir(),directories:[]}}));
  await page.route("**/api/hermes-session/project",async route=>{
    const cwd = route.request().postDataJSON().cwd;
    const validation = await context.request.post(origin+"/api/cwd/validate",{data:{cwd}});
    assert.equal(validation.ok(),true);
    return route.fulfill({json:{...(await validation.json()),branch:""}});
  });
  await page.route("**/api/hermes-session/chat",route=>{
    chats.push(route.request().postDataJSON());
    return route.fulfill({contentType:"text/event-stream",body:'data: {"event":"run.started","run_id":"fixture-upload-run","session_id":"created"}\n\ndata: {"event":"run.completed","output":"Attachment received"}\n\n'});
  });
  await page.route("**/api/hermes-session/compact",route=>{
    compactions++;
    return route.fulfill({json:{status:"compressed",before_tokens:1000,after_tokens:200}});
  });
  await page.route("**/api/files/**",async route=>{
    if(new URL(route.request().url()).searchParams.get("type")!=="upload") return route.continue();
    await uploadGate;
    if(failedUpload){ failedUpload=false; return route.fulfill({status:500,json:{error:"Fixture upload failure"}}); }
    return route.continue();
  });
  await page.route("**/api/hermes/**",async route=>{
    const request=route.request(), url=new URL(request.url()), path=url.pathname.replace("/api/hermes","");
    let json={};
    if(path==="/api/status") json={version:"fixture"};
    else if(path==="/v1/models") json={data:[{id:"fixture-model"}]};
    else if(path==="/api/model/options") json={providers:[]};
    else if(path==="/api/skills") json=[];
    else if(path==="/api/sessions/search") {
      const query=url.searchParams.get("q"),limit=Number(url.searchParams.get("limit")); searches.push({query,limit});
      if(query==="slow") { await new Promise(resolve=>setTimeout(resolve,600)); return route.fulfill({json:{results:[{id:"slow-hit",title:"Stale slow result"}]}}).catch(()=>{}); }
      if(query==="broken") return route.fulfill({status:503,json:{error:"Fixture search unavailable"}});
      const result={session_id:"old-archived",title,archived:true,snippet:"Ancient needle target in archived history"};
      json={results:query==="many" ? Array.from({length:limit},(_,i)=>({...result,session_id:`result-${i}`,title:`Result ${i}`})) : [result]};
    }
    else if(path==="/api/sessions") json={sessions:[{id:"recent",title:"Recent conversation"}],total:51};
    else if(path.endsWith("/messages")) json={messages:url.searchParams.get("order")==="oldest" ? history : history.slice(-100)};
    else if(path.endsWith("/latest-descendant")) json={session_id:"old-archived"};
    else if(path.startsWith("/api/sessions/")) {
      if(request.method()==="PATCH") title=request.postDataJSON().title;
      json={id:path.split("/").at(-1),title,cwd:directory,model:"fixture-model"};
    }
    return route.fulfill({json});
  });
  await page.goto(origin,{waitUntil:"networkidle"});
  const composer=page.locator(".chat-input-textarea"), picker=page.locator(".chat-input-shell input[type=file]");
  assert.equal(await picker.getAttribute("accept"),null);
  await picker.setInputFiles({name:"notes with spaces.txt",mimeType:"text/plain",buffer:Buffer.from("Attachment fixture bytes")});
  await page.locator(".directory-picker-panel").waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("button",{name:"重试上传",exact:true}).click();
  uploadGate=new Promise(resolve=>{releaseUpload=resolve;});
  await page.locator(".directory-picker-footer .directory-picker-action").last().click();
  await page.getByText("正在上传附件…",{exact:true}).waitFor();
  assert.equal(await page.getByRole("button",{name:"新建对话",exact:true}).isDisabled(),true);
  await composer.fill("Keep this draft ");
  assert.equal(await page.getByRole("button",{name:"发送",exact:true}).isDisabled(),true);
  releaseUpload();
  await page.getByText("附件已上传并添加到输入框。",{exact:true}).waitFor();
  assert.equal(await readFile(join(directory,"notes with spaces.txt"),"utf8"),"Attachment fixture bytes");
  assert.match(await composer.inputValue(),/@"notes with spaces.txt"/);
  assert.match(await composer.inputValue(),/Keep this draft/);
  await picker.setInputFiles({name:"existing.txt",mimeType:"text/plain",buffer:Buffer.from("Must not replace")});
  await page.getByText("同名文件已保留，已引用现有文件。",{exact:true}).waitFor();
  assert.equal(await readFile(join(directory,"existing.txt"),"utf8"),"Keep original bytes");
  failedUpload=true;
  await picker.setInputFiles({name:"retry.txt",mimeType:"text/plain",buffer:Buffer.from("Retry bytes")});
  await page.getByText("附件上传失败，文件已保留，请重试。",{exact:true}).waitFor();
  await page.getByRole("button",{name:"重试上传",exact:true}).click();
  await page.getByText("附件已上传并添加到输入框。",{exact:true}).waitFor();
  assert.equal(await readFile(join(directory,"retry.txt"),"utf8"),"Retry bytes");
  const transfer=await page.evaluateHandle(()=>{const data=new DataTransfer();data.items.add(new File(["Dropped bytes"],"dropped.txt",{type:"text/plain"}));return data;});
  await page.locator(".hermes-chat").dispatchEvent("drop",{dataTransfer:transfer});
  await page.waitForFunction(()=>document.querySelector(".chat-input-textarea").value.includes("@dropped.txt"));
  assert.equal(await readFile(join(directory,"dropped.txt"),"utf8"),"Dropped bytes");
  await page.screenshot({path:join(output,"desktop-attachments.png")});
  await composer.press("Enter"); await page.getByText("Attachment received",{exact:true}).waitFor();
  assert.equal(chats.length,1);assert.match(chats[0].text,/@dropped.txt/);assert.equal(chats[0].cwd,directory);
  console.log("PASS: local attachment selection, directory confirmation, upload lock, skip, retry and drop.");

  await page.getByRole("button",{name:"搜索会话",exact:true}).click();
  const search=page.getByRole("textbox",{name:"搜索会话",exact:true});
  await search.fill("slow"); await page.waitForRequest(request=>request.url().includes("sessions/search?q=slow"));
  await search.fill("needle");
  await page.locator(".hermes-session").filter({hasText:"Archived conversation"}).waitFor();
  await page.waitForTimeout(750);assert.equal(await page.getByText("Stale slow result",{exact:true}).count(),0);
  await page.locator(".hermes-session").filter({hasText:"Archived conversation"}).click();
  await page.locator('[data-search-match="true"]').waitFor();
  assert.match(await page.locator('[data-search-match="true"]').innerText(),/Ancient needle/);
  assert.equal(await page.locator('[data-search-match="true"]').evaluate(el=>{const box=el.getBoundingClientRect();return box.top>=0 && box.top<innerHeight;}),true);
  await page.screenshot({path:join(output,"desktop-fulltext-search.png")});
  await search.fill("broken");await page.locator('.hermes-search-status[role="alert"]').waitFor();
  assert.match(await page.locator('.hermes-search-status[role="alert"]').innerText(),/Fixture search unavailable/);
  await search.fill("many");await page.getByRole("button",{name:"更多搜索结果",exact:true}).click();
  await page.locator(".hermes-session").filter({hasText:"Result 39"}).waitFor();assert.equal(searches.at(-1).limit,40);
  await search.press("Escape");
  console.log("PASS: global search, archived/older-message location, cancellation, errors and result limits.");

  await composer.fill("/");
  await page.getByText("/compact",{exact:true}).waitFor();
  assert.equal(await page.getByText("/reload",{exact:true}).count(),0);
  assert.equal(await page.getByText("/clone",{exact:true}).count(),0);
  await composer.fill("/reload");await composer.press("Enter");
  await page.getByText("当前面板不支持此命令，请使用菜单中的命令。",{exact:true}).waitFor();
  assert.equal(await composer.inputValue(),"/reload");assert.equal(chats.length,1);
  await composer.fill("/name Renamed using command");await composer.press("Enter");
  await page.waitForFunction(()=>document.querySelector(".chat-input-textarea").value==="");
  assert.equal(title,"Renamed using command");
  await composer.fill("/copy");await composer.press("Enter");
  await page.waitForFunction(()=>document.querySelector(".chat-input-textarea").value==="");
  assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),"Historical answer 114");
  await composer.fill("/session");await composer.press("Enter");await page.locator("#hermes-session-info").waitFor();
  await page.getByRole("button",{name:"关闭会话信息",exact:true}).click();
  await composer.fill("/compact focus");await composer.press("Enter");
  await page.getByText("此命令不接受附加参数。",{exact:true}).waitFor();assert.equal(compactions,0);
  await composer.fill("/compact");await composer.press("Enter");
  await page.getByText(/压缩完成：/).waitFor();assert.equal(compactions,1);assert.equal(chats.length,1);
  for(const [name,width,height,theme] of [["dark",1365,900,"dark"],["mobile",390,844,"light"],["narrow",320,740,"light"]]){
    await page.setViewportSize({width,height});
    await page.evaluate(theme=>{document.documentElement.setAttribute("data-theme",theme);},theme);
    await picker.setInputFiles({name:`${name}-notes.txt`,mimeType:"text/plain",buffer:Buffer.from("Responsive upload")});
    await page.getByText("附件已上传并添加到输入框。",{exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.screenshot({path:join(output,`${name}-attachments.png`)});
  }
  assert.deepEqual(errors,[]);
  console.log(`PASS: native search contract, archived/older hits and location, stale requests, result limits, local commands, real file pick/drop/retry/skip and responsive layouts. Hermes responses are fixtures. Screenshots: ${output}`);
} finally {
  await browser.close();revokeWebSessionToken(token);
  assert.ok(directory.startsWith(join(tmpdir(),"hermes-chat-attachments-")));
  await rm(directory,{recursive:true,force:true});
}
