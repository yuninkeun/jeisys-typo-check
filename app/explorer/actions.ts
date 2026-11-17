"use server";

import { createClient } from "@/lib/supabase/server";

export type Decision = "ok" | "fix" | "hold";
export type SavedDecision = { decision: Decision; by: string; at: string };

/** "not_ready" = the review_decisions table hasn't been created yet
 *  (supabase/migrations/20261117_review_decisions.sql). */
export type DecisionsResult = { ok: true; byHash: Record<string, SavedDecision> } | { ok: false; reason: "not_ready" | "error"; message?: string };

function missingTable(err: { code?: string; message?: string } | null) {
  return !!err && (err.code === "42P01" || err.code === "PGRST205" || /review_decisions/.test(err.message ?? ""));
}

async function signedIn() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("로그인이 필요합니다.");
  return { supabase, user };
}

/** Decisions the team already made for these files (by content hash), with who made them. */
export async function getDecisions(hashes: string[]): Promise<DecisionsResult> {
  const { supabase } = await signedIn();
  const unique = [...new Set(hashes)].filter(Boolean).slice(0, 500);
  if (!unique.length) return { ok: true, byHash: {} };
  const { data, error } = await supabase
    .from("review_decisions")
    .select("content_hash, decision, decided_by, decided_at")
    .in("content_hash", unique);
  if (error) return missingTable(error) ? { ok: false, reason: "not_ready" } : { ok: false, reason: "error", message: error.message };

  const ids = [...new Set((data ?? []).map((r) => r.decided_by))];
  const { data: people } = ids.length
    ? await supabase.from("user_directory").select("id, email").in("id", ids)
    : { data: [] as { id: string; email: string }[] };
  const name = new Map((people ?? []).map((p) => [p.id, (p.email ?? "").split("@")[0]]));

  const byHash: Record<string, SavedDecision> = {};
  for (const r of data ?? []) byHash[r.content_hash] = { decision: r.decision as Decision, by: name.get(r.decided_by) ?? "", at: r.decided_at };
  return { ok: true, byHash };
}

/** Saves (or with null, clears) the decision for one file. */
export async function saveDecision(input: {
  hash: string;
  decision: Decision | null;
  fileName: string;
  filePath: string;
}): Promise<{ ok: true; saved: SavedDecision | null } | { ok: false; reason: "not_ready" | "error"; message?: string }> {
  const { supabase, user } = await signedIn();
  if (!/^[0-9a-f]{64}$/.test(input.hash)) return { ok: false, reason: "error", message: "파일을 구분할 수 없습니다." };
  if (input.decision === null) {
    const { error } = await supabase.from("review_decisions").delete().eq("content_hash", input.hash);
    if (error) return missingTable(error) ? { ok: false, reason: "not_ready" } : { ok: false, reason: "error", message: error.message };
    return { ok: true, saved: null };
  }
  if (!["ok", "fix", "hold"].includes(input.decision)) return { ok: false, reason: "error" };
  const at = new Date().toISOString();
  const { error } = await supabase.from("review_decisions").upsert({
    content_hash: input.hash,
    decision: input.decision,
    file_name: input.fileName.slice(0, 300),
    file_path: input.filePath.slice(0, 1000),
    decided_by: user.id,
    decided_at: at,
  });
  if (error) return missingTable(error) ? { ok: false, reason: "not_ready" } : { ok: false, reason: "error", message: error.message };
  return { ok: true, saved: { decision: input.decision, by: (user.email ?? "").split("@")[0], at } };
}
