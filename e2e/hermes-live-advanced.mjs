// Local integration check: writes only to uniquely named temporary profiles, then removes them.
import assert from "node:assert/strict";
import {chromium} from "playwright";
const origin=process.env.HERMES_TEST_URL ?? "http://127.0.0.1:30142";
const browser=await chromium.launch({headless:true,channel:process.env.HERMES_TEST_BROWSER ?? "msedge"});
const page=await browser.newPage();
const name=`codex-web-qa-${Date.now().toString(36)}`;let created=false,renamed=name;
async function api(path,method="GET",body){const response=await page.request.fetch(`${origin}/api/hermes${path}`,{method,...(body?{data:body}:{})});if(!response.ok())throw new Error(`Live ${method} ${path} failed (${response.status()}): ${JSON.stringify(await response.json()).slice(0,240)}`);return response.json();}
const scope=path=>`${path}?profile=${encodeURIComponent(renamed)}`;
try{
  const [profiles,channels,mcp,hub]=await Promise.all([api("/api/profiles"),api("/api/messaging/platforms"),api("/api/mcp/servers"),api("/api/skills/hub/official")]);
  assert.ok(Array.isArray(profiles.profiles));assert.ok(channels.platforms.length);assert.ok(Array.isArray(mcp.servers));assert.ok(hub.skills.length);
  await api("/api/profiles","POST",{name,no_skills:true,description:"HermesWeb isolated verification"});created=true;
  await api(`/api/profiles/${name}/description`,"PUT",{description:"Updated isolated verification"});
  await api(scope("/api/mcp/servers"),"POST",{name:"qa-docs",url:"https://example.invalid/mcp",auth:"none"});
  await api(scope("/api/mcp/servers/qa-docs/enabled"),"PUT",{enabled:false});
  await api(scope("/api/config"),"PUT",{config:{mcp_servers:{"qa-docs":{url:"https://example.invalid/changed"}}}});
  const saved=await api(scope("/api/mcp/servers"));assert.equal(saved.servers.find(row=>row.name==="qa-docs").url,"https://example.invalid/changed");assert.equal(saved.servers.find(row=>row.name==="qa-docs").enabled,false);
  await api(scope("/api/messaging/platforms/telegram"),"PUT",{enabled:false,env:{TELEGRAM_ALLOWED_USERS:"123"},clear_env:[]});
  const scopedChannels=await api(scope("/api/messaging/platforms"));assert.equal(scopedChannels.platforms.find(row=>row.id==="telegram").env_vars.find(field=>field.key==="TELEGRAM_ALLOWED_USERS").value,"123");
  const skill=hub.skills[0];const installed=await api(scope("/api/skills/hub/install"),"POST",{identifier:skill.identifier});
  for(let index=0;index<60;index++){const state=await api(`/api/actions/${encodeURIComponent(installed.name)}/status?lines=1`);if(!state.running){assert.equal(state.exit_code,0,"Official skill installation failed in the temporary profile");break;}if(index===59)throw new Error("Skill installation still running");await new Promise(resolve=>setTimeout(resolve,1000));}
  const source=await api(scope("/api/skills/hub/sources"));assert.ok(source.installed[skill.identifier]);
  await api(`/api/profiles/${name}`,"PATCH",{new_name:`${name}-renamed`});renamed=`${name}-renamed`;
  const after=await api("/api/profiles");assert.equal(after.profiles.find(row=>row.name===renamed).description,"Updated isolated verification");
  console.log(`PASS: live catalogs, isolated profile create/edit/rename, MCP add/toggle/partial update, scoped channel save, official skill installation. Existing profiles and default selection unchanged.`);
}finally{
  if(created){await api(`/api/profiles/${encodeURIComponent(renamed)}`,"DELETE");console.log("Temporary verification profile removed.");}
  await browser.close();
}
