import Link from "next/link";
import { AppHeader } from "../components/app-header";
import { createClient } from "@/lib/supabase/server";
import { UploadForm } from "./upload-form";

export default async function CheckPage({
  searchParams,
}: {
  searchParams: Promise<{ user?: string }>;
}) {
  const { user: userFilter } = await searchParams;
  const supabase = await createClient();

  const { data: users } = await supabase
    .from("user_directory")
    .select("id, email")
    .order("email", { ascending: true });

  let query = supabase
    .from("documents")
    .select(
      "id, original_filename, product, status, created_at, user_id, text_extractions(is_flagged)",
    )
    .order("created_at", { ascending: false })
    .limit(20);
  if (userFilter) query = query.eq("user_id", userFilter);
  const { data: documents } = await query;

  const emailById = new Map((users ?? []).map((u) => [u.id, u.email]));

  return (
    <div className="flex flex-1 flex-col">
      <AppHeader />

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-10 px-6 py-10">
        <section className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-xl font-bold text-ink">파일 검증</h1>
            <p className="text-sm text-ink-muted">
              인쇄 전 일러스트 파일의 TEXT를 추출해 오탈자와 과거 이력과의 표기
              차이를 확인합니다.
            </p>
          </div>
          <UploadForm />
        </section>

        <section className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-bold text-ink">검증 이력</h2>
            <span className="text-xs text-ink-faint">최근 20건</span>
          </div>

          {users && users.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              <Link
                href="/check"
                className={
                  !userFilter
                    ? "rounded-sm bg-brand-700 px-2.5 py-1 text-xs font-medium text-white"
                    : "rounded-sm border border-line-strong px-2.5 py-1 text-xs text-ink-muted hover:bg-canvas"
                }
              >
                전체
              </Link>
              {users.map((u) => (
                <Link
                  key={u.id}
                  href={`/check?user=${u.id}`}
                  className={
                    userFilter === u.id
                      ? "rounded-sm bg-brand-700 px-2.5 py-1 text-xs font-medium text-white"
                      : "rounded-sm border border-line-strong px-2.5 py-1 text-xs text-ink-muted hover:bg-canvas"
                  }
                >
                  {u.email}
                </Link>
              ))}
            </div>
          )}

          {!documents || documents.length === 0 ? (
            <p className="rounded border border-line bg-surface px-4 py-8 text-center text-sm text-ink-muted">
              아직 검증한 파일이 없습니다.
            </p>
          ) : (
            <ul className="divide-y divide-line rounded border border-line bg-surface">
              {documents.map((doc) => {
                const extractions = doc.text_extractions as
                  | { is_flagged: boolean }[]
                  | null;
                const flaggedCount =
                  extractions?.filter((e) => e.is_flagged).length ?? 0;
                return (
                  <li key={doc.id}>
                    <Link
                      href={`/check/${doc.id}`}
                      className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-canvas"
                    >
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <span className="truncate text-sm font-medium text-ink">
                          {doc.original_filename}
                        </span>
                        <span className="text-xs text-ink-faint">
                          {doc.product ? `${doc.product} · ` : ""}
                          {emailById.get(doc.user_id) ?? "알 수 없음"} ·{" "}
                          {new Date(doc.created_at).toLocaleString("ko-KR")}
                        </span>
                      </div>
                      {doc.status === "failed" ? (
                        <span className="shrink-0 rounded-sm border border-line-strong px-2 py-0.5 text-xs text-ink-muted">
                          실패
                        </span>
                      ) : flaggedCount > 0 ? (
                        <span className="shrink-0 rounded-sm border border-flag-line bg-flag-soft px-2 py-0.5 text-xs font-medium text-flag">
                          확인 필요 {flaggedCount}
                        </span>
                      ) : (
                        <span className="shrink-0 rounded-sm border border-pass-line bg-pass-soft px-2 py-0.5 text-xs font-medium text-pass">
                          이상 없음
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </main>

      <footer className="border-t border-line py-5">
        <p className="mx-auto max-w-5xl px-6 text-xs text-ink-faint">
          제이시스메디칼 사내 검수 도구 · 검증 결과는 참고용이며 최종 확인은
          담당자가 수행합니다.
        </p>
      </footer>
    </div>
  );
}
