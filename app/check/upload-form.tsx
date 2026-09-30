"use client";

import { useActionState, useState, type ChangeEvent, type FormEvent } from "react";
import Link from "next/link";
import { uploadAndCheck, type CheckState } from "./actions";
import { ResultView } from "./result-view";
import { MAX_FILE_BYTES, MAX_FILE_MB, fileTooLargeMessage } from "./limits";

const initialState: CheckState = {};

export function UploadForm() {
  const [state, formAction, pending] = useActionState(
    uploadAndCheck,
    initialState,
  );
  // An oversized file is rejected before the Server Action runs (request body
  // limit), which crashes to the error page — so it has to be caught here.
  const [sizeError, setSizeError] = useState<string | null>(null);

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file && file.size > MAX_FILE_BYTES) {
      setSizeError(fileTooLargeMessage(file.size));
      e.target.value = "";
    } else {
      setSizeError(null);
    }
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    const input = e.currentTarget.elements.namedItem("file");
    const file = input instanceof HTMLInputElement ? input.files?.[0] : undefined;
    if (file && file.size > MAX_FILE_BYTES) {
      e.preventDefault();
      setSizeError(fileTooLargeMessage(file.size));
    }
  }

  const error = sizeError ?? state.error;

  return (
    <div className="flex flex-col gap-5">
      <form
        action={formAction}
        onSubmit={handleSubmit}
        className="flex flex-col gap-4 rounded border border-line bg-surface p-5"
      >
        <div className="flex flex-col gap-2">
          <label htmlFor="file" className="text-xs font-medium text-ink-muted">
            일러스트 파일 · PNG, JPG, PDF (최대 {MAX_FILE_MB}MB)
          </label>
          <input
            id="file"
            name="file"
            type="file"
            accept="image/png,image/jpeg,application/pdf"
            required
            onChange={handleFileChange}
            className="w-full cursor-pointer rounded border border-line-strong bg-white text-sm text-ink file:mr-3 file:cursor-pointer file:border-0 file:border-r file:border-line-strong file:bg-canvas file:px-4 file:py-2.5 file:text-sm file:font-medium file:text-ink"
          />
          <p className="text-xs text-ink-faint">
            제품명은 파일 이름에서 자동으로 인식합니다. (예: 파일명에
            &quot;DENSITY&quot;가 포함되면 DENSITY로 분류)
          </p>
        </div>

        {error && (
          <p
            role="alert"
            className="rounded border border-flag-line bg-flag-soft px-3 py-2 text-sm text-flag"
          >
            {error}
          </p>
        )}

        {state.duplicateOf && (
          <div className="flex flex-col gap-2 rounded border border-line-strong bg-canvas px-3 py-2.5">
            <p className="text-sm text-ink">
              같은 파일을{" "}
              {new Date(state.duplicateOf.checkedAt).toLocaleString("ko-KR")}에 이미
              검증했습니다. 검증을 다시 실행하지 않았습니다.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Link
                href={`/check/${state.duplicateOf.id}`}
                className="text-sm font-medium text-brand-700 underline hover:text-brand-800"
              >
                지난 검증 결과 보기
              </Link>
              <button
                type="submit"
                name="force"
                value="1"
                disabled={pending}
                className="rounded-sm border border-line-strong px-2.5 py-1 text-xs text-ink-muted hover:bg-surface disabled:opacity-60"
              >
                그래도 다시 검증
              </button>
            </div>
          </div>
        )}

        <button
          type="submit"
          disabled={pending}
          className="h-11 rounded bg-brand-700 text-sm font-medium text-white transition-colors hover:bg-brand-800 disabled:opacity-60"
        >
          {pending ? "검증 중… (최대 30초)" : "업로드하고 검증"}
        </button>
      </form>

      {state.lines && (
        <ResultView
          result={{
            fileName: state.fileName ?? "",
            product: state.product,
            lines: state.lines,
            documentId: state.documentId,
          }}
        />
      )}
    </div>
  );
}
