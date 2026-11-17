"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { openPdf, renderPage, type Box } from "./pdf-render";

export type ProofMark = { key: string; page: number; bbox: Box | null; from: string; to: string };

const RED = "#e00012";

/** Where a mark without a known position starts, so it can be dragged into place. */
function defaultBox(n: number): Box {
  return { x: 0.38, y: Math.min(0.9, 0.08 + n * 0.07), w: 0.24, h: 0.045 };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function today() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

/* ---------- a minimal PDF writer: one JPEG per page ---------- */

type PdfPage = { jpeg: Uint8Array; imgW: number; imgH: number; w: number; h: number };

function makePdf(pages: PdfPage[]): Uint8Array {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let size = 0;
  const put = (part: string | Uint8Array) => {
    const bytes = typeof part === "string" ? enc.encode(part) : part;
    chunks.push(bytes);
    size += bytes.length;
  };
  const obj = (n: number, body: () => void) => {
    offsets[n] = size;
    put(`${n} 0 obj\n`);
    body();
    put("\nendobj\n");
  };

  put("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  const pageIds = pages.map((_, i) => 3 + i * 3);
  obj(1, () => put("<< /Type /Catalog /Pages 2 0 R >>"));
  obj(2, () => put(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`));
  pages.forEach((p, i) => {
    const id = pageIds[i];
    const w = p.w.toFixed(2);
    const h = p.h.toFixed(2);
    obj(id, () =>
      put(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Contents ${id + 1} 0 R /Resources << /XObject << /Im0 ${id + 2} 0 R >> >> >>`,
      ),
    );
    const stream = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`;
    obj(id + 1, () => put(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`));
    obj(id + 2, () => {
      put(
        `<< /Type /XObject /Subtype /Image /Width ${p.imgW} /Height ${p.imgH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`,
      );
      put(p.jpeg);
      put("\nendstream");
    });
  });
  const count = 3 + pages.length * 3;
  const xref = size;
  put(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let n = 1; n < count; n++) put(`${String(offsets[n]).padStart(10, "0")} 00000 n \n`);
  put(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

async function canvasJpeg(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
  if (!blob) throw new Error("이미지를 만들지 못했습니다.");
  return new Uint8Array(await blob.arrayBuffer());
}

/** Red numbered boxes on a rendered page. */
function drawMarks(ctx: CanvasRenderingContext2D, w: number, h: number, marks: { n: number; box: Box }[]) {
  const line = Math.max(3, w / 400);
  const r = Math.max(14, w / 60);
  ctx.save();
  for (const { n, box } of marks) {
    ctx.strokeStyle = RED;
    ctx.lineWidth = line;
    ctx.strokeRect(box.x * w, box.y * h, box.w * w, box.h * h);
    const cx = clamp(box.x * w, r, w - r);
    const cy = clamp(box.y * h, r, h - r);
    ctx.fillStyle = RED;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = `bold ${Math.round(r * 1.1)}px "Malgun Gothic", "Apple SD Gothic Neo", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(n), cx, cy + 1);
  }
  ctx.restore();
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const out: string[] = [];
  let cur = "";
  for (const ch of text) {
    if (ctx.measureText(cur + ch).width > maxWidth && cur) {
      out.push(cur);
      cur = ch;
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out.length ? out : [""];
}

/** A4 pages listing every correction, drawn as images (so Korean needs no embedded font). */
async function listPages(fileName: string, items: { n: number; page: number; from: string; to: string }[]): Promise<PdfPage[]> {
  const W = 1240;
  const H = 1754;
  const M = 90;
  const font = '"Malgun Gothic", "Apple SD Gothic Neo", sans-serif';
  const pages: PdfPage[] = [];
  let canvas: HTMLCanvasElement | null = null;
  let ctx: CanvasRenderingContext2D | null = null;
  let y = 0;

  const finish = async () => {
    if (!canvas) return;
    pages.push({ jpeg: await canvasJpeg(canvas), imgW: W, imgH: H, w: 595.28, h: 841.89 });
  };
  const start = () => {
    canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("캔버스를 만들 수 없습니다.");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, W, H);
    ctx.textBaseline = "top";
    ctx.fillStyle = "#111";
    ctx.font = `bold 40px ${font}`;
    ctx.fillText(pages.length === 0 ? "교정 지시서" : "교정 지시서 (이어서)", M, M);
    ctx.font = `24px ${font}`;
    ctx.fillStyle = "#555";
    const d = new Date();
    ctx.fillText(`${fileName}  ·  ${d.toLocaleDateString("ko-KR")}  ·  수정 ${items.length}건`, M, M + 58);
    ctx.fillText("디자인의 빨간 번호와 아래 번호가 같습니다. 표시된 곳만 고쳐 주세요.", M, M + 92);
    ctx.strokeStyle = "#ccc";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(M, M + 136);
    ctx.lineTo(W - M, M + 136);
    ctx.stroke();
    y = M + 160;
  };

  start();
  for (const it of items) {
    const c = ctx as unknown as CanvasRenderingContext2D;
    c.font = `28px ${font}`;
    const textW = W - M * 2 - 150;
    const fromLines = wrap(c, it.from, textW);
    const toLines = wrap(c, it.to, textW);
    const need = 48 + (fromLines.length + toLines.length) * 40 + 30;
    if (y + need > H - M) {
      await finish();
      start();
    }
    const g = ctx as unknown as CanvasRenderingContext2D;
    g.fillStyle = RED;
    g.beginPath();
    g.arc(M + 22, y + 22, 22, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#fff";
    g.font = `bold 24px ${font}`;
    g.textAlign = "center";
    g.fillText(String(it.n), M + 22, y + 9);
    g.textAlign = "left";
    g.fillStyle = "#777";
    g.font = `24px ${font}`;
    g.fillText(`${it.page}페이지`, M + 60, y + 9);
    y += 52;
    g.font = `28px ${font}`;
    g.fillStyle = "#888";
    g.fillText("기존", M + 60, y);
    g.fillStyle = "#b00010";
    fromLines.forEach((l, k) => g.fillText(l, M + 150, y + k * 40));
    y += fromLines.length * 40;
    g.fillStyle = "#888";
    g.fillText("수정", M + 60, y);
    g.fillStyle = "#0a7a3a";
    g.font = `bold 28px ${font}`;
    toLines.forEach((l, k) => g.fillText(l, M + 150, y + k * 40));
    y += toLines.length * 40 + 30;
    g.strokeStyle = "#eee";
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(M, y - 15);
    g.lineTo(W - M, y - 15);
    g.stroke();
  }
  await finish();
  return pages;
}

/* ---------- the editor ---------- */

type Drag = { key: string; mode: "move" | "resize"; px: number; py: number; start: Box; rw: number; rh: number };

/** Proof sheet: red numbered boxes over the design that can be dragged into
 *  place, then one PDF with the marked design and a list of corrections. */
export function ProofEditor({
  source,
  isPdf,
  fileName,
  marks,
}: {
  source: Blob | null;
  isPdf: boolean;
  fileName: string;
  marks: ProofMark[];
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [boxes, setBoxes] = useState<Record<string, Box>>({});
  const [drag, setDrag] = useState<Drag | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    if (!source) return;
    let cancelled = false;
    let opened: PDFDocumentProxy | null = null;
    let url: string | null = null;
    if (isPdf) {
      openPdf(source)
        .then((d) => {
          if (cancelled) return void d.destroy();
          opened = d;
          setDoc(d);
        })
        .catch(() => !cancelled && setError("미리보기를 열지 못했습니다."));
    } else {
      const made = URL.createObjectURL(source);
      url = made;
      void Promise.resolve().then(() => !cancelled && setImgUrl(made));
    }
    return () => {
      cancelled = true;
      opened?.destroy();
      if (url) URL.revokeObjectURL(url);
    };
  }, [source, isPdf]);

  // The canvas only exists once there is a mark, so re-render when it appears.
  const hasMarks = marks.length > 0;
  useEffect(() => {
    if (!doc || !hasMarks || !canvasRef.current) return;
    renderPage(doc, Math.min(page, doc.numPages), canvasRef.current, 1300).catch(() =>
      setError("미리보기를 그리지 못했습니다."),
    );
  }, [doc, page, hasMarks]);

  const numbered = marks.map((m, i) => ({ ...m, n: i + 1, box: boxes[m.key] ?? m.bbox ?? defaultBox(i) }));
  const pages = doc?.numPages ?? 1;
  const onPage = numbered.filter((m) => (isPdf ? Math.min(m.page, pages) === page : true));

  function startDrag(e: ReactPointerEvent, key: string, box: Box, mode: Drag["mode"]) {
    e.preventDefault();
    e.stopPropagation();
    const layer = (e.currentTarget as HTMLElement).closest("[data-proof-layer]") as HTMLElement | null;
    if (!layer) return;
    const rect = layer.getBoundingClientRect();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ key, mode, px: e.clientX, py: e.clientY, start: box, rw: rect.width, rh: rect.height });
  }

  function onMove(e: ReactPointerEvent) {
    if (!drag) return;
    const dx = (e.clientX - drag.px) / drag.rw;
    const dy = (e.clientY - drag.py) / drag.rh;
    const s = drag.start;
    const next =
      drag.mode === "move"
        ? { ...s, x: clamp(s.x + dx, 0, 1 - s.w), y: clamp(s.y + dy, 0, 1 - s.h) }
        : { ...s, w: clamp(s.w + dx, 0.01, 1 - s.x), h: clamp(s.h + dy, 0.01, 1 - s.y) };
    setBoxes((prev) => ({ ...prev, [drag.key]: next }));
  }

  async function download() {
    setBusy(true);
    setError(null);
    try {
      const out: PdfPage[] = [];
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("캔버스를 만들 수 없습니다.");
      if (doc) {
        for (let p = 1; p <= doc.numPages; p++) {
          const pdfPage = await doc.getPage(p);
          const vp = pdfPage.getViewport({ scale: 1 });
          await renderPage(doc, p, canvas, 2200);
          drawMarks(
            ctx,
            canvas.width,
            canvas.height,
            numbered.filter((m) => Math.min(m.page, doc.numPages) === p).map((m) => ({ n: m.n, box: m.box })),
          );
          out.push({ jpeg: await canvasJpeg(canvas), imgW: canvas.width, imgH: canvas.height, w: vp.width, h: vp.height });
        }
      } else if (imgUrl) {
        const img = new Image();
        img.src = imgUrl;
        await img.decode();
        const scale = Math.min(1, 2200 / Math.max(img.naturalWidth, img.naturalHeight));
        canvas.width = Math.round(img.naturalWidth * scale);
        canvas.height = Math.round(img.naturalHeight * scale);
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        drawMarks(ctx, canvas.width, canvas.height, numbered.map((m) => ({ n: m.n, box: m.box })));
        const w = 595.28;
        out.push({ jpeg: await canvasJpeg(canvas), imgW: canvas.width, imgH: canvas.height, w, h: (w * canvas.height) / canvas.width });
      }
      out.push(...(await listPages(fileName, numbered.map((m) => ({ n: m.n, page: m.page, from: m.from, to: m.to })))));
      const pdf = makePdf(out);
      const name = `${fileName.replace(/\.[^.]+$/, "")}_${today()}_교정지.pdf`;
      const url = URL.createObjectURL(new Blob([pdf as BlobPart], { type: "application/pdf" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      setSaved(name);
    } catch (err) {
      setError(err instanceof Error ? err.message : "교정지를 만들지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded border border-line bg-surface p-4">
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-bold text-ink">교정지 PDF — Illustrator 없이 수정 지시 보내기</h3>
        <p className="text-xs leading-relaxed text-ink-muted">
          위 표에서 <b>수정</b>·<b>직접수정</b>한 줄이 빨간 번호 상자로 표시됩니다. 상자를 <b>끌어서</b> 실제 글자 위로 옮기고,
          오른쪽 아래 모서리를 끌면 크기가 바뀝니다. 받은 PDF를 디자이너나 인쇄소에 보내면 됩니다.
        </p>
      </div>

      {marks.length === 0 ? (
        <p className="rounded border border-dashed border-line-strong px-3 py-4 text-center text-xs text-ink-faint">
          아직 수정한 줄이 없습니다. 위 표에서 고칠 줄을 수정·직접수정으로 정해 주세요.
        </p>
      ) : (
        <>
          <div className="flex justify-center overflow-hidden rounded border border-line bg-[repeating-conic-gradient(#f1f3f6_0_25%,#fff_0_50%)] bg-[length:16px_16px] p-3">
            <div
              data-proof-layer
              className="relative inline-block touch-none select-none"
              onPointerMove={onMove}
              onPointerUp={() => setDrag(null)}
              onPointerCancel={() => setDrag(null)}
            >
              {imgUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={imgUrl} alt={fileName} className="block max-h-[560px] max-w-full" draggable={false} />
              ) : (
                <canvas ref={canvasRef} className="block max-h-[560px] max-w-full shadow-sm" />
              )}
              {onPage.map((m) => (
                <div
                  key={m.key}
                  onPointerDown={(e) => startDrag(e, m.key, m.box, "move")}
                  title={`${m.n}. ${m.from} → ${m.to}`}
                  className="absolute cursor-move border-2 border-[#e00012] bg-[#e00012]/5 hover:bg-[#e00012]/10"
                  style={{
                    left: `${m.box.x * 100}%`,
                    top: `${m.box.y * 100}%`,
                    width: `${m.box.w * 100}%`,
                    height: `${m.box.h * 100}%`,
                  }}
                >
                  <span className="absolute -left-2.5 -top-2.5 flex h-5 w-5 items-center justify-center rounded-full bg-[#e00012] text-[11px] font-bold text-white">
                    {m.n}
                  </span>
                  <span
                    onPointerDown={(e) => startDrag(e, m.key, m.box, "resize")}
                    className="absolute -bottom-1.5 -right-1.5 h-3 w-3 cursor-se-resize rounded-sm border border-white bg-[#e00012]"
                  />
                </div>
              ))}
            </div>
          </div>

          {pages > 1 && (
            <div className="flex items-center justify-center gap-2 text-xs text-ink-muted">
              <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} className="rounded-sm border border-line-strong px-2 py-0.5 disabled:opacity-40">
                ◀
              </button>
              {page} / {pages} 페이지
              <button type="button" disabled={page >= pages} onClick={() => setPage(page + 1)} className="rounded-sm border border-line-strong px-2 py-0.5 disabled:opacity-40">
                ▶
              </button>
            </div>
          )}

          <ol className="flex flex-col gap-1 text-xs">
            {numbered.map((m) => (
              <li key={m.key} className="flex flex-wrap items-baseline gap-x-2 rounded border border-line px-2.5 py-1.5">
                <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[#e00012] text-[10px] font-bold text-white">
                  {m.n}
                </span>
                <span className="text-ink-faint">p.{m.page}</span>
                <span className="text-flag line-through">{m.from}</span>
                <span className="text-ink-faint">→</span>
                <span className="font-semibold text-pass">{m.to}</span>
                {!m.bbox && !boxes[m.key] && <span className="text-[11px] text-ink-faint">(위치를 몰라 가운데에 두었습니다 — 끌어서 옮겨 주세요)</span>}
              </li>
            ))}
          </ol>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={download}
              disabled={busy}
              className="h-10 rounded bg-brand-700 px-4 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-60"
            >
              {busy ? "교정지 만드는 중…" : `교정지 PDF 받기 (${marks.length}건)`}
            </button>
            {Object.keys(boxes).length > 0 && (
              <button type="button" onClick={() => setBoxes({})} className="text-xs text-ink-muted underline hover:text-ink">
                상자 위치 처음대로
              </button>
            )}
          </div>
        </>
      )}

      {error && <p className="rounded border border-flag-line bg-flag-soft px-3 py-2 text-xs text-flag">{error}</p>}
      {saved && (
        <p className="rounded border border-pass-line bg-pass-soft px-3 py-2 text-xs text-pass">
          <b>{saved}</b> 파일을 내려받았습니다. 내려받기 폴더에서 확인한 뒤 디자이너·인쇄소에 보내세요.
        </p>
      )}
    </section>
  );
}
