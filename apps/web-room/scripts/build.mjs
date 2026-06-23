import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");

await mkdir(path.join(distDir, "src"), { recursive: true });

await build({
  entryPoints: [path.join(rootDir, "src", "index.ts")],
  bundle: true,
  format: "esm",
  target: ["chrome120", "firefox121", "safari17"],
  outfile: path.join(distDir, "src", "index.js"),
  sourcemap: true,
});
