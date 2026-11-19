"use server";

import { createClient } from "@/lib/supabase/server";
import { detectProductFromFilename } from "@/lib/products";
import { findOcrTypos, type DecisionRow, type FindingDecision, type OcrDoc, type OcrFinding } from "@/lib/ocr-compare";

/** OCR 문구 DB (supabase/migrations/20261119_label_ocr.sql): label text read
 *  by the 연결 도우미, kept per file (content hash) so nobody reads it twice. */

export type StoredLine = { t: string; bbox: { x: number; y: number; w: number; h: number }; memo: boolean };
export type StoredDoc = { hash: string; w: number; h: number; lines: StoredLine[] };
export type LabelCategory = "박스" | "스티커" | "멸균지";

type Fail = { ok: false; reason: "not_ready" | "error"; message?: string };

function missingTable(err: { code?: string; message?: string } | null) {
  return !!err && (err.code === "42P01" || err.code === "PGRST205" || err.code === "PGRST202" || /label_files|label_ocr|finding_decisions/.test(err.message ?? ""));
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
  if (data) corpusCache.delete(doc.category); // the reference changed
  return { ok: true, saved: !!data };
}

/** A category's labels as the comparison reference, kept for a few minutes per
 *  server instance (reading 400 labels takes a moment; they change rarely). */
const corpusCache = new Map<LabelCategory, { at: number; docs: StoredDoc[] }>();
const CORPUS_TTL = 10 * 60 * 1000;

async function corpus(supabase: Awaited<ReturnType<typeof createClient>>, category: LabelCategory): Promise<StoredDoc[] | Fail> {
  const hit = corpusCache.get(category);
  if (hit && Date.now() - hit.at < CORPUS_TTL) return hit.docs;
  const { data, error } = await supabase.from("label_files").select("content_hash").eq("category", category).range(0, 4999);
  if (error) return fail(error);
  const hashes = (data ?? []).map((r: { content_hash: string }) => r.content_hash);
  const docs: StoredDoc[] = [];
  for (let i = 0; i < hashes.length; i += 200) {
    const { data: rows, error: e } = await supabase.rpc("get_label_ocr", { hashes: hashes.slice(i, i + 200) });
    if (e) return fail(e);
    for (const r of rows ?? []) docs.push({ hash: r.content_hash, w: r.page_w, h: r.page_h, lines: r.lines ?? [] });
  }
  corpusCache.set(category, { at: Date.now(), docs });
  return docs;
}

const toPixels = (key: string, d: { w: number; h: number; lines: StoredLine[] }): OcrDoc => ({
  key,
  w: d.w,
  h: d.h,
  lines: d.lines.map((l) => ({ t: l.t, x: l.bbox.x * d.w, y: l.bbox.y * d.h, w: l.bbox.w * d.w, h: l.bbox.h * d.h })),
});

