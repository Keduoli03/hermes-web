import assert from "node:assert/strict";
import { chromium } from "playwright";
import nextEnv from "@next/env";
import { createWebSessionToken, revokeWebSessionToken } from "../lib/web-auth.ts";

nextEnv.loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
const origin = process.env.HERMES_TEST_URL ?? "http://127.0.0.1:30141";
const browser = await chromium.launch({ headless: true, channel: "msedge" });
const context = await browser.newContext({ viewport: { width: 1365, height: 900 } });
const token = createWebSessionToken(process.env.PI_WEB_PASSWORD);
await context.addCookies([{ name: "pi_web_session", value: token, url: origin }]);
const page = await context.newPage(), errors = [], writes = [];
page.on("pageerror", error => errors.push(error.message));
const endpoints = [
  { id: "custom-a", name: "Provider A", base_url: "https://a.example.test/v1", model: "shared-model", models: ["shared-model", "next-model"] },
  { id: "custom-b", name: "Provider B", base_url: "https://b.example.test/v1", model: "shared-model", models: ["shared-model", "next-model"] },
];
const sessions = [{ id: "session-a", title: "Conversation A" }, { id: "session-b", title: "Conversation B" }];
await page.route("**/api/hermes/**", async route => {
  const request = route.request(), url = new URL(request.url()), path = url.pathname.replace("/api/hermes", "");
  if (request.method() !== "GET") writes.push(path);
  let json = {};
  if (path === "/api/status") json = { version: "fixture" };
  else if (path === "/v1/models") json = { data: [{ id: "wrong-api-first-model" }] };
  else if (path === "/api/sessions") json = { sessions, total: 2 };
  else if (path === "/api/providers/custom-endpoints") json = { endpoints };
  else if (path === "/api/model/options") {
    assert.equal(url.searchParams.get("explicit_only"), "1");
    await new Promise(resolve => setTimeout(resolve, 100));
    json = { model: "shared-model", provider: "custom-a", providers: endpoints.map(row => ({ slug: row.id, name: row.name, models: row.models, is_user_defined: true })) };
  } else if (path === "/api/providers/oauth") json = { providers: [] };
  else if (path.endsWith("/messages")) json = { messages: [] };
  else if (path.startsWith("/api/sessions/")) {
    const id = path.split("/").at(-1);
    json = { id, model: "shared-model", model_config: JSON.stringify({ provider: id === "session-a" ? "custom-a" : "custom-b" }) };
  }
  await route.fulfill({ json });
});
const openModels = async () => {
  await page.waitForFunction(() => { const row = document.querySelector(".hermes-session"); return row && !row.disabled; });
  await page.getByRole("navigation", { name: "工作区设置", exact: true }).getByRole("button", { name: "模型", exact: true }).click();
  await page.getByRole("region", { name: "Provider A", exact: true }).waitFor();
};
const active = async (provider, model) => {
  await page.getByRole("region", { name: provider, exact: true }).locator(".is-current").waitFor();
  assert.equal(await page.locator(".hermes-model-current strong").textContent(), model);
};
try {
  await page.goto(origin);
  await openModels(); await active("Provider A", "shared-model");
  await page.getByRole("region", { name: "Provider B", exact: true }).getByRole("button", { name: "next-model", exact: true }).click();
  await page.reload(); await openModels(); await active("Provider B", "next-model");
  await page.getByRole("button", { name: "关闭设置", exact: true }).click();
  await page.locator(".hermes-session").filter({ hasText: "Conversation A" }).click();
  await openModels(); await active("Provider A", "shared-model");
  await page.getByRole("region", { name: "Provider A", exact: true }).getByRole("button", { name: "next-model", exact: true }).click();
  await page.reload(); await openModels(); await active("Provider A", "next-model");
  await page.getByRole("button", { name: "关闭设置", exact: true }).click();
  await page.locator(".hermes-session").filter({ hasText: "Conversation B" }).click();
  await openModels(); await active("Provider B", "shared-model");
  await page.getByRole("button", { name: "关闭设置", exact: true }).click();
  await page.locator(".hermes-session").filter({ hasText: "Conversation A" }).click();
  await openModels(); await active("Provider A", "next-model");
  assert.deepEqual(writes, [], "Picking/restoring models must not mutate global configuration or start an inference");
  assert.deepEqual(errors, []);
  console.log("PASS: configured startup default, new-chat reload, per-session reload/switch isolation, duplicate-model provider identity, and no configuration/model-run writes. Fixtures only.");
} finally { await browser.close(); revokeWebSessionToken(token); }
