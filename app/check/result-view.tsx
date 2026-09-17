"use client";

import { setResolution, type Resolution } from "./actions";

export type ResultLine = {
  text: string;
  is_flagged: boolean;
  flag_reason?: string | null;
  suggested_text?: string | null;
  page?: number | null;
  resolution?: Resolution | null;
};

/** How this file compares with the previous check of a file with the same name. */
export type RevisionComparison = {
  previousId: string;
  previousCheckedAt: string;
  totalPreviousFlags: number;
  resolvedFlags: number;
  stillPresent: string[];
};

export type ResultData = {
  fileName: string;
  product?: string | null;
  lines: ResultLine[];
  documentId?: string;
  comparison?: RevisionComparison | null;
};

function ResolutionButtons({
  documentId,
  lineIndex,
  current,
}: {
  documentId: string;
  lineIndex: number;
  current?: Resolution | null;
}) {
  const options: { value: Resolution; label: string; activeClass: string }[] = [
    {
      value: "fixed",
      label: "수정완료",
      activeClass: "border-pass-line bg-pass text-white",
    },
    {
      value: "ignored",
      label: "문제없음",
      activeClass: "border-line-strong bg-ink-muted text-white",
    },
  ];

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {options.map((option) => {
        const isActive = current === option.value;
        return (
          <form key={option.value} action={setResolution}>
            <input type="hidden" name="documentId" value={documentId} />
            <input type="hidden" name="lineIndex" value={lineIndex} />
            <input type="hidden" name="resolution" value={option.value} />
            <input type="hidden" name="current" value={current ?? ""} />
            <button
              type="submit"
              className={`rounded-sm border px-2 py-0.5 text-[11px] font-medium transition-colors ${
                isActive
                  ? option.activeClass
                  : "border-line-strong text-ink-muted hover:bg-surface"
              }`}
            >
              {option.label}
            </button>
          </form>
        );
      })}
      {current === "ignored" && (
        <span className="text-[11px] text-ink-faint">
          이 표현은 다음 검증부터 지적하지 않습니다
        </span>
      )}
    </div>
  );
}

function AsIsToBeCard({
  text,
  suggestedText,
  reason,
  page,
  documentId,
  lineIndex,
  resolution,
}: {
  text: string;
  suggestedText?: string | null;
  reason?: string | null;
  page?: number | null;
  documentId?: string;
  lineIndex: number;
  resolution?: Resolution | null;
}) {
  return (
    <div className="flex flex-col gap-2.5 rounded border border-line bg-canvas p-3">
      {page != null && (
        <span className="w-fit rounded-sm border border-line-strong px-1.5 py-0.5 text-[11px] font-medium text-ink-muted">
          페이지 {page}
        </span>
      )}
      <div className="grid grid-cols-1 items-stretch gap-2 sm:grid-cols-[1fr_auto_1fr]">
        <figure className="m-0 overflow-hidden rounded-sm border border-flag-line bg-surface">
          <figcaption className="bg-flag px-2 py-1 text-[10px] font-bold tracking-widest text-white">
            AS-IS
          </figcaption>
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
          <p className="px-3 py-2.5 text-sm font-medium text-pass">
            {suggestedText || "수정안 없음 — 담당자 확인 필요"}
          </p>
        </figure>
      </div>
      {reason && <p className="text-xs leading-relaxed text-ink-muted">{reason}</p>}
      {documentId && (
        <ResolutionButtons
          documentId={documentId}
          lineIndex={lineIndex}
          current={resolution}
        />
      )}
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
  const { fileName, product, lines, documentId, comparison } = result;
  const flaggedCount = lines.filter((l) => l.is_flagged).length;
  const handledCount = lines.filter(
    (l) => l.is_flagged && l.resolution,
  ).length;

  let flagCounter = 0;
  const flagNumbers: (number | null)[] = lines.map((line) =>
    line.is_flagged ? ++flagCounter : null,
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
          {flaggedCount > 0 && documentId && (
            <p className="text-xs text-ink-muted">
              확인 필요 {flaggedCount}건 중 {handledCount}건 처리됨 — 각 항목에서
              &quot;수정완료&quot; 또는 &quot;문제없음&quot;을 눌러 기록할 수 있습니다.
            </p>
          )}
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

        {comparison && (
          <section className="flex flex-col gap-2 rounded border border-line bg-canvas p-4">
            <h3 className="text-xs font-bold tracking-wide text-ink-muted">
              지난 검증과 비교
            </h3>
            <p className="text-sm text-ink">
              같은 이름의 파일을{" "}
              {new Date(comparison.previousCheckedAt).toLocaleDateString("ko-KR")}에
              검증했을 때 지적된 {comparison.totalPreviousFlags}건 중{" "}
              <strong className="text-pass">{comparison.resolvedFlags}건</strong>이 이번
              파일에서 사라졌습니다.
            </p>
            {comparison.stillPresent.length > 0 && (
              <div className="flex flex-col gap-1">
                <p className="text-xs font-medium text-flag">
                  아직 그대로인 항목 {comparison.stillPresent.length}건
                </p>
                <ul className="flex flex-col gap-0.5">
                  {comparison.stillPresent.map((text, i) => (
                    <li key={i} className="text-xs text-ink-muted">
                      · {text}
                    </li>
                  ))}
                </ul>
              </div>
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
                    {line.resolution && (
                      <span className="ml-auto mt-0.5 shrink-0 rounded-sm border border-line-strong px-1.5 py-0.5 text-[11px] font-medium text-ink-muted">
                        {line.resolution === "fixed" ? "수정완료" : "문제없음"}
                      </span>
                    )}
                  </div>
                  {line.is_flagged && (
                    <AsIsToBeCard
                      text={line.text}
                      suggestedText={line.suggested_text}
                      reason={line.flag_reason}
                      page={line.page}
                      documentId={documentId}
                      lineIndex={i}
                      resolution={line.resolution}
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