/** 기준 대비 검사: one label against every label of its category in the DB. */
export async function checkAgainstDb(target: {
  hash: string;
  /** "전체": the category couldn't be told, so every stored label is the reference. */
  category: LabelCategory | "전체";
  w: number;
  h: number;
  lines: StoredLine[];
}): Promise<{ ok: true; findings: OcrFinding[]; reference: number } | Fail> {
  const supabase = await signedIn();
  let ref: StoredDoc[] = [];
  for (const c of target.category === "전체" ? (["박스", "스티커", "멸균지"] as LabelCategory[]) : [target.category]) {
    const part = await corpus(supabase, c);
    if (!Array.isArray(part)) return part;
    ref = ref.concat(part);
  }
  const others = ref.filter((d) => d.hash !== target.hash).map((d) => toPixels(d.hash, d));
  const findings = findOcrTypos([...others, toPixels("target", target)], { only: "target" });
  return { ok: true, findings, reference: others.length };
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

/* ---- 판정 학습 (supabase/migrations/20261120_finding_decisions.sql) ---- */

async function names(supabase: Awaited<ReturnType<typeof createClient>>, ids: string[]) {
  const unique = [...new Set(ids)];
  if (!unique.length) return new Map<string, string>();
  const { data } = await supabase.from("user_directory").select("id, email").in("id", unique);
  return new Map((data ?? []).map((p: { id: string; email: string | null }) => [p.id, (p.email ?? "").split("@")[0]]));
}

type DecisionDbRow = { content_hash: string; word: string; suggest: string; decision: FindingDecision; decided_by: string; decided_at: string };

/** Every decision the team made (a few hundred rows at most). */
export async function getFindingDecisions(): Promise<{ ok: true; rows: DecisionRow[] } | Fail> {
  const supabase = await signedIn();
  const { data, error } = await supabase
    .from("finding_decisions")
    .select("content_hash, word, suggest, decision, decided_by, decided_at")
    .order("decided_at", { ascending: false })
    .range(0, 4999);
  if (error) return fail(error);
  const rows = (data ?? []) as DecisionDbRow[];
  const who = await names(supabase, rows.map((r) => r.decided_by));
  return {
    ok: true,
    rows: rows.map((r) => ({ hash: r.content_hash, word: r.word, suggest: r.suggest, decision: r.decision, by: who.get(r.decided_by) ?? "", at: r.decided_at })),
  };
}

/** Saves (or with null, clears) one decision on one file's suspect. */
export async function saveFindingDecision(input: {
  hash: string;
  word: string;
  suggest: string;
  decision: FindingDecision | null;
  fileName: string;
}): Promise<{ ok: true; row: DecisionRow | null } | Fail> {
  const supabase = await signedIn();
  if (!/^[0-9a-f]{64}$/.test(input.hash)) return { ok: false, reason: "error", message: "파일 해시가 올바르지 않습니다." };
  const key = { content_hash: input.hash, word: input.word, suggest: input.suggest };
  if (!input.decision) {
    const { error } = await supabase.from("finding_decisions").delete().match(key);
    return error ? fail(error) : { ok: true, row: null };
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, reason: "error", message: "로그인이 필요합니다." };
  // Whoever decides last is recorded (the row's policy only lets you write as yourself).
  const { data, error } = await supabase
    .from("finding_decisions")
    .upsert({ ...key, decision: input.decision, file_name: input.fileName, decided_by: user.id, decided_at: new Date().toISOString() }, { onConflict: "content_hash,word,suggest" })
    .select("content_hash, word, suggest, decision, decided_by, decided_at")
    .single();
  if (error) return fail(error);
  // A confirmed typo means this file has to be fixed: mark it so in the file
  // decisions (폴더 일괄 검토's «수정 필요») — best effort.
  if (input.decision === "typo") {
    await supabase
      .from("review_decisions")
      .upsert({ content_hash: input.hash, decision: "fix", file_name: input.fileName, decided_by: user.id, decided_at: new Date().toISOString() }, { onConflict: "content_hash" });
  }
  const r = data as DecisionDbRow;
  const who = await names(supabase, [r.decided_by]);
  return { ok: true, row: { hash: r.content_hash, word: r.word, suggest: r.suggest, decision: r.decision, by: who.get(r.decided_by) ?? "", at: r.decided_at } };
}

/* ---- 분류 자동 판별: a file dropped in without a folder path ---- */

const compactLine = (s: string) => s.normalize("NFC").toLowerCase().replace(/\s+/g, "");
const vocabCache = new Map<LabelCategory, { at: number; lines: Set<string> }>();

/** Which category a label belongs to: the one in the DB if it was stored
 *  before, else the category whose labels share the most of its lines
 *  (null when none shares enough — not a 박스·스티커·멸균지 label). */
export async function guessCategory(input: {
  hash: string;
  lines: StoredLine[];
}): Promise<{ ok: true; category: LabelCategory | null; best: LabelCategory | null; share: number } | Fail> {
  const supabase = await signedIn();
  const { data: known } = await supabase.from("label_files").select("category").eq("content_hash", input.hash).maybeSingle();
  if (known?.category) return { ok: true, category: known.category as LabelCategory, best: known.category as LabelCategory, share: 1 };
  const own = [...new Set(input.lines.filter((l) => !l.memo).map((l) => compactLine(l.t)).filter((t) => t.length >= 6))];
  if (!own.length) return { ok: true, category: null, best: null, share: 0 };
  let best: LabelCategory | null = null;
  let bestShare = 0;
  for (const c of ["박스", "스티커", "멸균지"] as LabelCategory[]) {
    let v = vocabCache.get(c);
    if (!v || Date.now() - v.at > CORPUS_TTL) {
      const ref = await corpus(supabase, c);
      if (!Array.isArray(ref)) return ref;
      v = { at: Date.now(), lines: new Set(ref.flatMap((d) => d.lines.filter((l) => !l.memo).map((l) => compactLine(l.t)))) };
      vocabCache.set(c, v);
    }
    const share = own.filter((t) => v!.lines.has(t)).length / own.length;
    if (share > bestShare) {
      best = c;
      bestShare = share;
    }
  }
  return { ok: true, category: bestShare >= 0.15 ? best : null, best, share: bestShare };
}
