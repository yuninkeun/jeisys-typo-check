"use server";

import { createClient } from "@/lib/supabase/server";
import { detectProductFromFilename } from "@/lib/products";

/** OCR 문구 DB (supabase/migrations/20261119_label_ocr.sql): label text read
 *  by the 연결 도우미, kept per file (content hash) so nobody reads it twice. */

export type StoredLine = { t: string; bbox: { x: number; y: number; w: number; h: number }; memo: boolean };
export type StoredDoc = { hash: string; w: number; h: number; lines: StoredLine[] };
export type LabelCategory = "박스" | "스티커" | "멸균지";

type Fail = { ok: false; reason: "not_ready" | "error"; message?: string };

function missingTable(err: { code?: string; message?: string } | null) {
  return !!err && (err.code === "42P01" || err.code === "PGRST205" || err.code === "PGRST202" || /label_files|label_ocr/.test(err.message ?? ""));
}

async function signedIn() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("로그인이 필요합니다.");
  return supabase;
}

function fail(err: { code?: string; message?: string }): Fail {
  return missingTable(err) ? { ok: false, reason: "not_ready" } : { ok: false, reason: "error", message: err.message };
}

/** Files already in the DB, with their lines. */
export async function getStoredOcr(hashes: string[]): Promise<{ ok: true; docs: StoredDoc[] } | Fail> {
  const supabase = await signedIn();
  const unique = [...new Set(hashes)];
  if (!unique.length) return { ok: true, docs: [] };
  const { data, error } = await supabase.rpc("get_label_ocr", { hashes: unique });
  if (error) return fail(error);
  return {
    ok: true,
    docs: (data ?? []).map((r: { content_hash: string; page_w: number; page_h: number; lines: StoredLine[] }) => ({
      hash: r.content_hash,
      w: r.page_w,
      h: r.page_h,
      lines: r.lines ?? [],
    })),
  };
}

/** Stores one file's OCR. `saved: false` = someone stored it first. */
export async function saveOcr(doc: {
  hash: string;
  fileName: string;
  filePath: string;
  category: LabelCategory;
  w: number;
  h: number;
  lines: StoredLine[];
  compact: string;
}): Promise<{ ok: true; saved: boolean } | Fail> {
  const supabase = await signedIn();
  if (!/^[0-9a-f]{64}$/.test(doc.hash)) return { ok: false, reason: "error", message: "파일 해시가 올바르지 않습니다." };
  const { data, error } = await supabase.rpc("save_label_ocr", {
    doc: { ...doc, product: detectProductFromFilename(doc.fileName) ?? "" },
  });
  if (error) return fail(error);
  return { ok: true, saved: !!data };
}

/** How many files are in the DB, per category. */
export async function ocrStats(): Promise<{ ok: true; total: number; byCategory: Record<LabelCategory, number> } | Fail> {
  const supabase = await signedIn();
  const cats: LabelCategory[] = ["박스", "스티커", "멸균지"];
  const counts = await Promise.all(
    cats.map((c) => supabase.from("label_files").select("content_hash", { count: "exact", head: true }).eq("category", c)),
  );
  const err = counts.find((r) => r.error)?.error;
  if (err) return fail(err);
  // A head-only count on a missing table can come back with no error and no count.
  if (counts.some((r) => r.count === null)) return { ok: false, reason: "not_ready" };
  const byCategory = Object.fromEntries(cats.map((c, i) => [c, counts[i].count ?? 0])) as Record<LabelCategory, number>;
  return { ok: true, total: Object.values(byCategory).reduce((a, b) => a + b, 0), byCategory };
}
