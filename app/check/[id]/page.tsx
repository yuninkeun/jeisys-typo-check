import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppHeader } from "../../components/app-header";
import { ResultView, type ResultLine } from "../result-view";

export default async function CheckDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: doc } = await supabase
    .from("documents")
    .select("id, original_filename, storage_path, mime_type, product, status")
    .eq("id", id)
    .single();

  if (!doc) notFound();

  const { data: extractions } = await supabase
    .from("text_extractions")
    .select("text, is_flagged, flag_reason, suggested_text, page, bbox")
    .eq("document_id", id)
    .order("line_index", { ascending: true });

  const { data: signed } = await supabase.storage
    .from("illustrations")
    .createSignedUrl(doc.storage_path, 60 * 60);

  const lines: ResultLine[] = (extractions ?? []).map((e) => ({
    text: e.text,
    is_flagged: e.is_flagged,
    flag_reason: e.flag_reason,
    suggested_text: e.suggested_text,
    page: e.page,
    bbox: e.bbox as ResultLine["bbox"],
  }));

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
              fileUrl: signed?.signedUrl,
              mimeType: doc.mime_type,
              product: doc.product,
              lines,
            }}
          />
        )}
      </main>
    </div>
  );
}
