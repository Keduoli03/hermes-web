// Cron layout and editor regression against a real Next page, fixture writes only.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import nextEnv from "@next/env";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createWebSessionToken } from "../lib/web-auth.ts";

nextEnv.loadEnvConfig(process.cwd(),true,{info(){},error(){}});
const origin=process.env.HERMES_TEST_URL ?? "http://127.0.0.1:30141";
const output=join(tmpdir(),"hermes-cron-layout-qa");await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,channel:"msedge"});
try {
  const context=await browser.newContext({viewport:{width:1600,height:1000},reducedMotion:"reduce"});
  await context.addCookies([{name:"pi_web_session",value:createWebSessionToken(process.env.PI_WEB_PASSWORD),url:origin}]);
  const page=await context.newPage();
  const errors=[],writes=[];
  let saveFailure=false;
  let jobs=[
    {id:"release",name:"Hermes版本更新检测与发布变更整理",schedule:{kind:"cron",expr:"0 9 * * *"},profile:"default",paused:false,last_status:"delivery_failed",next_run_at:"2026-10-21T01:00:00Z",prompt:"检查正式发布版本，并整理变更记录。\n\n## 检查步骤\n\n1. 读取当前安装版本。\n2. 对比正式发布标签，忽略预览版本。\n3. 输出更新摘要和发布日期。\n\n```sh\nhermes --version\n```\n\n| 项目 | 内容 |\n| --- | --- |\n| 范围 | 正式发布 |\n\n"+"补充说明与检查结果。".repeat(50)},
    {id:"network",name:"Clash日本节点巡检",schedule:{kind:"cron",expr:"*/20 * * * *"},profile:"work",paused:true,last_status:"completed",prompt:"检查节点连通性。",workdir:"/workspace/project",model:"fixture-model",provider:"fixture-provider",skills:["network-check"],deliver:"local"},
    {id:"long",name:"A very long scheduled task name that must stay inside its selected row without covering any neighbouring task",schedule:{kind:"interval",minutes:30},paused:false,profile:"research-profile-with-a-long-name",prompt:"Long task."},
  ];
  page.on("pageerror",error=>errors.push(error.message));
  await page.route("**/api/hermes/**",route=>{
    const request=route.request(),url=new URL(request.url()),path=url.pathname.replace("/api/hermes","");
    let json={};
    if(path==="/api/status")json={version:"fixture"};
    else if(path==="/v1/models")json={data:[{id:"hermes-agent"}]};
    else if(path==="/api/sessions")json={sessions:[],total:0};
    else if(path==="/api/cron/jobs"){
      if(request.method()==="POST"){const body=request.postDataJSON();writes.push({path,method:"POST",body});jobs.push({...body,id:"new-task",profile:"default"});}
      json=jobs;
    }else if(path.startsWith("/api/cron/jobs/")){
      const id=path.split("/")[4],job=jobs.find(item=>item.id===id);
      if(request.method()!=="GET")writes.push({path,method:request.method(),profile:url.searchParams.get("profile"),body:request.postData()?request.postDataJSON():undefined});
      if(request.method()==="PUT"){
        if(saveFailure)return route.fulfill({status:500,json:{error:"Fixture save failed"}});
        Object.assign(job,request.postDataJSON().updates);
      }
      if(path.endsWith("/pause"))job.paused=true;
      if(path.endsWith("/resume"))job.paused=false;
      if(path.endsWith("/runs"))json={runs:[{id:"run-1",status:"completed",started_at:1792458000,output:"任务已完成。"}]};
      if(request.method()==="DELETE")jobs=jobs.filter(item=>item.id!==id);
    }
    return route.fulfill({json});
  });
  const cron=page.locator(".hermes-management.hermes-cron");
  const detail=cron.locator(".hermes-cron-detail");
  const editor=cron.getByRole("form");
  const openCron=async()=>{
    await page.goto(origin,{waitUntil:"networkidle"});
    await page.getByRole("navigation",{name:"主要导航",exact:true}).getByRole("button",{name:"定时任务",exact:true}).click();
    await cron.locator(".hermes-cron-task").first().waitFor();
  };
  const rowsFit=async()=>{
    assert.equal(await cron.locator(".hermes-cron-task").evaluateAll(rows=>rows.every((row,index)=>{
      const box=row.getBoundingClientRect();
      return box.height>=90 && (!index || rows[index-1].getBoundingClientRect().bottom<=box.top) && [...row.querySelectorAll(".hermes-cron-task-name, code, .hermes-cron-task-meta")].every(el=>{const rect=el.getBoundingClientRect();return rect.left>=box.left && rect.right<=box.right+1 && rect.bottom<=box.bottom;});
    })),true,"List rows contain all metadata without overlap");
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  };
  const actionsFit=async()=>{
    const heading=await detail.locator(".hermes-detail-heading").boundingBox();
    const info=await detail.locator(".config-detail-header-info").boundingBox();
    const edit=await detail.getByRole("button",{name:"编辑",exact:true}).boundingBox();
    assert.ok(Math.abs(edit.x+edit.width-heading.x-heading.width)<1,"Primary Edit aligns with the title row's right edge");
    assert.ok(info.x+info.width<=edit.x+1 || info.y+info.height<=edit.y+1,"Title and Edit never overlap");
    assert.equal(await detail.locator(".hermes-detail-toolbar").getByRole("button",{name:"编辑",exact:true}).count(),0);
    const secondary=await detail.locator(".hermes-detail-toolbar .config-detail-actions").boundingBox();
    const danger=await detail.getByRole("button",{name:"删除",exact:true}).boundingBox();
    assert.ok(danger.x+danger.width<=secondary.x+1 || danger.y+danger.height<=secondary.y+1,"Destructive and secondary groups stay separate");
  };
  await openCron();await rowsFit();
  await cron.getByRole("button",{name:/^Hermes版本更新检测/}).click();
  await detail.getByText("投递失败",{exact:true}).waitFor();
  await actionsFit();
  await page.screenshot({path:join(output,"desktop-detail.png")});
  await cron.getByRole("textbox",{name:"筛选",exact:true}).fill("no-such-task");
  await cron.getByText("没有匹配的任务",{exact:true}).waitFor();
  await cron.getByRole("textbox",{name:"筛选",exact:true}).fill("");
  await cron.getByRole("button",{name:/^Clash日本节点巡检/}).click();
  await detail.getByRole("button",{name:"恢复",exact:true}).click();
  await page.getByText("已恢复",{exact:true}).waitFor();
  assert.equal(writes.at(-1).profile,"work");
  await detail.getByRole("button",{name:"编辑",exact:true}).click();
  assert.equal(await editor.getByRole("textbox",{name:"执行计划",exact:true}).inputValue(),"*/20 * * * *");
  await editor.getByRole("textbox",{name:"名称",exact:true}).fill("网络巡检任务");
  await editor.getByText("高级选项",{exact:true}).click();
  assert.equal(await editor.getByRole("textbox",{name:"工作目录",exact:true}).inputValue(),"/workspace/project");
  await page.screenshot({path:join(output,"desktop-editor.png")});
  page.once("dialog",dialog=>dialog.dismiss());
  await cron.getByRole("button",{name:/^Hermes版本更新检测/}).click();
  assert.equal(await editor.getByRole("textbox",{name:"名称",exact:true}).inputValue(),"网络巡检任务");
  saveFailure=true;
  await editor.getByRole("button",{name:"保存任务",exact:true}).click();
  await cron.getByText("Fixture save failed",{exact:true}).waitFor();
  assert.equal(await editor.getByRole("textbox",{name:"名称",exact:true}).inputValue(),"网络巡检任务");
  saveFailure=false;
  await editor.getByRole("button",{name:"保存任务",exact:true}).click();
  await cron.getByText("定时任务已保存",{exact:true}).waitFor();
  const update=writes.filter(item=>item.method==="PUT").at(-1);
  assert.equal(update.profile,"work");assert.equal(update.body.updates.model,"fixture-model");assert.deepEqual(update.body.updates.skills,["network-check"]);
  await detail.getByRole("button",{name:"运行记录",exact:true}).click();
  await detail.getByText("任务已完成。",{exact:true}).waitFor();

  for(const [name,width,height,theme] of [["dark",1440,900,"dark"],["tablet",818,772,"light"],["mobile",390,844,"light"]]){
    await page.setViewportSize({width,height});
    await page.evaluate(theme=>localStorage.setItem("pi-theme",theme),theme);
    await openCron();await rowsFit();
    await cron.getByRole("button",{name:/^Hermes版本更新检测/}).click();
    await actionsFit();
    await page.screenshot({path:join(output,`${name}-detail.png`)});
    await detail.getByRole("button",{name:"编辑",exact:true}).click();
    await editor.getByRole("textbox",{name:"名称",exact:true}).waitFor();
    const footer=await editor.locator(".config-footer").boundingBox();
    const save=await editor.getByRole("button",{name:"保存任务",exact:true}).boundingBox();
    const cancel=await editor.getByRole("button",{name:"取消",exact:true}).boundingBox();
    assert.ok(cancel.x<save.x && Math.abs(save.x+save.width-footer.x-footer.width)<1,"Cancel/Save use the right-aligned footer");
    assert.equal(await editor.getByRole("textbox",{name:"名称",exact:true}).evaluate(el=>el.getBoundingClientRect().right<=innerWidth),true);
    await page.screenshot({path:join(output,`${name}-editor.png`)});
    await editor.getByRole("button",{name:"取消",exact:true}).click();
  }
  await detail.getByRole("button",{name:"返回任务列表",exact:true}).click();
  await cron.getByRole("button",{name:"新建任务",exact:true}).click();
  assert.equal(await editor.getByRole("button",{name:"保存任务",exact:true}).isDisabled(),true);
  await editor.getByRole("textbox",{name:"任务提示词",exact:true}).fill("New scheduled task");
  await editor.getByText("高级选项",{exact:true}).click();
  await editor.getByRole("switch",{name:"仅执行脚本",exact:true}).click();
  assert.equal(await editor.getByRole("button",{name:"保存任务",exact:true}).isDisabled(),true);
  await editor.getByRole("textbox",{name:"脚本（脚本目录内）",exact:true}).fill("check.py");
  await editor.getByRole("button",{name:"保存任务",exact:true}).click();
  await cron.getByText("定时任务已保存",{exact:true}).waitFor();
  assert.equal(writes.at(-1).body.no_agent,true);
  await editor.waitFor({state:"hidden"});
  // The settings dialog reuses the same layout at a smaller container width.
  await page.setViewportSize({width:1365,height:900});
  await page.getByRole("navigation",{name:"主要导航",exact:true}).getByRole("button",{name:"偏好与设置",exact:true}).click();
  const settings=page.getByRole("navigation",{name:"设置分类",exact:true});
  const destination=settings.getByRole("button",{name:"定时任务",exact:true,includeHidden:true});
  if(!await destination.isVisible())await settings.locator(".hermes-settings-menu-group").filter({has:page.getByRole("button",{name:"定时任务",exact:true,includeHidden:true})}).locator(".hermes-settings-group-toggle").click();
  await destination.click();
  await cron.getByRole("button",{name:/^Hermes版本更新检测/}).click();
  await detail.getByRole("button",{name:"编辑",exact:true}).click();
  await page.setViewportSize({width:818,height:772});
  await page.screenshot({path:join(output,"settings-editor.png")});
  assert.equal(await cron.locator(".config-sidebar").isVisible(),false);
  assert.equal(await editor.getByRole("textbox",{name:"名称",exact:true}).evaluate(el=>el.getBoundingClientRect().right<=innerWidth),true);
  await editor.getByRole("button",{name:"返回任务列表",exact:true}).click();
  assert.equal(await cron.locator(".config-sidebar").isVisible(),true);
  assert.deepEqual(errors,[]);
  console.log(`Cron list geometry, detail/editor, profile-scoped writes, validation/failure recovery and responsive themes passed. Fixtures only. Screenshots: ${output}`);
}finally{await browser.close();}
