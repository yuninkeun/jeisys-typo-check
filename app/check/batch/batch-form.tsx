"use client";

import { useActionState } from "react";
import { extractFolderToCsv, type BatchState } from "./actions";

const initialState: BatchState = {};

export function BatchForm() {
  const [state, formAction, pending] = useActionState(
    extractFolderToCsv,
    initialState,
  );

  return (
    <div className="flex flex-col gap-5">
      <form
        action={formAction}
        className="flex flex-col gap-4 rounded border border-line bg-surface p-5"
      >
        <div className="flex flex-col gap-2">
          <label
            htmlFor="folderPath"
            className="text-xs font-medium text-ink-muted"
          >
            폴더 경로 (이 서버를 실행 중인 PC 기준)
          </label>
          <input
            id="folderPath"
            name="folderPath"
            type="text"
            required
            placeholder={String.raw`예: C:\Users\이름\Documents\인쇄파일`}
            className="w-full rounded border border-line-strong bg-white px-3 py-2.5 font-mono text-sm text-ink"
          />
          <p className="text-xs text-ink-faint">
            하위 폴더까지 모두 검색해 PDF를 찾고, 텍스트를 추출해 같은 폴더에
            CSV로 저장합니다.
          </p>
        </div>

        {state.error && (
          <p
            role="alert"
            className="rounded border border-flag-line bg-flag-soft px-3 py-2 text-sm text-flag"
          >
            {state.error}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="h-11 rounded bg-brand-700 text-sm font-medium text-white transition-colors hover:bg-brand-800 disabled:opacity-60"
        >
          {pending ? "추출 중…" : "PDF 텍스트 추출 → CSV 저장"}
        </button>
      </form>

      {state.result && (
        <article className="flex flex-col gap-3 rounded border border-line bg-surface p-5">
          <h2 className="text-sm font-bold text-ink">완료</h2>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded border border-line bg-canvas px-3 py-2.5">
              <div className="text-xl font-bold tabular-nums text-ink">
                {state.result.fileCount}
              </div>
              <div className="text-xs text-ink-muted">처리한 PDF</div>
            </div>
            <div className="rounded border border-line bg-canvas px-3 py-2.5">
              <div className="text-xl font-bold tabular-nums text-ink">
                {state.result.pageCount}
              </div>
              <div className="text-xs text-ink-muted">추출한 페이지</div>
            </div>
          </div>
          <p className="break-all text-xs text-ink-muted">
            저장 위치:{" "}
            <span className="font-mono text-ink">{state.result.outputPath}</span>
          </p>

          {state.result.failedFiles.length > 0 && (
            <div className="flex flex-col gap-1 rounded border border-flag-line bg-flag-soft p-3">
              <p className="text-xs font-medium text-flag">
                추출 실패 {state.result.failedFiles.length}건
              </p>
              <ul className="flex flex-col gap-0.5">
                {state.result.failedFiles.map((f, i) => (
                  <li key={i} className="text-xs text-ink-muted">
                    · {f.file} — {f.error}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </article>
      )}
    </div>
  );
}
