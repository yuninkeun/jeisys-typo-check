import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { UploadForm } from "./upload-form";

export default async function CheckPage() {
  const supabase = await createClient();

  const { data: documents } = await supabase
    .from("documents")
    .select(
      "id, original_filename, product, status, created_at, text_extractions(is_flagged)",
    )
    .order("created_at", { ascending: false })
    .limit(20);

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 dark:bg-black">
      <header className="flex items-center gap-4 border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
        <Link
          href="/"
          className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          ← 홈
        </Link>
        <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          일러스트 TEXT 오타 검증
        </span>
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-10">
        <section>
          <h1 className="mb-4 text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            새 파일 검증
          </h1>
          <UploadForm />
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            최근 검증 이력
          </h2>
          {!documents || documents.length === 0 ? (
            <p className="text-sm text-zinc-500">
              아직 검증한 파일이 없습니다.
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-zinc-200 rounded-xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-950">
              {documents.map((doc) => {
                const extractions = doc.text_extractions as
                  | { is_flagged: boolean }[]
                  | null;
                const flaggedCount =
                  extractions?.filter((e) => e.is_flagged).length ?? 0;
                return (
                  <li
                    key={doc.id}
                    className="flex items-center justify-between gap-3 px-4 py-3 text-sm"
                  >
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate font-medium text-zinc-900 dark:text-zinc-100">
                        {doc.original_filename}
                      </span>
                      <span className="text-xs text-zinc-500">
                        {doc.product ? `${doc.product} · ` : ""}
                        {new Date(doc.created_at).toLocaleString("ko-KR")}
                      </span>
                    </div>
                    {doc.status === "failed" ? (
                      <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                        실패
                      </span>
                    ) : flaggedCount > 0 ? (
                      <span className="shrink-0 rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-700 dark:bg-red-950/60 dark:text-red-300">
                        확인 필요 {flaggedCount}건
                      </span>
                    ) : (
                      <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                        이상 없음
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
