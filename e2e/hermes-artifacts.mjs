// Fixture-only media and cross-session browsing against an existing dev server.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import nextEnv from "@next/env";
import { createWebSessionToken } from "../lib/web-auth.ts";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { collectHermesArtifacts } from "../lib/hermes-artifacts.ts";

nextEnv.loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
const origin = process.env.HERMES_TEST_URL ?? "http://127.0.0.1:30142";
const browser = await chromium.launch({ headless: true, ...(process.env.HERMES_TEST_BROWSER ? { channel: process.env.HERMES_TEST_BROWSER } : {}) });
const context = await browser.newContext({ viewport: { width: 1365, height: 900 }, reducedMotion: "reduce" });
await context.addCookies([{ name: "pi_web_session", value: createWebSessionToken(process.env.PI_WEB_PASSWORD), url: origin }]);
const page = await context.newPage();
const errors = [];
page.on("pageerror", error => errors.push(error.message));
const media = await page.evaluate(async () => {
  const canvas = document.createElement("canvas"); canvas.width = 640; canvas.height = 400;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#164e3b"; ctx.fillRect(0, 0, 640, 400);
  ctx.fillStyle = "#e5bd67"; ctx.fillRect(50, 50, 240, 300);
  ctx.fillStyle = "#d8ebe5"; ctx.beginPath(); ctx.arc(440, 170, 100, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#fff"; ctx.font = "24px sans-serif"; ctx.fillText("Generated media fixture", 325, 340);
  const png = canvas.toDataURL("image/png").split(",")[1];
  const stream = canvas.captureStream(10);
  const recorder = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp8" });
  const chunks = [];
  recorder.ondataavailable = event => chunks.push(event.data);
  const stopped = new Promise(resolve => { recorder.onstop = resolve; });
  recorder.start();
  const animation = setInterval(() => { ctx.fillStyle = "#c36270"; ctx.fillRect(350 + Math.random() * 60, 250, 16, 16); }, 40);
  await new Promise(resolve => setTimeout(resolve, 700));
  clearInterval(animation); recorder.stop(); await stopped; stream.getTracks().forEach(track => track.stop());
  return { png, video: [...new Uint8Array(await new Blob(chunks, { type: "video/webm" }).arrayBuffer())] };
});
const png = Buffer.from(media.png, "base64");
const video = process.env.HERMES_TEST_VIDEO_FIXTURE ? await readFile(process.env.HERMES_TEST_VIDEO_FIXTURE) : Buffer.from(media.video);
const wav = Buffer.alloc(4044);
wav.write("RIFF", 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(wav.length - 44, 40);
const sessions = [{ id: "media-one", title: "插画生成", message_count: 105 }, { id: "video-two", title: "短片制作", message_count: 2 }, { id: "unreadable", title: "不可用会话", message_count: 1 }];
const history = [
  { role: "assistant", content: "```html output.html\n<h1>Sandbox preview</h1><script>parent.document.body.dataset.artifactUnsafe='yes'</script>\n```" },
  ...Array.from({ length: 99 }, () => ({ role: "system", content: "fixture padding" })),
  { role: "tool", tool_name: "image_generate", content: JSON.stringify({ image: "/tmp/artwork.png" }) },
  { role: "tool", tool_name: "text_to_speech", content: JSON.stringify({ output_path: "/tmp/voice.wav" }) },
  { role: "assistant", content: "MEDIA:/tmp/missing.png" },
  { role: "assistant", content: "Media finished." },
];
const messageRequests = [];
let indexRequests = 0;
await page.route("**/api/hermes-artifacts*", async route => {
  indexRequests++;
  await route.fulfill({ json: { sessions, failed: 1, artifacts: [
    ...collectHermesArtifacts(sessions[0], [...history, { role: "assistant", content: "[Report](/tmp/report.md)" }]),
    ...collectHermesArtifacts(sessions[1], [{ role: "assistant", content: 'MEDIA:"/tmp/clip.webm"' }]),
  ] } });
});
let versions = [];
await page.route("**/api/hermes-artifacts/versions**", async route => {
  const request = route.request(), url = new URL(request.url());
  if (url.searchParams.has("version")) { await route.fulfill({ contentType: "application/octet-stream", headers: { "Content-Disposition": 'attachment; filename="artwork.png"' }, body: png }); return; }
  if (request.method() === "POST") versions = [{ id: "fixture-version", title: "artwork.png", size: png.length, createdAt: "2026-10-15T00:00:00Z" }];
  if (request.method() === "DELETE") versions = [];
  await route.fulfill({ json: request.method() === "GET" ? { versions } : { ok: true } });
});
await page.route("**/api/hermes/**", async route => {
  const req = route.request(); const url = new URL(req.url()); const path = url.pathname.replace("/api/hermes", "");
  let body = {};
  if (path === "/api/status" || path === "/health") body = { version: "fixture", gateway_running: true };
  else if (path === "/api/sessions") {
    assert.ok(Number(url.searchParams.get("limit")) <= 100, "Hermes session page maximum is 100");
    body = { sessions: Number(url.searchParams.get("offset")) ? [] : sessions, total: sessions.length };
  } else if (path.endsWith("/latest-descendant")) body = { session_id: "media-one" };
  else if (path.endsWith("/messages")) {
    messageRequests.push({ path, query: url.searchParams.toString() });
    assert.ok(Number(url.searchParams.get("limit")) <= 100);
    if (path.includes("unreadable")) { await route.fulfill({ status: 503, json: { detail: "fixture unavailable" } }); return; }
    const rows = path.includes("video-two") ? [{ role: "assistant", content: 'MEDIA:"/tmp/clip.webm"' }] : history;
    const limit = Number(url.searchParams.get("limit")); const offset = Number(url.searchParams.get("offset"));
    body = { messages: url.searchParams.get("order") === "latest" ? rows.slice(-limit) : rows.slice(offset, offset + limit) };
  } else if (path === "/api/sessions/media-one") body = { ...sessions[0], model: "test-model" };
  else if (path === "/v1/models") body = { data: [{ id: "test-model" }] };
  else if (path === "/api/model/options") body = { options: [], current_model: "test-model" };
  else if (path === "/api/files/stream" || path === "/api/files/download") {
    const file = url.searchParams.get("path");
    const bytes = file === "/tmp/artwork.png" ? png : file === "/tmp/clip.webm" ? video : file === "/tmp/voice.wav" ? wav : null;
    if (!bytes) { await route.fulfill({ status: 404, json: { detail: "File not found" } }); return; }
    const contentType = file.endsWith("png") ? "image/png" : file.endsWith("wav") ? "audio/wav" : "video/webm";
    const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers().range ?? "");
    const start = range ? Number(range[1]) : 0; const end = range?.[2] ? Math.min(Number(range[2]), bytes.length - 1) : bytes.length - 1;
    await route.fulfill({ status: range ? 206 : 200, contentType, headers: { "accept-ranges": "bytes", ...(range ? { "content-range": `bytes ${start}-${end}/${bytes.length}` } : {}), ...(path.endsWith("download") ? { "content-disposition": `attachment; filename="${file.split("/").pop()}"` } : {}) }, body: bytes.subarray(start, end + 1) }); return;
  } else if (path === "/api/media") { await route.fulfill({ status: 404, json: { detail: "File not found" } }); return; }
  await route.fulfill({ json: body });
});
const out = join(tmpdir(), "hermes-web-qa"); await mkdir(out, { recursive: true });
try {
  await page.goto(`${origin}/?session=media-one`);
  const rail = page.getByRole("navigation", { name: "主要导航", exact: true });
  await page.getByText("Media finished.", { exact: true }).waitFor();
  await rail.getByRole("button", { name: "产物", exact: true }).click();
  const artifacts = page.getByRole("region", { name: "产物", exact: true });
  const list = artifacts.getByRole("list", { name: "会话产物列表", exact: true });
  const scopes = artifacts.getByRole("combobox", { name: "产物会话范围" });
  const types = artifacts.getByRole("navigation", { name: "产物类型" });
  const dialog = artifacts.getByRole("dialog", { name: "产物预览" });
  await artifacts.getByText("有 1 个会话读取失败，已显示其余结果。", { exact: true }).waitFor();
  assert.equal(await scopes.inputValue(), "all");
  assert.equal(await list.getByRole("listitem").count(), 6);
  assert.ok((await artifacts.locator(".hermes-artifacts-header").boundingBox()).height < 125);
  const imageCard = list.getByRole("listitem", { name: "artwork.png", exact: true });
  await imageCard.locator("img").evaluate(image => image.complete && image.naturalWidth > 0 || new Promise(resolve => image.addEventListener("load", resolve, { once: true })));
  assert.equal(await imageCard.locator("img").evaluate(image => image.naturalWidth), 640);
  await page.screenshot({ path: join(out, "artifacts-gallery-desktop.png") });
  await imageCard.getByRole("button", { name: "预览 artwork.png", exact: true }).click();
  await dialog.locator("img").evaluate(image => image.complete && image.naturalWidth > 0 || new Promise(resolve => image.addEventListener("load", resolve, { once: true })));
  await page.screenshot({ path: join(out, "artifacts-image-desktop.png") });
  await dialog.getByRole("button", { name: "版本记录", exact: true }).click();
  await dialog.getByRole("button", { name: "保存当前版本", exact: true }).click();
  await dialog.getByRole("link", { name: "下载版本", exact: true }).waitFor();
  const versionDownload = page.waitForEvent("download");
  await dialog.getByRole("link", { name: "下载版本", exact: true }).click();
  assert.equal((await versionDownload).suggestedFilename(), "artwork.png");
  page.once("dialog", prompt => prompt.accept());
  await dialog.getByRole("button", { name: "删除版本", exact: true }).click();
  await dialog.getByRole("link", { name: "下载版本", exact: true }).waitFor({ state: "detached" });
  await dialog.getByRole("button", { name: "下一个产物" }).click();
  await dialog.locator("audio").waitFor();
  await page.keyboard.press("Escape");
  assert.equal(await dialog.count(), 0);
  assert.equal(await imageCard.getByRole("button", { name: "预览 artwork.png", exact: true }).evaluate(button => button === document.activeElement), true);
  await list.getByRole("button", { name: "预览 output.html", exact: true }).click();
  await dialog.frameLocator("iframe").getByRole("heading", { name: "Sandbox preview" }).waitFor();
  assert.equal(await dialog.locator("iframe").getAttribute("sandbox"), "");
  assert.equal(await page.evaluate(() => document.body.dataset.artifactUnsafe), undefined);
  await dialog.getByRole("button", { name: "关闭预览" }).click();
  await list.getByRole("button", { name: "预览 voice.wav", exact: true }).click();
  await dialog.locator("audio").evaluate(audio => audio.readyState >= 1 || new Promise(resolve => audio.addEventListener("loadedmetadata", resolve, { once: true })));
  assert.ok(await dialog.locator("audio").evaluate(audio => audio.duration > 0));
  await dialog.getByRole("button", { name: "关闭预览" }).click();
  await list.getByRole("button", { name: "预览 missing.png", exact: true }).click();
  await dialog.getByText(/无法预览此产物/).waitFor();
  await dialog.getByRole("button", { name: "关闭预览" }).click();
  await page.route("**/api/hermes/api/files/stream?path=*report.md", route => route.fulfill({ contentType: "text/markdown", body: "# Generated report\n\n**Readable document**\n\n| Item | Status |\n| --- | --- |\n| Preview | Ready |\n\n<script>window.artifactUnsafe=true</script>" }));
  await list.getByRole("button", { name: "预览 report.md", exact: true }).click();
  await dialog.getByRole("heading", { name: "Generated report" }).waitFor();
  await dialog.getByRole("table").waitFor();
  assert.equal(await dialog.locator("script").count(), 0);
  await dialog.getByRole("button", { name: "查看源码", exact: true }).click();
  await dialog.locator("pre").getByText(/# Generated report/).waitFor();
  await dialog.getByRole("button", { name: "预览", exact: true }).click();
  await page.screenshot({ path: join(out, "artifacts-markdown-desktop.png") });
  await dialog.getByRole("button", { name: "关闭预览" }).click();
  const beforeScopeChange = indexRequests;
  await scopes.selectOption("current");
  await page.waitForFunction(() => document.querySelectorAll(".hermes-artifact-card").length === 5);
  await scopes.selectOption("session:video-two");
  assert.equal(indexRequests, beforeScopeChange, "scope changes filter the loaded index without network reads");
  await list.getByRole("button", { name: "预览 clip.webm", exact: true }).click();
  const player = dialog.locator("video");
  await page.waitForFunction(() => {
    const player = document.querySelector("dialog[open] video");
    if (player?.error) throw new Error(player.error.message);
    return player?.readyState >= 1;
  });
  assert.ok(await player.evaluate(video => video.videoWidth > 0 && video.videoHeight > 0));
  await player.evaluate(video => video.play());
  await page.waitForFunction(() => document.querySelector("dialog[open] video")?.currentTime > 0);
  await player.evaluate(video => video.pause());
  await page.screenshot({ path: join(out, "artifacts-video-desktop.png") });
  const downloadEvent = page.waitForEvent("download"); await dialog.getByRole("button", { name: "下载产物", exact: true }).click();
  assert.equal((await downloadEvent).suggestedFilename(), "clip.webm");
  await dialog.getByRole("button", { name: "关闭预览" }).click();
  await scopes.selectOption("all");
  await artifacts.getByText("有 1 个会话读取失败，已显示其余结果。", { exact: true }).waitFor();
  assert.equal(await list.getByRole("listitem").count(), 6);
  assert.match(await list.getByRole("listitem", { name: "clip.webm", exact: true }).textContent(), /短片制作/);
  await types.getByRole("button", { name: "图片", exact: true }).click();
  assert.equal(await list.getByRole("listitem").count(), 2);
  await artifacts.getByRole("textbox", { name: "搜索产物" }).fill("no matching output");
  await artifacts.getByText("没有匹配的产物").first().waitFor(); assert.equal(await artifacts.locator("img,video,audio,iframe").count(), 0);
  await artifacts.getByRole("textbox", { name: "搜索产物" }).fill("");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: join(out, "artifacts-gallery-mobile.png") });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  const boxes = await artifacts.locator(".hermes-artifacts-toolbar,.hermes-artifacts-controls,.hermes-artifact-card").evaluateAll(items => items.map(item => { const rect = item.getBoundingClientRect(); return { x: rect.x, width: rect.width }; }));
  assert.ok(boxes.every(box => box.x >= 0 && box.x + box.width <= 391));
  await imageCard.getByRole("button", { name: "预览 artwork.png", exact: true }).click();
  await page.screenshot({ path: join(out, "artifacts-image-mobile.png") });
  await dialog.getByRole("button", { name: "关闭预览" }).click();
  await page.setViewportSize({ width: 1365, height: 900 });
  await rail.getByRole("button", { name: "首页", exact: true }).click();
  await page.getByText("Media finished.", { exact: true }).waitFor();
  assert.match(page.url(), /session=media-one/);
  await page.goto(origin);
  await page.getByRole("button", { name: "新建对话", exact: true }).click();
  await rail.getByRole("button", { name: "产物", exact: true }).click();
  await artifacts.getByText("有 1 个会话读取失败，已显示其余结果。", { exact: true }).waitFor();
  assert.equal(await scopes.inputValue(), "all");
  assert.equal(await scopes.locator('option[value="current"]').evaluate(option => option.disabled), true);
  assert.deepEqual(errors, []);
  console.log("PASS: default all-session gallery, session dropdown without refetch, Markdown/source preview, thumbnails, media playback/download, modal focus/navigation, sandbox and mobile layout");
} catch (error) { await page.screenshot({ path: join(out, "artifacts-failure.png") }); throw error; }
finally { await browser.close(); }
