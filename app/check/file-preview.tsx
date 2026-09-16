"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { BBox } from "./actions";

const MAX_PAGES = 5;
const RENDER_SCALE = 2;

/** Rasterises the uploaded file so regions of it can be cropped and shown.
 *  The file is fetched as a blob first so the canvas never becomes tainted. */
export function usePageCanvases(fileUrl?: string, mimeType?: string) {
  const [pages, setPages] = useState<HTMLCanvasElement[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!fileUrl || !mimeType) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const buffer = await (await fetch(fileUrl)).arrayBuffer();
        const rendered: HTMLCanvasElement[] = [];

        if (mimeType === "application/pdf") {
          const pdfjs = await import("pdfjs-dist");
          pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
          const pdf = await pdfjs.getDocument({ data: buffer }).promise;
          const pageCount = Math.min(pdf.numPages, MAX_PAGES);

          for (let i = 1; i <= pageCount; i++) {
            const page = await pdf.getPage(i);
            const viewport = page.getViewport({ scale: RENDER_SCALE });
            const canvas = document.createElement("canvas");
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            const context = canvas.getContext("2d");
            if (!context) throw new Error("캔버스를 만들 수 없습니다.");
            await page.render({ canvas, canvasContext: context, viewport })
              .promise;
            rendered.push(canvas);
          }
        } else {
          const bitmap = await createImageBitmap(new Blob([buffer]));
          const canvas = document.createElement("canvas");
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
          canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
          rendered.push(canvas);
        }

        if (!cancelled) setPages(rendered);
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "파일을 표시하지 못했습니다.",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [fileUrl, mimeType]);

  return { pages, loading, error };
}

/** The model's coordinates are approximate, so the crop is padded generously. */
function paddedRect(canvas: HTMLCanvasElement, bbox: BBox) {
  const padX = Math.max(canvas.width * 0.04, bbox.w * canvas.width * 0.25);
  const padY = Math.max(canvas.height * 0.03, bbox.h * canvas.height * 1.2);

  const left = Math.max(0, bbox.x * canvas.width - padX);
  const top = Math.max(0, bbox.y * canvas.height - padY);
  const right = Math.min(canvas.width, (bbox.x + bbox.w) * canvas.width + padX);
  const bottom = Math.min(
    canvas.height,
    (bbox.y + bbox.h) * canvas.height + padY,
  );

  return { left, top, width: right - left, height: bottom - top };
}

export function RegionCrop({
  pages,
  page,
  bbox,
}: {
  pages: HTMLCanvasElement[];
  page?: number;
  bbox?: BBox;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const target = ref.current;
    const source = pages[(page ?? 1) - 1];
    if (!target || !source || !bbox) return;

    const rect = paddedRect(source, bbox);
    if (rect.width <= 0 || rect.height <= 0) return;

    target.width = rect.width;
    target.height = rect.height;
    target
      .getContext("2d")
      ?.drawImage(
        source,
        rect.left,
        rect.top,
        rect.width,
        rect.height,
        0,
        0,
        rect.width,
        rect.height,
      );
  }, [pages, page, bbox]);

  const source = pages[(page ?? 1) - 1];
  if (!source || !bbox) return null;

  return (
    <canvas
      ref={ref}
      className="block h-auto w-full bg-white"
      aria-label="파일에서 해당 부분을 잘라낸 이미지"
    />
  );
}

export type Marker = { page: number; bbox: BBox; label: number };

export function PagePreview({
  pages,
  markers = [],
}: {
  pages: HTMLCanvasElement[];
  markers?: Marker[];
}) {
  const urls = useMemo(() => pages.map((c) => c.toDataURL()), [pages]);

  return (
    <div className="flex flex-col gap-3">
      {urls.map((url, i) => {
        const pageNumber = i + 1;
        const pageMarkers = markers.filter((m) => m.page === pageNumber);
        return (
          <div
            key={i}
            className="relative overflow-hidden border border-line bg-white"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={url}
              alt={`업로드한 파일 ${pageNumber}페이지`}
              className="block w-full"
            />
            {pageMarkers.map((m, mi) => (
              <div
                key={mi}
                className="absolute border-2 border-flag bg-flag/10"
                style={{
                  left: `${m.bbox.x * 100}%`,
                  top: `${m.bbox.y * 100}%`,
                  width: `${Math.max(m.bbox.w * 100, 2)}%`,
                  height: `${Math.max(m.bbox.h * 100, 2)}%`,
                }}
              >
                <span className="absolute -left-2.5 -top-2.5 flex h-5 w-5 items-center justify-center rounded-full bg-flag text-[11px] font-bold text-white">
                  {m.label}
                </span>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
