import { cpSync, mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const outDir = join(root, "www");

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

["index.html", "styles.css", "app.js", "manifest.webmanifest", "sw.js"].forEach((file) => {
  cpSync(join(root, file), join(outDir, file));
});

cpSync(join(root, "assets"), join(outDir, "assets"), { recursive: true });

console.log("www resources prepared");
