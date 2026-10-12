// Rebuilds the pdf-folder-extract distribution folder from extract-source.cjs.
// Run with: node scripts/pdf-folder-extract/build.cjs
// Requires network access once, to fetch esbuild via npx.
//
// Ships the *unmodified* node.exe (so its signature stays valid and it
// doesn't look like a repacked binary to antivirus/EDR) alongside a plain
// run.bat launcher, instead of injecting our code into a copy of node.exe
// (that approach got flagged/killed by endpoint security on other PCs).

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const dir = __dirname;
const run = (cmd, args) =>
  execFileSync(cmd, args, { cwd: dir, stdio: "inherit", shell: true });

console.log("1/3 bundling extract-source.cjs...");
run("npx", [
  "--yes", "esbuild",
  "extract-source.cjs",
  "--bundle",
  "--platform=node",
  "--target=node20",
  "--outfile=extract-bundle.cjs",
]);

console.log("2/3 copying unmodified node.exe...");
fs.copyFileSync(process.execPath, path.join(dir, "node.exe"));

console.log("3/3 writing run.bat...");
fs.writeFileSync(
  path.join(dir, "run.bat"),
  '@echo off\r\n"%~dp0node.exe" "%~dp0extract-bundle.cjs" %1\r\npause\r\n',
);

console.log(
  "\nDone. Distribute node.exe, run.bat, extract-bundle.cjs, and pdf.worker.mjs together.",
);
