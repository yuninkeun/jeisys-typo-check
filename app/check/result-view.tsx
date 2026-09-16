"use client";

import type { BBox } from "./actions";
import { PagePreview, RegionCrop, usePageCanvases, type Marker } from "./file-preview";

export type ResultLine = {
  text: string;
  is_flagged: boolean;
  flag_reason?: string | null;
  suggested_text?: string | null;
  page?: number | null;
  bbox?: BBox | null;
};

export type ResultData = {
  fileName: string;
  fileUrl?: string;
  mimeType?: string;
  product?: string | null;
  lines: ResultLine[];
};

function AsIsToBeCard({
  text,
  suggestedText,
  reason,
  pages,
  page,
  bbox,
}: {
  text: string;
  suggestedText?: string | null;
  reason?: string | null;
  pages: HTMLCanvasElement[];
  page?: number | null;
  bbox?: BBox | null;
}) {
  const hasCrop = Boolean(bbox && pages[(page ?? 1) - 1]);

  return (
    <div className="flex flex-col gap-2.5 rounded border border-line bg-canvas p-3">
      <div className="grid grid-cols-1 items-stretch gap-2 sm:grid-cols-[1fr_auto_1fr]">
        <figure className="m-0 overflow-hidden rounded-sm border border-flag-line bg-surface">
          <figcaption className="bg-flag px-2 py-1 text-[10px] font-bold tracking-widest text-white">
            AS-IS
          </figcaption>
          {hasCrop && (
            <div className="border-b border-flag-line">
              <RegionCrop pages={pages} page={page ?? 1} bbox={bbox ?? undefined} />
            </div>
          )}
          <p className="px-3 py-2.5 text-sm text-flag line-through decoration-flag/50 decoration-2">
            {text}
          </p>
        </figure>

        <span aria-hidden className="hidden self-center px-1 text-ink-faint sm:block">
          →
        </span>

        <figure className="m-0 flex flex-col overflow-hidden rounded-sm border border-pass-line bg-surface">
          <figcaption className="bg-pass px-2 py-1 text-[10px] font-bold tracking-widest text-white">
            TO-BE
          </figcaption>
          {hasCrop && (
            <div className="flex flex-1 items-center justify-center border-b border-pass-line bg-white px-3 py-4">
              <span className="text-center text-base font-medium text-pass">
                {suggestedText || "—"}
              </span>
            </div>
          )}
          <p className="px-3 py-2.5 text-sm font-medium text-pass">
            {suggestedText || "수정안 없음 — 담당자 확인 필요"}
          </p>
        </figure>
      </div>
      {reason && <p className="text-xs leading-relaxed text-ink-muted">{reason}</p>}
    </div>
  );
}

function SummaryTile({
  value,
  label,
  tone = "neutral",
}: {
  value: number;
  label: string;
  tone?: "neutral" | "flag" | "pass";
}) {
  const tones = {
    neutral: "border-line bg-surface text-ink",
    flag: "border-flag-line bg-flag-soft text-flag",
    pass: "border-pass-line bg-pass-soft text-pass",
  } as const;

  return (
    <div className={`rounded border px-4 py-3 ${tones[tone]}`}>
      <div className="text-2xl font-bold tabular-nums">{value}</div>
      <div className="mt-0.5 text-xs opacity-80">{label}</div>
    </div>
  );
}

export function ResultView({ result }: { result: ResultData }) {
  const { fileName, fileUrl, mimeType, product, lines } = result;
  const flaggedCount = lines.filter((l) => l.is_flagged).length;
  const { pages, loading: previewLoading, error: previewError } =
    usePageCanvases(fileUrl, mimeType);

  let flagCounter = 0;
  const flagNumbers: (number | null)[] = lines.map((line) =>
    line.is_flagged ? ++flagCounter : null,
  );
  const markers: Marker[] = lines.flatMap((line, i) =>
    line.is_flagged && line.page && line.bbox
      ? [{ page: line.page, bbox: line.bbox, label: flagNumbers[i]! }]
      : [],
  );

  return (
    <article className="overflow-hidden rounded border border-line bg-surface">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-canvas px-5 py-3">
        <h2 className="truncate text-sm font-bold text-ink">{fileName}</h2>
        {product ? (
          <span className="rounded-sm border border-brand-200 bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">
            {product}
          </span>
        ) : (
          <span className="rounded-sm border border-line-strong px-2 py-0.5 text-xs text-ink-muted">
            제품 미분류
          </span>
        )}
      </header>

      <div className="flex flex-col gap-5 p-5">
        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-bold tracking-wide text-ink-muted">요약</h3>
          <div className="grid grid-cols-3 gap-2">
            <SummaryTile value={lines.length} label="추출된 줄" />
            <SummaryTile value={flaggedCount} label="확인 필요" tone="flag" />
            <SummaryTile
              value={lines.length - flaggedCount}
              label="이상 없음"
              tone="pass"
            />
          </div>
          {!product && (
            <p className="text-xs text-ink-muted">
              파일명에서 제품명을 인식하지 못해 과거 이력 비교는 수행되지 않았습니다.
            </p>
          )}
          {lines.length === 0 && (
            <p className="text-sm text-ink-muted">
              텍스트를 추출하지 못했습니다. 파일 해상도를 확인해 주세요.
            </p>
          )}
        </section>

        {fileUrl && (
          <section className="flex flex-col gap-2">
            <h3 className="text-xs font-bold tracking-wide text-ink-muted">
              업로드한 파일
            </h3>
            {previewLoading && (
              <p className="text-sm text-ink-muted">파일을 불러오는 중입니다…</p>
            )}
            {previewError && (
              <p className="text-sm text-ink-muted">
                미리보기를 표시하지 못했습니다. ({previewError})
              </p>
            )}
            <PagePreview pages={pages} markers={markers} />
            {markers.length > 0 && (
              <p className="text-xs text-ink-faint">
                빨간 번호가 아래 상세 내용의 확인 필요 항목과 같은 위치를 가리킵니다.
              </p>
            )}
          </section>
        )}

        {lines.length > 0 && (
          <section className="flex flex-col gap-2">
            <h3 className="text-xs font-bold tracking-wide text-ink-muted">
              상세 내용
            </h3>
            <ul className="divide-y divide-line rounded border border-line">
              {lines.map((line, i) => (
                <li key={i} className="flex flex-col gap-2.5 px-4 py-3">
                  <div className="flex items-start gap-2.5">
                    <span
                      className={
                        line.is_flagged
                          ? "mt-0.5 flex shrink-0 items-center gap-1 rounded-sm border border-flag-line bg-flag-soft px-1.5 py-0.5 text-[11px] font-medium text-flag"
                          : "mt-0.5 shrink-0 rounded-sm border border-pass-line bg-pass-soft px-1.5 py-0.5 text-[11px] font-medium text-pass"
                      }
                    >
                      {line.is_flagged && flagNumbers[i] && (
                        <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-flag text-[9px] font-bold text-white">
                          {flagNumbers[i]}
                        </span>
                      )}
                      {line.is_flagged ? "확인 필요" : "정상"}
                    </span>
                    <span className="text-sm text-ink">{line.text}</span>
                  </div>
                  {line.is_flagged && (
                    <AsIsToBeCard
                      text={line.text}
                      suggestedText={line.suggested_text}
                      reason={line.flag_reason}
                      pages={pages}
                      page={line.page}
                      bbox={line.bbox}
                    />
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </article>
  );
}
