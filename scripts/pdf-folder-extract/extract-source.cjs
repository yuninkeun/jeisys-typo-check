// Standalone PDF folder text extractor.
// Drag a folder onto the built .exe, or double-click it and paste a folder path.
// Recursively finds every .pdf under the folder and writes a CSV of extracted
// text (one row per page) into that same folder. No network access, no login
// — this never leaves the PC it runs on.

const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { pathToFileURL } = require("url");
const { PDFParse } = require("pdf-parse");

// pdf.js lazily loads a worker module at runtime via a relative dynamic
// import, which can't resolve once this script is bundled into one file or
// embedded in a packaged .exe. Point it at the copy we ship next to the
// bundle/executable instead (see build.cjs).
let sea = null;
try {
  sea = require("node:sea");
} catch {
  // not running under Node's Single Executable Application runtime
}
const baseDir = sea && sea.isSea() ? path.dirname(process.execPath) : __dirname;
PDFParse.setWorker(pathToFileURL(path.join(baseDir, "pdf.worker.mjs")).href);

function findPdfFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...findPdfFiles(fullPath));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".pdf")) {
      files.push(fullPath);
    }
  }
  return files;
}

function csvCell(value) {
  const str = String(value);
  return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

function toCsv(rows) {
  const lines = [["파일명", "상대경로", "페이지", "텍스트"].join(",")];
  for (const row of rows) {
    lines.push(
      [row.fileName, row.relativePath, row.page, row.text].map(csvCell).join(","),
    );
  }
  return lines.join("\r\n");
}

function askFolderPath() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question("PDF가 들어있는 폴더 경로를 입력하세요 (또는 이 프로그램에 폴더를 끌어다 놓고 실행하세요): ", (answer) => {
      rl.close();
      resolve(answer.trim().replace(/^"|"$/g, ""));
    });
  });
}

function waitForExit() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question("\n작업이 끝났습니다. Enter 키를 누르면 창이 닫힙니다...", () => {
      rl.close();
      resolve();
    });
  });
}

async function main() {
  console.log("=== PDF 폴더 일괄 텍스트 추출 ===\n");

  let folderPath = process.argv[2];
  if (!folderPath) {
    folderPath = await askFolderPath();
  }

  if (!folderPath) {
    console.error("폴더 경로가 비어 있습니다.");
    await waitForExit();
    process.exit(1);
  }

  let stat;
  try {
    stat = fs.statSync(folderPath);
  } catch {
    console.error(`해당 경로를 찾을 수 없습니다: ${folderPath}`);
    await waitForExit();
    process.exit(1);
  }
  if (!stat.isDirectory()) {
    console.error("폴더 경로가 아닙니다. 폴더를 지정해 주세요.");
    await waitForExit();
    process.exit(1);
  }

  const pdfFiles = findPdfFiles(folderPath);
  if (pdfFiles.length === 0) {
    console.error("폴더(하위 폴더 포함) 안에서 PDF 파일을 찾지 못했습니다.");
    await waitForExit();
    process.exit(1);
  }

  console.log(`PDF ${pdfFiles.length}개를 찾았습니다. 추출을 시작합니다...\n`);

  const rows = [];
  const failedFiles = [];

  for (const [index, filePath] of pdfFiles.entries()) {
    const relativePath = path.relative(folderPath, filePath);
    console.log(`[${index + 1}/${pdfFiles.length}] ${relativePath}`);
    const parser = new PDFParse({ data: fs.readFileSync(filePath) });
    try {
      const result = await parser.getText();
      for (const page of result.pages) {
        rows.push({
          fileName: path.basename(filePath),
          relativePath,
          page: page.num,
          text: page.text,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "텍스트 추출에 실패했습니다.";
      console.error(`  실패: ${message}`);
      failedFiles.push({ file: relativePath, error: message });
    } finally {
      await parser.destroy();
    }
  }

  if (rows.length === 0) {
    console.error("\n모든 PDF에서 텍스트 추출에 실패했습니다.");
    await waitForExit();
    process.exit(1);
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outputPath = path.join(folderPath, `pdf-text-extract_${timestamp}.csv`);
  // BOM so Excel on Windows opens the Korean text as UTF-8 instead of mangling it.
  fs.writeFileSync(outputPath, "﻿" + toCsv(rows), "utf-8");

  console.log(`\n완료: ${pdfFiles.length - failedFiles.length}개 파일, ${rows.length}개 페이지 추출`);
  if (failedFiles.length > 0) {
    console.log(`실패: ${failedFiles.length}개`);
    for (const f of failedFiles) console.log(`  - ${f.file}: ${f.error}`);
  }
  console.log(`결과 파일: ${outputPath}`);

  await waitForExit();
}

main().catch(async (err) => {
  console.error("예상치 못한 오류:", err);
  await waitForExit();
  process.exit(1);
});
