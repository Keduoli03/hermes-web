import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { dropMentionText, splitDroppedItems, uploadFiles } = await jiti.import("./file-upload-client.ts");

const file = (name, type = "") => new File(["x"], name, { type });

test("a chat drop attaches images, uploads other files, and leaves folders out", () => {
  const photo = file("photo.png", "image/png");
  const notes = file("notes.md", "text/markdown");
  const data = file("data.bin");
  const result = splitDroppedItems([
    { kind: "file", file: photo },
    { kind: "file", file: notes },
    { kind: "folder", name: "src" },
    { kind: "file", file: data },
  ]);
  assert.deepEqual(result.images, [photo]);
  assert.deepEqual(result.files, [notes, data]);
  assert.deepEqual(result.folders, ["src"]);
});

test("mentions follow the drop order and only name files now in the working directory", () => {
  const files = [file("b.txt"), file("my notes.md"), file("failed.log"), file("a.txt")];
  assert.equal(
    dropMentionText(files, ["a.txt", "my notes.md", "b.txt"]),
    '@b.txt @"my notes.md" @a.txt ',
  );
  assert.equal(dropMentionText(files, []), "");
});

test("cancelling an attachment upload aborts its transport and settled uploads remove the listener", async () => {
  const previous = globalThis.XMLHttpRequest, instances = [];
  globalThis.XMLHttpRequest = class {
    upload = {}; aborted = 0; status = 200; responseText = '{"uploaded":["file.txt"]}';
    constructor() { instances.push(this); }
    open() {} send() {}
    abort() { this.aborted++; this.onabort(); }
  };
  try {
    const first = new AbortController();
    const cancelled = uploadFiles("/project", [file("file.txt")], "skip", undefined, first.signal);
    first.abort();
    await assert.rejects(cancelled, /cancelled/);
    assert.equal(instances[0].aborted, 1);
    const second = new AbortController();
    const completed = uploadFiles("/project", [file("file.txt")], "skip", undefined, second.signal);
    instances[1].onload();
    assert.equal((await completed).status, 200);
    second.abort();
    assert.equal(instances[1].aborted, 0);
  } finally { globalThis.XMLHttpRequest = previous; }
});
