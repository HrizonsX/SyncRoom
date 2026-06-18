import { mkdir, copyFile } from "node:fs/promises";
import path from "node:path";

const rootDir = path.resolve(import.meta.dirname, "..");
const distDir = path.join(rootDir, "dist");

await mkdir(distDir, { recursive: true });
await Promise.all([
  copyFile(
    path.join(rootDir, "public", "index.html"),
    path.join(distDir, "index.html"),
  ),
  copyFile(
    path.join(rootDir, "src", "styles.css"),
    path.join(distDir, "styles.css"),
  ),
]);
