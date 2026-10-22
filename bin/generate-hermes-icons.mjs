import sharp from "sharp";
import { copyFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const source = fileURLToPath(new URL("public/icons/hermes-avatar.png", root));
for (const [name, size] of [["hermes-icon-32.png", 32], ["hermes-icon-192.png", 192], ["hermes-icon-512.png", 512], ["hermes-apple-touch-icon.png", 180]]) {
  await sharp(source).resize(size, size, { fit: "contain" }).png().toFile(fileURLToPath(new URL(`public/icons/${name}`, root)));
}
// Keep older notification/offline URLs pointing at the same identity.
for (const [name, alias] of [["hermes-icon-192.png", "icon-192.png"], ["hermes-icon-512.png", "icon-512.png"], ["hermes-apple-touch-icon.png", "apple-touch-icon.png"]]) {
  await copyFile(new URL(`public/icons/${name}`, root), new URL(`public/icons/${alias}`, root));
}
console.log("Hermes browser and PWA icons generated.");
