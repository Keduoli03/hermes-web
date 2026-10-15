// Real local file operations, with deterministic Hermes responses and no inference.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { chromium } from "playwright";
import nextEnv from "@next/env";
import { createWebSessionToken } from "../lib/web-auth.ts";

nextEnv.loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
const origin=process.env.HERMES_TEST_URL ?? "http://127.0.0.1:30141";
const directory=await mkdtemp(join(tmpdir(),"hermes-files-project-"));
await writeFile(join(directory,"README.md"),"# Local file preview\n\nWorkspace fixture.");
const output=join(tmpdir(),"hermes-files-project-qa");await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,channel:"msedge"});
const terminalIds=new Set();
let context;
try {
  context=await browser.newContext({viewport:{width:1365,height:900},reducedMotion:"reduce"});
  await context.addCookies([{name:"pi_web_session",value:createWebSessionToken(process.env.PI_WEB_PASSWORD),url:origin}]);
  const page=await context.newPage();
  const errors=[],projects=[],chats=[];
  let failProject=false,created=false,createdTitle="Created project";
  page.on("pageerror",error=>errors.push(error.message));
  page.on("response",async response=>{
    if(new URL(response.url()).pathname==="/api/terminal" && response.request().method()==="POST" && response.ok()){
      const body=await response.json();terminalIds.add(body.id);
    }
  });
  await page.route("**/api/cwd/browse**",route=>route.fulfill({json:{path:directory,parentPath:tmpdir(),directories:[]}}));
  await page.route("**/api/hermes-session/project",async route=>{
    const body=route.request().postDataJSON();projects.push(body);
    if(failProject)return route.fulfill({status:502,json:{error:"Project validation failed"}});
    const validation=await context.request.post(`${origin}/api/cwd/validate`,{data:{cwd:body.cwd}});
    assert.equal(validation.ok(),true);
    return route.fulfill({json:{...(await validation.json()),branch:""}});
  });
  await page.route("**/api/hermes-session/chat",async route=>{
    chats.push(route.request().postDataJSON());created=true;
    await route.fulfill({contentType:"text/event-stream",body:'data: {"event":"run.started","run_id":"fixture-run","session_id":"created"}\n\ndata: {"event":"run.completed","output":"Directory confirmed"}\n\n'});
  });
  await page.route("**/api/hermes/**",route=>{
    const path=new URL(route.request().url()).pathname.replace("/api/hermes","");
    let json={};
    if(path==="/api/status")json={version:"fixture"};
    else if(path==="/v1/models")json={data:[{id:"hermes-agent"}]};
    else if(path==="/api/model/options")json={providers:[]};
    else if(path==="/api/skills")json=[];
    else if(path==="/api/sessions")json={sessions:[{id:"stored",title:"Existing project",cwd:directory},...(created?[{id:"created",title:createdTitle,cwd:directory,message_count:2}]:[])],total:created?2:1};
    else if(path.endsWith("/messages"))json={messages:[{role:"assistant",content:"Stored transcript"}]};
    else if(path.startsWith("/api/sessions/")){
      if(route.request().method()==="PATCH")createdTitle=route.request().postDataJSON().title;
      json={id:path.split("/").at(-1),cwd:directory,model:"hermes-agent"};
    }
    return route.fulfill({json});
  });
  await page.goto(origin,{waitUntil:"networkidle"});
  const files=page.getByRole("region",{name:"文件浏览器",exact:true});
  const toolbar=page.locator(".hermes-files-toolbar");
  const folder=page.locator(".hermes-project-trigger");
  const composer=page.locator(".chat-input-textarea");
  const newButton=page.getByRole("button",{name:"新建对话",exact:true});
  const chooseDirectory=()=>page.locator(".directory-picker-footer .directory-picker-action").last().click();

  // Every action can start by selecting a folder; cancellation creates nothing.
  await newButton.click();
  await page.locator(".directory-picker-panel").waitFor();
  await page.keyboard.press("Escape");
  assert.equal(projects.length,0);
  await toolbar.getByRole("button",{name:"搜索文件",exact:true}).click();
  await chooseDirectory();
  await page.locator("#file-search-input").waitFor();
  await page.locator("#file-search-input").fill("README");
  await files.getByText("README.md",{exact:true}).click();
  await page.getByRole("heading",{name:"Local file preview",exact:true}).waitFor();
  await page.getByRole("complementary",{name:"右侧面板",exact:true}).getByRole("button",{name:"隐藏右侧面板",exact:true}).click();
  await page.locator("#file-search-input").press("Escape");

  // Upload from a collapsed section expands it and uses the real upload API.
  await toolbar.getByRole("button",{name:"文件浏览器",exact:true}).click();
  const chooserPromise=page.waitForEvent("filechooser");
  await toolbar.getByRole("button",{name:"上传文件",exact:true}).click();
  await (await chooserPromise).setFiles({name:"uploaded.txt",mimeType:"text/plain",buffer:Buffer.from("Uploaded fixture")});
  await files.getByText("uploaded.txt",{exact:true}).waitFor();
  assert.equal(await readFile(join(directory,"uploaded.txt"),"utf8"),"Uploaded fixture");
  await writeFile(join(directory,"external.txt"),"External change");
  await toolbar.getByRole("button",{name:"刷新文件",exact:true}).click();
  await files.getByText("external.txt",{exact:true}).waitFor();

  // The real terminal starts in the selected directory and is explicitly closed.
  const terminalResponse=page.waitForResponse(response=>new URL(response.url()).pathname==="/api/terminal" && response.request().method()==="POST");
  await toolbar.getByRole("button",{name:"打开终端",exact:true}).click();
  const started=await terminalResponse;
  assert.equal(started.ok(),true,await started.text());
  const terminalId=(await started.json()).id;
  assert.equal((await (await context.request.get(`${origin}/api/terminal/${terminalId}`)).json()).cwd,directory);
  const panel=page.getByRole("complementary",{name:"右侧面板",exact:true});
  await panel.getByRole("tab",{name:/终端/}).waitFor();
  await panel.getByRole("button",{name:"终止终端 终端",exact:true}).click();
  await panel.getByRole("tab",{name:/终端/}).waitFor({state:"hidden"});
  assert.equal((await context.request.get(`${origin}/api/terminal/${terminalId}`)).status(),404);
  await panel.getByRole("button",{name:"隐藏右侧面板",exact:true}).click();

  // New drafts use the current folder and keep independent composer contents.
  await newButton.click();
  const sessions=page.getByRole("navigation",{name:"会话",exact:true});
  await sessions.getByText("草稿",{exact:true}).waitFor();
  assert.equal(projects.at(-1).cwd,directory);assert.equal(projects.at(-1).session_id,undefined);
  assert.ok((await sessions.locator(".hermes-session-row.active").innerText()).includes(basename(directory)));
  await composer.fill("First draft text");
  await newButton.click();
  await sessions.getByText("草稿",{exact:true}).nth(1).waitFor();
  await page.waitForFunction(()=>document.querySelector(".chat-input-textarea").value==="");
  assert.equal(await composer.inputValue(),"");
  assert.equal(await sessions.getByText("草稿",{exact:true}).count(),2);
  await composer.fill("Second draft text");
  await sessions.locator(".hermes-session-row").filter({hasText:"草稿"}).last().locator(".hermes-session").click();
  await page.waitForFunction(()=>document.querySelector(".chat-input-textarea").value==="First draft text");
  page.once("dialog",dialog=>dialog.accept("Workspace notes"));
  await sessions.locator(".hermes-session-row.active").getByRole("button",{name:"重命名 新会话",exact:true}).click();
  await page.screenshot({path:join(output,"files-and-drafts.png")});
  await composer.press("Enter");
  await page.getByText("Directory confirmed",{exact:true}).waitFor();
  assert.equal(chats[0].cwd,directory);assert.equal(chats[0].session_id,undefined);
  assert.equal(await sessions.getByText("草稿",{exact:true}).count(),1);
  await sessions.getByText("Workspace notes",{exact:true}).waitFor();
  assert.equal(createdTitle,"Workspace notes");

  // New from a saved chat never rebinds the saved chat. Failure preserves it.
  await sessions.getByRole("button",{name:/^Existing project/}).click();
  await page.getByText("Stored transcript",{exact:true}).waitFor();
  failProject=true;await newButton.click();
  await page.getByText("Project validation failed",{exact:true}).waitFor();
  assert.ok(page.url().includes("session=stored"));assert.equal(projects.at(-1).session_id,undefined);
  failProject=false;await newButton.click();
  await page.waitForFunction(()=>!location.search);
  assert.equal(projects.at(-1).session_id,undefined);

  // Refresh restores only the folder after validation, never a prior transcript.
  await page.reload({waitUntil:"networkidle"});
  assert.equal(await folder.getAttribute("title"),directory);
  assert.equal(await composer.inputValue(),"");
  assert.equal(await page.getByText("Stored transcript",{exact:true}).count(),0);
  await page.setViewportSize({width:390,height:844});
  await page.getByRole("button",{name:"打开侧栏",exact:true}).click();
  await newButton.click();
  await page.waitForFunction(()=>!document.querySelector(".hermes-layout").classList.contains("sidebar-visible"));
  await page.getByRole("button",{name:"打开侧栏",exact:true}).click();
  await page.screenshot({path:join(output,"mobile-files-and-draft.png")});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  // An upload chosen before a project continues after directory confirmation.
  await page.setViewportSize({width:1365,height:900});
  await page.evaluate(()=>localStorage.removeItem("hermes-current-project"));
  await page.goto(origin,{waitUntil:"networkidle"});
  const deferredChooser=page.waitForEvent("filechooser");
  await toolbar.getByRole("button",{name:"上传文件",exact:true}).click();
  await chooseDirectory();
  await (await deferredChooser).setFiles({name:"from-picker.txt",mimeType:"text/plain",buffer:Buffer.from("Deferred upload fixture")});
  await files.getByText("from-picker.txt",{exact:true}).waitFor();
  assert.equal(await readFile(join(directory,"from-picker.txt"),"utf8"),"Deferred upload fixture");
  failProject=true;
  await page.reload({waitUntil:"networkidle"});
  await page.getByText("上次使用的文件夹无法访问，请重新选择文件夹。",{exact:true}).waitFor();
  assert.equal(await folder.getAttribute("title"),"选择项目文件夹");
  assert.equal(await page.evaluate(()=>localStorage.getItem("hermes-current-project")),null);
  assert.deepEqual(errors,[]);
  console.log(`Files/search/upload/refresh/terminal, folder drafts, failure recovery and mobile passed. Screenshots: ${output}`);
} catch(error) {
  const pages=context?.pages() ?? [];
  if(pages[0])await pages[0].screenshot({path:join(output,"failure.png")});
  throw error;
} finally {
  for(const id of terminalIds)await context?.request.delete(`${origin}/api/terminal/${id}`).catch(()=>{});
  await browser.close();
}
