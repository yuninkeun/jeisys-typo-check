"use client";

import { useActionState } from "react";
import { uploadAndCheck, type CheckState } from "./actions";

const initialState: CheckState = {};

function AsIsToBeCard({
  text,
  suggestedText,
  reason,
}: {
  text: string;
  suggestedText?: string;
  reason?: string;
}) {
  return (
    <div className="ml-1 flex flex-col gap-2 rounded-lg border border-red-200 bg-red-50/50 p-3 dark:border-red-900/60 dark:bg-red-950/20">
      <div className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[1fr_auto_1fr]">
        <div className="rounded-md border border-red-300 bg-white dark:border-red-900 dark:bg-zinc-950">
          <div className="rounded-t-md bg-red-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
            As-Is
          </div>
          <div className="px-2.5 py-2 text-sm text-red-700 line-through decoration-red-400 decoration-2 dark:text-red-300">
            {text}
          </div>
        </div>

        <span className="hidden justify-self-center text-zinc-400 sm:block">
          →
        </span>

        <div className="rounded-md border border-emerald-300 bg-white dark:border-emerald-900 dark:bg-zinc-950">
          <div className="rounded-t-md bg-emerald-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
            To-Be
          </div>
          <div className="px-2.5 py-2 text-sm font-medium text-emerald-700 dark:text-emerald-300">
            {suggestedText || "(수정안 없음 — 직접 검토 필요)"}
          </div>
        </div>
      </div>
      {reason && (
        <p className="text-xs text-red-800/80 dark:text-red-200/70">{reason}</p>
      )}
    </div>
  );
}

function ResultSummary({ lines }: { lines: NonNullable<CheckState["lines"]> }) {
  const flaggedCount = lines.filter((l) => l.is_flagged).length;
  const okCount = lines.length - flaggedCount;

  return (
    <div className="grid grid-cols-3 gap-2">
      <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-center dark:border-zinc-800 dark:bg-zinc-900">
        <div className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          {lines.length}
        </div>
        <div className="text-[11px] text-zinc-500">추출된 줄</div>
      </div>
      <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-center dark:border-red-900/60 dark:bg-red-950/30">
        <div className="text-xl font-semibold text-red-700 dark:text-red-300">
          {flaggedCount}
        </div>
        <div className="text-[11px] text-red-700/80 dark:text-red-300/80">
          확인 필요
        </div>
      </div>
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-center dark:border-emerald-900/60 dark:bg-emerald-950/30">
        <div className="text-xl font-semibold text-emerald-700 dark:text-emerald-300">
          {okCount}
        </div>
        <div className="text-[11px] text-emerald-700/80 dark:text-emerald-300/80">
          정상
        </div>
      </div>
    </div>
  );
}

export function UploadForm() {
  const [state, formAction, pending] = useActionState(
    uploadAndCheck,
    initialState,
  );

  return (
    <div className="flex flex-col gap-6">
      <form
        action={formAction}
        className="flex flex-col gap-4 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950"
      >
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="file"
            className="text-sm font-medium text-zinc-800 dark:text-zinc-200"
          >
            일러스트 파일 (PNG, JPG, PDF)
          </label>
          <input
            id="file"
            name="file"
            type="file"
            accept="image/png,image/jpeg,application/pdf"
            required
            className="text-sm text-zinc-700 file:mr-3 file:h-9 file:rounded-lg file:border-0 file:bg-zinc-900 file:px-3 file:text-sm file:font-medium file:text-white dark:text-zinc-300 dark:file:bg-zinc-50 dark:file:text-zinc-900"
          />
          <p className="text-xs text-zinc-500">
            제품명은 파일 이름에서 자동으로 인식합니다 (예: 파일명에 &quot;DENSITY&quot;가 있으면 DENSITY로 분류).
          </p>
        </div>

        {state.error && (
          <p
            role="alert"
            className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/50 dark:text-red-300"
          >
            {state.error}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="h-10 rounded-lg bg-zinc-900 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-60 dark:bg-zinc-50 dark:text-zinc-900"
        >
          {pending ? "검증 중… (최대 30초)" : "업로드하고 오타 검증하기"}
        </button>
      </form>

      {state.lines && (
        <div className="flex flex-col gap-5 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
          {/* 요약 */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                {state.fileName}
              </h2>
              {state.product && (
                <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-normal text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                  {state.product}
                </span>
              )}
            </div>

            {state.lines.length > 0 && <ResultSummary lines={state.lines} />}

            {!state.product && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                파일명에서 제품명을 인식하지 못해 이번 결과는 과거 이력 비교 대상에서 제외됩니다.
              </p>
            )}
            {state.lines.length === 0 && (
              <p className="text-sm text-zinc-500">
                텍스트를 추출하지 못했습니다. 이미지 해상도를 확인해 주세요.
              </p>
            )}
          </div>

          {/* 상세 */}
          {state.lines.length > 0 && (
            <div className="flex flex-col gap-1 border-t border-zinc-100 pt-4 dark:border-zinc-900">
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                상세 내용
              </h3>
              <ul className="flex flex-col divide-y divide-zinc-100 dark:divide-zinc-900">
                {state.lines.map((line, i) => (
                  <li key={i} className="flex flex-col gap-2 py-3">
                    <div className="flex items-start gap-2">
                      <span
                        className={
                          line.is_flagged
                            ? "mt-0.5 shrink-0 rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-700 dark:bg-red-950/60 dark:text-red-300"
                            : "mt-0.5 shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                        }
                      >
                        {line.is_flagged ? "확인 필요" : "정상"}
                      </span>
                      <span className="text-sm text-zinc-900 dark:text-zinc-100">
                        {line.text}
                      </span>
                    </div>
                    {line.is_flagged && (
                      <AsIsToBeCard
                        text={line.text}
                        suggestedText={line.suggested_text}
                        reason={line.flag_reason}
                      />
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
