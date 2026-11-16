"use client";

import type { PDFDocumentProxy } from "pdfjs-dist";

let pdfjsPromise: Promise<typeof import("pdfjs-dist")> | null = null;

/** pdf.js touches browser globals on import, so load it lazily on the client. */
function loadPdfjs() {
  pdfjsPromise ??= import("pdfjs-dist").then((pdfjs) => {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.min.mjs",
      import.meta.url,
    ).toString();
    return pdfjs;
  });
  return pdfjsPromise;
}

export async function openPdf(file: Blob): Promise<PDFDocumentProxy> {
  const pdfjs = await loadPdfjs();
  const data = new Uint8Array(await file.arrayBuffer());
  return pdfjs.getDocument({ data }).promise;
}

/** Draws one page so its longer side is about maxSide pixels. */
export async function renderPage(
  doc: PDFDocumentProxy,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  maxSide: number,
) {
  const page = await doc.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  const scale = maxSide / Math.max(base.width, base.height);
  const viewport = page.getViewport({ scale });
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("캔버스를 만들 수 없습니다.");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: ctx, viewport }).promise;
}

/** First page as a JPEG under maxBytes — used when the file itself is too big to upload. */
export async function pageAsJpeg(file: Blob, maxBytes: number): Promise<Blob> {
  const doc = await openPdf(file);
  try {
    const canvas = document.createElement("canvas");
    await renderPage(doc, 1, canvas, 2400);
    for (const quality of [0.9, 0.8, 0.65, 0.5]) {
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", quality),
      );
      if (blob && blob.size <= maxBytes) return blob;
    }
    throw new Error("미리보기 이미지를 4MB 이하로 줄이지 못했습니다.");
  } finally {
    await doc.destroy();
  }
}

/** The file's own text, line by line, read locally (no upload, no AI).
 *  Text converted to outlines has no characters left and is not found. */
export async function extractLines(file: Blob): Promise<{ text: string; page: number }[]> {
  const doc = await openPdf(file);
  const out: { text: string; page: number }[] = [];
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      let cur = "";
      let lastY: number | null = null;
      const push = () => {
        const text = cur.replace(/\s+/g, " ").trim();
        if (text) out.push({ text, page: p });
        cur = "";
        lastY = null;
      };
      for (const item of content.items) {
        if (!("str" in item)) continue;
        const y = item.transform[5];
        if (lastY !== null && Math.abs(y - lastY) > 2) push();
        cur += item.str;
        lastY = y;
        if (item.hasEOL) push();
      }
      push();
      page.cleanup();
    }
  } finally {
    await doc.destroy();
  }
  return out;
}
