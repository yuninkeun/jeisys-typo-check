"use server";

import { promises as fs } from "node:fs";
import path from "node:path";
import { PDFParse } from "pdf-parse";
import { createClient } from "@/lib/supabase/server";

async function assertSignedIn() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("로그인이 필요합니다.");
  return user;
}

export type BatchState = {
  error?: string;
  result?: {
    folder: string;
    outputPath: string;
    fileCount: number;
    pageCount: number;
    failedFiles: { file: string; error: string }[];
  };
};

type BatchRow = {
  fileName: string;
  relativePath: string;
  page: number;
  text: string;
};

async function findPdfFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await findPdfFiles(fullPath)));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".pdf")) {
      files.push(fullPath);
    }
  }
  return files;
}

function csvCell(value: string | number): string {
  const str = String(value);
  return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

function toCsv(rows: BatchRow[]): string {
  const lines = [["파일명", "상대경로", "페이지", "텍스트"].join(",")];
  for (const row of rows) {
    lines.push(
      [row.fileName, row.relativePath, row.page, row.text]
        .map(csvCell)
        .join(","),
    );
  }
  return lines.join("\r\n");
}

/** Only meaningful on `next dev` against the reviewer's own PC — a Vercel
 *  deployment has no access to a local folder path, so refuse up front
 *  instead of failing confusingly deep inside an fs call. */
function assertLocalEnvironment() {
  if (process.env.VERCEL) {
    throw new Error(
      "이 기능은 로컬(next dev) 실행 환경에서만 사용할 수 있습니다. 배포된 사이트에서는 서버가 PC의 폴더에 접근할 수 없습니다.",
    );
  }
}

export async function extractFolderToCsv(
  _prev: BatchState,
  formData: FormData,
): Promise<BatchState> {
  await assertSignedIn();

  try {
    assertLocalEnvironment();
  } catch (err) {
    return { error: err instanceof Error ? err.message : "실행할 수 없습니다." };
  }

  const folderPath = String(formData.get("folderPath") ?? "").trim();
  if (!folderPath) {
    return { error: "폴더 경로를 입력해 주세요." };
  }

  let stat;
  try {
    stat = await fs.stat(folderPath);
  } catch {
    return { error: "해당 경로를 찾을 수 없습니다. 경로를 다시 확인해 주세요." };
  }
  if (!stat.isDirectory()) {
    return { error: "폴더 경로가 아닙니다. 폴더를 지정해 주세요." };
  }

  const pdfFiles = await findPdfFiles(folderPath);
  if (pdfFiles.length === 0) {
    return { error: "폴더(하위 폴더 포함) 안에서 PDF 파일을 찾지 못했습니다." };
  }

  const rows: BatchRow[] = [];
  const failedFiles: { file: string; error: string }[] = [];

  for (const filePath of pdfFiles) {
    const relativePath = path.relative(folderPath, filePath);
    const parser = new PDFParse({ data: await fs.readFile(filePath) });
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
      failedFiles.push({
        file: relativePath,
        error: err instanceof Error ? err.message : "텍스트 추출에 실패했습니다.",
      });
    } finally {
      await parser.destroy();
    }
  }

  if (rows.length === 0) {
    return { error: "모든 PDF에서 텍스트 추출에 실패했습니다." };
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outputPath = path.join(folderPath, `pdf-text-extract_${timestamp}.csv`);
  // Prefix with a BOM so Excel on Windows opens the Korean text as UTF-8
  // instead of guessing the system codepage and mangling it.
  await fs.writeFile(outputPath, "﻿" + toCsv(rows), "utf-8");

  return {
    result: {
      folder: folderPath,
      outputPath,
      fileCount: pdfFiles.length - failedFiles.length,
      pageCount: rows.length,
      failedFiles,
    },
  };
}
