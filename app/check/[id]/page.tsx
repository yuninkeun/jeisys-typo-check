import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppHeader } from "../../components/app-header";
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

  return (
    <div className="flex flex-1 flex-col">
      <AppHeader />
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 px-6 py-10">
        <Link
          href="/check"
          className="w-fit text-sm text-ink-muted hover:text-ink"
        >
          ← 검증 이력
        </Link>

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
      </main>
    </div>
  );
}
