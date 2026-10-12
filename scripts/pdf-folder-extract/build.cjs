// Rebuilds pdf-folder-extract.exe from extract-source.cjs.
// Run with: node scripts/pdf-folder-extract/build.cjs
// Requires network access once, to fetch esbuild/postject via npx.

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const dir = __dirname;
const run = (cmd, args) =>
  execFileSync(cmd, args, { cwd: dir, stdio: "inherit", shell: true });

console.log("1/4 bundling extract-source.cjs...");
run("npx", [
  "--yes", "esbuild",
  "extract-source.cjs",
  "--bundle",
  "--platform=node",
  "--target=node20",
  "--outfile=extract-bundle.cjs",
]);

console.log("2/4 writing SEA blob...");
fs.rmSync(path.join(dir, "sea-prep.blob"), { force: true });
run("node", ["--experimental-sea-config", "sea-config.json"]);

console.log("3/4 copying node.exe...");
const exePath = path.join(dir, "pdf-folder-extract.exe");
fs.rmSync(exePath, { force: true });
fs.copyFileSync(process.execPath, exePath);

console.log("4/4 injecting blob...");
run("npx", [
  "--yes", "postject",
  "pdf-folder-extract.exe",
  "NODE_SEA_BLOB",
  "sea-prep.blob",
  "--sentinel-fuse", "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
]);

console.log("\nDone: pdf-folder-extract.exe (ship it together with pdf.worker.mjs in this folder)");
