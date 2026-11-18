import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppHeader } from "../../components/app-header";
import { Basis, Conclusion, DataBadge, stamp } from "../../components/standard";
import {
  ResultView,
  type ResultLine,
  type RevisionComparison,
} from "../result-view";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

/** Matches this check against the previous check of a same-named file and counts
 *  how many of the earlier complaints are simply gone from the new text. Files
 *  renamed between revisions won't match — no comparison is shown rather than a
 *  wrong one. */
async function buildRevisionComparison(
  supabase: SupabaseServerClient,
  current: {
    documentId: string;
    fileName: string;
    createdAt: string;
    texts: string[];
  },
): Promise<RevisionComparison | null> {
  const { data: previous } = await supabase
    .from("documents")
    .select("id, created_at")
    .eq("original_filename", current.fileName)
    .eq("status", "done")
    .neq("id", current.documentId)
    .lt("created_at", current.createdAt)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!previous) return null;

  const { data: previousFlags } = await supabase
    .from("text_extractions")
    .select("text")
    .eq("document_id", previous.id)
    .eq("is_flagged", true);

  const flaggedTexts = [
    ...new Set((previousFlags ?? []).map((row) => row.text.trim())),
  ];
  if (flaggedTexts.length === 0) return null;

  const currentTexts = new Set(current.texts.map((t) => t.trim()));
  const stillPresent = flaggedTexts.filter((t) => currentTexts.has(t));

  return {
    previousId: previous.id,
    previousCheckedAt: previous.created_at,
    totalPreviousFlags: flaggedTexts.length,
    resolvedFlags: flaggedTexts.length - stillPresent.length,
    stillPresent,
  };
}

export default async function CheckDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: doc } = await supabase
    .from("documents")
    .select("id, original_filename, product, status, created_at")
    .eq("id", id)
    .single();

  if (!doc) notFound();

  const { data: extractions } = await supabase
    .from("text_extractions")
    .select("text, is_flagged, flag_reason, suggested_text, page, resolution")
    .eq("document_id", id)
    .order("line_index", { ascending: true });

  const lines: ResultLine[] = (extractions ?? []).map((e) => ({
    text: e.text,
    is_flagged: e.is_flagged,
    flag_reason: e.flag_reason,
    suggested_text: e.suggested_text,
    page: e.page,
    resolution: e.resolution as ResultLine["resolution"],
  }));

  const comparison = await buildRevisionComparison(supabase, {
    documentId: id,
    fileName: doc.original_filename,
    createdAt: doc.created_at,
    texts: lines.map((l) => l.text),
  });

  const open = lines.filter((l) => l.is_flagged && !l.resolution).length;
  const flaggedTotal = lines.filter((l) => l.is_flagged).length;
  const conclusion =
    doc.status === "failed"
      ? "검사가 실패했다 — 파일을 다시 올려 검사한다."
      : open > 0
        ? `오타 의심 ${open}줄이 남았다 — 한 줄씩 확인해 고치거나 «문제없음»으로 처리하고, 고친 파일은 다시 올려 검사한다.`
        : flaggedTotal > 0
          ? `의심 ${flaggedTotal}줄을 모두 처리했다 — 고친 파일을 다시 검사해 의심이 사라졌는지 확인하고 인쇄로 넘긴다.`
          : "오타 의심이 없다 — 담당자가 최종 확인한 뒤 인쇄로 넘긴다.";

  return (
    <div className="flex flex-1 flex-col md:flex-row">
      <AppHeader />
      <main className="flex w-full max-w-5xl min-w-0 flex-1 flex-col gap-4 px-4 py-6 md:px-8">
        <Link
          href="/check"
          className="w-fit text-sm text-ink-muted hover:text-ink"
        >
          ← 검증 이력
        </Link>
        <div className="flex items-center gap-2">
          <h1 className="min-w-0 truncate text-[22px] font-bold leading-tight text-ink">{doc.original_filename}</h1>
          <DataBadge />
        </div>
        <p className="-mt-2 text-sm text-ink-muted">
          이 파일을 인쇄로 넘겨도 되나 — 오탈자·예전과 다른 표기가 남았는지
        </p>
        <Basis
          rows={[
            {
              fact: "추출 TEXT",
              src: "서버 검증 기록(text_extractions)",
              cond: `${lines.length}줄`,
              asof: `검사 ${stamp(doc.created_at)}`,
              tag: "정본",
            },
            {
              fact: "오타 의심",
              src: "AI 검사 + 과거 검증 이력과 표기 비교",
              cond: "참고값, 최종 판단은 담당자",
              asof: `검사 ${stamp(doc.created_at)}`,
              tag: "기준 확인 필요",
            },
          ]}
        />

        {doc.status === "failed" ? (
          <p className="rounded border border-flag-line bg-flag-soft px-4 py-3 text-sm text-flag">
            이 파일은 검증 중 오류가 발생했습니다. 다시 업로드해 주세요.
          </p>
        ) : (
          <ResultView
            result={{
              fileName: doc.original_filename,
              product: doc.product,
              lines,
              documentId: doc.id,
              comparison,
            }}
          />
        )}
        <Conclusion>{conclusion}</Conclusion>
      </main>
    </div>
  );
}
