"use client";

import { useActionState, useRef } from "react";
import { uploadAndCheck, type CheckState } from "./actions";

const initialState: CheckState = {};

export function UploadForm() {
  const [state, formAction, pending] = useActionState(
    uploadAndCheck,
    initialState,
  );
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <div className="flex flex-col gap-6">
      <form
        ref={formRef}
        action={(formData) => {
          formAction(formData);
        }}
        className="flex flex-col gap-4 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950"
      >
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="product"
            className="text-sm font-medium text-zinc-800 dark:text-zinc-200"
          >
            제품명 <span className="text-zinc-400">(선택, 과거 이력 비교에 사용)</span>
          </label>
          <input
            id="product"
            name="product"
            type="text"
            placeholder="예: DENSITY, POTENZA"
            className="h-10 rounded-lg border border-zinc-300 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="file"
            className="text-sm font-medium text-zinc-800 dark:text-zinc-200"
          >
            일러스트 파일 (PNG, JPG)
          </label>
          <input
            id="file"
            name="file"
            type="file"
            accept="image/png,image/jpeg"
            required
            className="text-sm text-zinc-700 file:mr-3 file:h-9 file:rounded-lg file:border-0 file:bg-zinc-900 file:px-3 file:text-sm file:font-medium file:text-white dark:text-zinc-300 dark:file:bg-zinc-50 dark:file:text-zinc-900"
          />
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
        <div className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              {state.fileName} 검증 결과
            </h2>
            <span className="text-xs text-zinc-500">
              {state.lines.filter((l) => l.is_flagged).length}건 확인 필요 ·
              전체 {state.lines.length}줄
            </span>
          </div>

          {state.lines.length === 0 && (
            <p className="text-sm text-zinc-500">
              텍스트를 추출하지 못했습니다. 이미지 해상도를 확인해 주세요.
            </p>
          )}

          <ul className="flex flex-col divide-y divide-zinc-100 dark:divide-zinc-900">
            {state.lines.map((line, i) => (
              <li key={i} className="flex flex-col gap-1.5 py-3">
                <div className="flex items-start gap-2">
                  <span
                    className={
                      line.is_flagged
                        ? "mt-0.5 rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-700 dark:bg-red-950/60 dark:text-red-300"
                        : "mt-0.5 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                    }
                  >
                    {line.is_flagged ? "확인 필요" : "정상"}
                  </span>
                  <span className="text-sm text-zinc-900 dark:text-zinc-100">
                    {line.text}
                  </span>
                </div>
                {line.is_flagged && (
                  <div className="ml-1 flex flex-col gap-0.5 rounded-lg bg-red-50/60 px-3 py-2 text-xs text-red-800 dark:bg-red-950/30 dark:text-red-200">
                    <span>{line.flag_reason}</span>
                    {line.suggested_text && (
                      <span>
                        제안: <span className="font-medium">{line.suggested_text}</span>
                      </span>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
