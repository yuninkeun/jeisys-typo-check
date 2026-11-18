"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getCheckResult, uploadAndCheck } from "../check/actions";
import { getDecisions, saveDecision, type Decision, type SavedDecision } from "./actions";
import { entryKey, filesUnder, type DirNode, type FileEntry } from "./file-tree";
import { toUploadable } from "./file-panel";

export type { Decision } from "./actions";

/** A folder review runs about 10–30 seconds per new file, so it is capped. */
export const BATCH_LIMIT = 200;
const CONCURRENCY = 3;

export const DECISIONS: { value: Decision; label: string; cls: string }[] = [
  { value: "ok", label: "문제없음", cls: "border-pass-line bg-pass-soft text-pass" },
  { value: "fix", label: "수정 필요", cls: "border-flag-line bg-flag-soft text-flag" },
  { value: "hold", label: "보류", cls: "border-line-strong bg-canvas text-ink-muted" },
];

type Status = "wait" | "run" | "done" | "error";
export type BatchItem = {
  entry: FileEntry;
  status: Status;
  /** sha256 of the checked bytes — the same as documents.content_hash, so a
   *  decision follows the file whichever PC or folder it is opened from. */
  hash?: string;
  lines?: number;
  flagged?: number;
  /** First few flagged lines, for the summary. */
  samples?: { text: string; to?: string }[];
  cached?: boolean;
  note?: string;
  error?: string;
};

export type Batch = ReturnType<typeof useBatch>;

/** "server" = shared with the team; "local" = the table isn't set up yet, so
 *  decisions stay in this browser until it is. */
type Store = "server" | "local";
const LOCAL_KEY = "jeisys-typo-decisions";

function loadLocal(): Record<string, Decision> {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_KEY) ?? "{}");
  } catch {
    return {};
  }
}

async function sha256(file: File) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The AI service's raw error text means nothing to a reviewer. */
function friendly(err: unknown) {
  const msg = err instanceof Error ? err.message : "";
  if (/invalid_file|badly formatted|corrupt/i.test(msg))
    return "파일을 읽을 수 없습니다 — 손상됐거나, PDF 호환 저장이 꺼진 AI 파일일 수 있습니다.";
  if (/429|rate limit/i.test(msg)) return "AI 요청이 많아 잠시 거절됐습니다. 나중에 다시 검토해 주세요.";
  if (/timeout|timed out|504/i.test(msg)) return "시간 안에 끝나지 않았습니다. 파일을 열어 다시 검사해 주세요.";
  return msg.length > 120 ? `${msg.slice(0, 120)}…` : msg || "검사하지 못했습니다.";
}

async function checkOne(entry: FileEntry): Promise<Partial<BatchItem>> {
  const { file, note } = await toUploadable(entry);
  const hash = await sha256(file);
  const fd = new FormData();
  fd.append("file", file);
  let state = await uploadAndCheck({}, fd);
  const cached = !!state.duplicateOf;
  if (state.duplicateOf) state = await getCheckResult(state.duplicateOf.id);
  if (state.error) throw Object.assign(new Error(state.error), { hash });
  const lines = state.lines ?? [];
  const flagged = lines.filter((l) => l.is_flagged);
  return {
    hash,
    lines: lines.length,
    flagged: flagged.length,
    samples: flagged.slice(0, 3).map((l) => ({ text: l.text, to: l.suggested_text })),
    cached,
    note,
  };
}

/** Every file under the picked folders once (a folder inside another picked
 *  folder adds nothing twice), in the order the folders were picked. */
function uniqueFiles(folders: DirNode[]) {
  const seen = new Set<string>();
  const out: FileEntry[] = [];
  for (const f of folders)
    for (const e of filesUnder(f))
      if (!seen.has(entryKey(e))) {
        seen.add(entryKey(e));
        out.push(e);
      }
  return out;
}

const isTarget = (e: FileEntry, withPdf: boolean) => e.ext === "ai" || (withPdf && e.ext === "pdf");

const targetCount = (folders: DirNode[], withPdf: boolean) =>
  uniqueFiles(folders).filter((e) => isTarget(e, withPdf)).length;

/** 경고창 for a pick over the limit. "blocked": adding it was refused;
 *  "trimmed": one folder alone is over, so only the first BATCH_LIMIT are taken.
 *  (Shown on the page: window.alert/confirm don't show in some embedded
 *  browsers, such as the Claude desktop app's.) */
export type LimitAsk = { n: number; kind: "blocked" | "trimmed"; what: "folder" | "pdf" };

/** Folder review: checks the folder's files a few at a time; the reviewer's
 *  decision per file is saved on the server so the whole team sees it. */
export function useBatch() {
  /** Folders picked for one review — «검토» on another folder adds it. */
  const [folders, setFolders] = useState<DirNode[]>([]);
  const [withPdf, setWithPdf] = useState(false);
  const [items, setItems] = useState<BatchItem[]>([]);
  const [running, setRunning] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [store, setStore] = useState<Store>("server");
  /** Server decisions by content hash. */
  const [saved, setSaved] = useState<Record<string, SavedDecision>>({});
  /** Browser-only decisions by path, used while the server table is missing. */
  const [local, setLocal] = useState<Record<string, Decision>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const stopRef = useRef(false);
  const runRef = useRef(0);
  const storeRef = useRef<Store>("server");

  useEffect(() => {
    void Promise.resolve().then(() => setLocal(loadLocal()));
  }, []);

  function goLocal() {
    storeRef.current = "local";
    setStore("local");
  }

  const files = useMemo(() => uniqueFiles(folders), [folders]);

  const candidates = useMemo(() => {
    const all = files.filter((e) => isTarget(e, withPdf));
    return { all: all.length, list: all.slice(0, BATCH_LIMIT) };
  }, [files, withPdf]);

  /** One line for the picked folders, as one block for the header and the CSV. */
  const folder = useMemo(() => {
    if (!folders.length) return null;
    const last = (n: DirNode) => n.name.split(" / ").pop() ?? n.name;
    return {
      name: folders.length === 1 ? folders[0].name : `${last(folders[0])} 외 ${folders.length - 1}개 폴더`,
      fileName: folders.length === 1 ? last(folders[0]) : `${last(folders[0])}_외${folders.length - 1}개`,
      ai: files.filter((e) => e.ext === "ai").length,
      pdf: files.filter((e) => e.ext === "pdf").length,
    };
  }, [folders, files]);

  function reset() {
    stopRef.current = true;
    runRef.current++;
    setRunning(false);
    setItems([]);
    setStartedAt(null);
  }

  /** «검토» on a folder: before a review starts it adds the folder to (or takes
   *  it out of) the picked folders; once one has run, it starts a new pick. */
  const [limitAsk, setLimitAsk] = useState<LimitAsk | null>(null);

  function closeLimit() {
    setLimitAsk(null);
  }

  /** One folder alone may be over the limit (its first BATCH_LIMIT files are
   *  checked, with a warning); adding to a pick past the limit is refused. */
  function choose(node: DirNode) {
    const fresh = items.length > 0 || folders.length === 0;
    if (!fresh && folders.some((f) => f.path === node.path)) {
      setFolders(folders.filter((f) => f.path !== node.path));
      return;
    }
    const next = fresh ? [node] : [...folders, node];
    const n = targetCount(next, withPdf);
    if (n > BATCH_LIMIT && !fresh) {
      setLimitAsk({ n, kind: "blocked", what: "folder" });
      return;
    }
    if (items.length > 0) reset();
    setFolders(next);
    if (n > BATCH_LIMIT) setLimitAsk({ n, kind: "trimmed", what: "folder" });
  }

  /** Taking PDFs in can push the pick over the limit too. */
  function changeWithPdf(on: boolean) {
    if (!on) return setWithPdf(false);
    const n = targetCount(folders, true);
    if (n > BATCH_LIMIT && targetCount(folders, false) <= BATCH_LIMIT)
      return setLimitAsk({ n, kind: "blocked", what: "pdf" });
    setWithPdf(true);
  }

  function remove(path: string) {
    setFolders((prev) => prev.filter((f) => f.path !== path));
  }

  function close() {
    reset();
    setFolders([]);
  }

  /** Pulls the team's decisions for files just checked. */
  async function pull(hashes: string[]) {
    if (storeRef.current === "local" || !hashes.length) return;
    try {
      const res = await getDecisions(hashes);
      if (res.ok) setSaved((prev) => ({ ...prev, ...res.byHash }));
      else if (res.reason === "not_ready") goLocal();
    } catch {
      // Reading decisions is best-effort; the review itself goes on.
    }
  }

  async function start() {
    const list = candidates.list;
    if (!list.length) return;
    stopRef.current = false;
    // A run stopped a moment ago may still be finishing its last files: only
    // the newest run may write to the list.
    const run = ++runRef.current;
    setRunning(true);
    setStartedAt(Date.now());
    setItems(list.map((entry) => ({ entry, status: "wait" })));
    const patch = (i: number, p: Partial<BatchItem>) =>
      run === runRef.current && setItems((prev) => prev.map((it, k) => (k === i ? { ...it, ...p } : it)));
    let next = 0;
    const pending: string[] = [];
    async function worker() {
      while (next < list.length && !stopRef.current && run === runRef.current) {
        const i = next++;
        patch(i, { status: "run" });
        try {
          const result = await checkOne(list[i]);
          patch(i, { status: "done", ...result });
          if (result.hash) pending.push(result.hash);
          // Fetch decisions in small groups rather than one request per file.
          if (pending.length >= 6) void pull(pending.splice(0));
        } catch (err) {
          patch(i, { status: "error", error: friendly(err), hash: (err as { hash?: string }).hash });
        }
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    void pull(pending.splice(0));
    if (run === runRef.current) setRunning(false);
  }

  function stop() {
    stopRef.current = true;
  }

  const itemOf = (entry: FileEntry) => items.find((it) => entryKey(it.entry) === entryKey(entry));

  function decideLocal(entry: FileEntry, d: Decision | null) {
    setLocal((prev) => {
      const next = { ...prev };
      if (d) next[entryKey(entry)] = d;
      else delete next[entryKey(entry)];
      try {
        localStorage.setItem(LOCAL_KEY, JSON.stringify(next));
      } catch {
        // Private window: decisions last for this visit only.
      }
      return next;
    });
  }

  async function decide(entry: FileEntry, d: Decision | null) {
    const hash = itemOf(entry)?.hash;
    if (storeRef.current === "local" || !hash) return decideLocal(entry, d);
    setSaveError(null);
    const before = saved[hash];
    // Show it at once; put it back if the server refuses.
    setSaved((prev) => {
      const next = { ...prev };
      if (d) next[hash] = { decision: d, by: "나", at: new Date().toISOString() };
      else delete next[hash];
      return next;
    });
    try {
      const res = await saveDecision({ hash, decision: d, fileName: entry.name, filePath: entryKey(entry) });
      if (res.ok) {
        setSaved((prev) => {
          const next = { ...prev };
          if (res.saved) next[hash] = res.saved;
          else delete next[hash];
          return next;
        });
        return;
      }
      if (res.reason === "not_ready") {
        goLocal();
        decideLocal(entry, d);
        return;
      }
      throw new Error(res.message);
    } catch (err) {
      setSaved((prev) => {
        const next = { ...prev };
        if (before) next[hash] = before;
        else delete next[hash];
        return next;
      });
      setSaveError(`결정을 저장하지 못했습니다${err instanceof Error && err.message ? `: ${err.message}` : ""}. 다시 눌러 주세요.`);
    }
  }

  function infoOf(entry: FileEntry): SavedDecision | null {
    if (store === "local") {
      const d = local[entryKey(entry)];
      return d ? { decision: d, by: "", at: "" } : null;
    }
    const hash = itemOf(entry)?.hash;
    return hash ? (saved[hash] ?? null) : null;
  }

  const decisionOf = (entry: FileEntry) => infoOf(entry)?.decision ?? null;

  return {
    folder,
    folders,
    remove,
    limitAsk,
    closeLimit,
    withPdf,
    setWithPdf: changeWithPdf,
    candidates,
    items,
    running,
    startedAt,
    store,
    saveError,
    choose,
    close,
    start,
    stop,
    decide,
    decisionOf,
    infoOf,
  };
}

type Filter = "all" | "flagged" | "undecided" | "error";

function sortItems(items: BatchItem[]) {
  // Files with the most suspected typos first; still-running ones after.
  const rank = (it: BatchItem) => (it.status === "done" ? 0 : it.status === "error" ? 1 : 2);
  return [...items].sort((a, b) => rank(a) - rank(b) || (b.flagged ?? 0) - (a.flagged ?? 0));
}

/** The files the reviewer steps through, in the order shown in the summary. */
export function reviewOrder(batch: Batch) {
  return sortItems(batch.items).filter((it) => it.status === "done" || it.status === "error");
}

function csv(batch: Batch) {
  const label = (d: Decision | null) => DECISIONS.find((x) => x.value === d)?.label ?? "미결정";
  const rows = [["파일", "경로", "상태", "글자 줄", "오타 의심", "담당자 결정", "결정한 사람", "결정 시각", "의심 예시"]];
  for (const it of sortItems(batch.items)) {
    const info = batch.infoOf(it.entry);
    rows.push([
      it.entry.name,
      entryKey(it.entry),
      it.status === "done" ? "완료" : it.status === "error" ? `오류: ${it.error}` : "미검사",
      String(it.lines ?? ""),
      String(it.flagged ?? ""),
      label(info?.decision ?? null),
      info?.by ?? "",
      info?.at ? new Date(info.at).toLocaleString("ko-KR") : "",
      (it.samples ?? []).map((s) => (s.to ? `${s.text} → ${s.to}` : s.text)).join(" / "),
    ]);
  }
  const text = rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob(["﻿", text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  const d = new Date();
  a.download = `일괄검토_${batch.folder?.fileName}_${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Card({ n, label, cls = "", onClick, active }: { n: number; label: string; cls?: string; onClick?: () => void; active?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col rounded border px-3 py-2 text-left ${cls} ${active ? "ring-2 ring-brand-500" : ""}`}
    >
      <span className="text-xl font-bold tabular-nums">{n.toLocaleString()}</span>
      <span className="text-xs opacity-80">{label}</span>
    </button>
  );
}

function shortDate(at: string) {
  const d = new Date(at);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export function DecisionButtons({ batch, entry, size = "sm" }: { batch: Batch; entry: FileEntry; size?: "sm" | "md" }) {
  const info = batch.infoOf(entry);
  const cur = info?.decision ?? null;
  return (
    <span className="flex shrink-0 items-center gap-1">
      {info?.by && (
        <span className="mr-0.5 text-[11px] text-ink-faint" title={info.at ? new Date(info.at).toLocaleString("ko-KR") : ""}>
          {info.by}
          {info.at && ` · ${shortDate(info.at)}`}
        </span>
      )}
      {DECISIONS.map((d) => (
        <button
          key={d.value}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            void batch.decide(entry, cur === d.value ? null : d.value);
          }}
          className={`rounded-sm border font-medium ${size === "md" ? "px-3 py-1 text-sm" : "px-1.5 py-0.5 text-[11px]"} ${
            cur === d.value ? d.cls : "border-line text-ink-faint hover:bg-canvas"
          }`}
        >
          {d.label}
        </button>
      ))}
    </span>
  );
}

export function BatchPanel({ batch, onOpen }: { batch: Batch; onOpen: (e: FileEntry) => void }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [now, setNow] = useState(0);
  const { folder, items, running, candidates } = batch;

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);

  if (!folder) return null;
  const done = items.filter((i) => i.status === "done");
  const errors = items.filter((i) => i.status === "error");
  const finished = done.length + errors.length;
  const withTypos = done.filter((i) => (i.flagged ?? 0) > 0);
  const undecided = items.filter((i) => i.status === "done" && !batch.decisionOf(i.entry));
  const counts = Object.fromEntries(DECISIONS.map((d) => [d.value, items.filter((i) => batch.decisionOf(i.entry) === d.value).length]));
  const elapsed = batch.startedAt && now ? (now - batch.startedAt) / 1000 : 0;
  const left = finished && running ? Math.round(((elapsed / finished) * (items.length - finished)) / 60) : null;

  const shown = sortItems(items).filter((it) =>
    filter === "flagged"
      ? (it.flagged ?? 0) > 0
      : filter === "undecided"
        ? it.status === "done" && !batch.decisionOf(it.entry)
        : filter === "error"
          ? it.status === "error"
          : true,
  );

  return (
    <article className="flex flex-col overflow-hidden rounded border border-line bg-surface">
      <header className="flex flex-col gap-1 border-b border-line bg-canvas px-5 py-3">
        <div className="flex items-center gap-2">
          <h2 className="min-w-0 flex-1 break-all text-sm font-bold text-ink">📁 {folder.name} — 일괄 검토</h2>
          <button type="button" onClick={batch.close} className="shrink-0 text-xs text-ink-muted underline hover:text-ink">
            닫기
          </button>
        </div>
        <p className="text-xs text-ink-faint">
          {batch.folders.length > 1 ? `폴더 ${batch.folders.length}개` : "폴더"} 안 AI {folder.ai.toLocaleString()}개 · PDF{" "}
          {folder.pdf.toLocaleString()}개 · 한 번에 최대 {BATCH_LIMIT}개까지 검토합니다.
        </p>
        {items.length === 0 && (
          <>
            {batch.folders.length > 1 && (
              <ul className="flex flex-wrap gap-1.5 pt-1">
                {batch.folders.map((f) => (
                  <li
                    key={f.path}
                    className="flex max-w-full items-center gap-1 rounded-full border border-line bg-surface py-0.5 pl-2.5 pr-1 text-[11px] text-ink"
                  >
                    <span className="truncate" title={f.path}>
                      {f.name}
                    </span>
                    <span className="shrink-0 tabular-nums text-ink-faint">AI {f.ai}</span>
                    <button
                      type="button"
                      onClick={() => batch.remove(f.path)}
                      aria-label={`${f.name} 빼기`}
                      className="shrink-0 rounded-full px-1 text-ink-muted hover:bg-canvas hover:text-ink"
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-[11px] text-ink-muted">
              다른 폴더 줄의 <b className="text-brand-700">검토</b>를 누르면 함께 검토할 폴더로 더해집니다(다시 누르면 빠짐).
            </p>
          </>
        )}
      </header>

      <div className="flex flex-col gap-4 p-5">
        {items.length === 0 ? (
          <div className="flex flex-col gap-3">
            <label className="flex w-fit items-center gap-2 text-sm text-ink">
              <input type="checkbox" checked={batch.withPdf} onChange={(e) => batch.setWithPdf(e.target.checked)} />
              PDF도 함께 검토 (기본은 AI 파일만)
            </label>
            {candidates.all === 0 ? (
              <p className="rounded border border-dashed border-line-strong px-3 py-4 text-center text-sm text-ink-muted">
                {batch.folders.length > 1 ? "고른 폴더들" : "이 폴더"}에는 검토할 {batch.withPdf ? "AI·PDF" : "AI"} 파일이 없습니다.
              </p>
            ) : (
              <>
                <p className="text-sm text-ink">
                  검토 대상 <b>{candidates.list.length.toLocaleString()}개</b>
                  {candidates.all > BATCH_LIMIT && (
                    <span className="text-flag"> (전체 {candidates.all.toLocaleString()}개 중 트리 순서로 앞 {BATCH_LIMIT}개 — 나머지는 폴더를 나눠 따로 검토하세요)</span>
                  )}
                </p>
                <p className="text-xs leading-relaxed text-ink-muted">
                  새 파일은 1개에 10~30초 걸리고 AI 비용이 듭니다. 전에 검사한 파일은 저장된 결과를 바로 불러옵니다.
                  3개씩 동시에 검사하며, 도중에 멈출 수 있고 이 창을 닫지 않는 동안 계속 진행됩니다.
                </p>
                <button
                  type="button"
                  onClick={() => void batch.start()}
                  className="h-10 w-fit rounded bg-brand-700 px-4 text-sm font-medium text-white hover:bg-brand-800"
                >
                  {candidates.list.length}개 일괄 검토 시작
                </button>
              </>
            )}
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2 text-xs text-ink-muted">
                <span className="font-medium text-ink">
                  {running ? "검토 중" : finished === items.length ? "검토 완료" : "멈춤"} · {finished}/{items.length}
                </span>
                {left != null && <span>· 남은 시간 약 {Math.max(1, left)}분</span>}
                <span className="ml-auto flex gap-2">
                  {running ? (
                    <button type="button" onClick={batch.stop} className="rounded-sm border border-line-strong px-2 py-0.5 hover:bg-canvas">
                      멈추기
                    </button>
                  ) : (
                    finished < items.length && (
                      <button type="button" onClick={() => void batch.start()} className="rounded-sm border border-line-strong px-2 py-0.5 hover:bg-canvas">
                        처음부터 다시
                      </button>
                    )
                  )}
                  <button type="button" onClick={() => csv(batch)} className="rounded-sm border border-line-strong px-2 py-0.5 hover:bg-canvas">
                    요약 CSV 받기
                  </button>
                </span>
              </div>
              <span className="block h-2 overflow-hidden rounded-full bg-canvas">
                <span className="block h-full bg-brand-700 transition-all" style={{ width: `${(finished / items.length) * 100}%` }} />
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Card n={finished} label="검사 끝" cls="border-line bg-surface text-ink" onClick={() => setFilter("all")} active={filter === "all"} />
              <Card n={withTypos.length} label="오타 의심 있는 파일" cls="border-flag-line bg-flag-soft text-flag" onClick={() => setFilter("flagged")} active={filter === "flagged"} />
              <Card n={undecided.length} label="담당자 결정 전" cls="border-brand-200 bg-brand-50 text-brand-700" onClick={() => setFilter("undecided")} active={filter === "undecided"} />
              <Card n={errors.length} label="검사 오류" cls="border-line-strong bg-canvas text-ink-muted" onClick={() => setFilter("error")} active={filter === "error"} />
            </div>
            <p className="text-xs text-ink-muted">
              담당자 결정: 문제없음 {counts.ok} · 수정 필요 {counts.fix} · 보류 {counts.hold}
              <span className="text-ink-faint"> — 파일을 눌러 열어 보고, 위쪽 버튼으로 결정한 뒤 &quot;다음 파일&quot;로 넘어가면 됩니다.</span>
            </p>
            {batch.store === "server" ? (
              <p className="text-[11px] text-ink-faint">
                결정은 서버에 저장되어 팀 모두에게 보입니다. 같은 파일이면 다른 PC·다른 폴더에서 열어도 같은 결정과 결정한 사람이 나옵니다.
              </p>
            ) : (
              <p className="rounded border border-flag-line bg-flag-soft px-3 py-2 text-xs text-flag">
                서버 저장소가 아직 준비되지 않아, 결정이 이 브라우저에만 저장됩니다. (관리자: supabase/migrations/20261117_review_decisions.sql 실행 필요)
              </p>
            )}
            {batch.saveError && (
              <p role="alert" className="rounded border border-flag-line bg-flag-soft px-3 py-2 text-xs text-flag">
                {batch.saveError}
              </p>
            )}

            <ul className="flex flex-col divide-y divide-line rounded border border-line">
              {shown.map((it) => {
                const dir = entryKey(it.entry).split("/").slice(0, -1).join(" / ");
                return (
                  <li key={entryKey(it.entry)}>
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => it.status !== "wait" && it.status !== "run" && onOpen(it.entry)}
                      onKeyDown={(e) => e.key === "Enter" && onOpen(it.entry)}
                      className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-xs ${
                        it.status === "done" || it.status === "error" ? "cursor-pointer hover:bg-canvas" : "opacity-60"
                      }`}
                    >
                      <span className="w-14 shrink-0 font-medium">
                        {it.status === "wait" ? (
                          <span className="text-ink-faint">대기</span>
                        ) : it.status === "run" ? (
                          <span className="text-brand-700">검사 중…</span>
                        ) : it.status === "error" ? (
                          <span className="text-ink-muted">오류</span>
                        ) : (it.flagged ?? 0) > 0 ? (
                          <span className="text-flag">의심 {it.flagged}</span>
                        ) : (
                          <span className="text-pass">의심 없음</span>
                        )}
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-[13px] text-ink" title={entryKey(it.entry)}>
                          {it.entry.name}
                          {it.cached && <span className="ml-1 text-[11px] text-ink-faint">(저장된 결과)</span>}
                        </span>
                        {dir && <span className="truncate text-[11px] text-ink-faint">{dir}</span>}
                        {it.samples && it.samples.length > 0 && (
                          <span className="truncate text-[11px] text-flag">
                            {it.samples.map((s) => (s.to && s.to !== s.text ? `${s.text} → ${s.to}` : s.text)).join(" · ")}
                          </span>
                        )}
                        {it.error && <span className="truncate text-[11px] text-ink-muted">{it.error}</span>}
                      </span>
                      {it.status === "done" && <DecisionButtons batch={batch} entry={it.entry} />}
                    </div>
                  </li>
                );
              })}
              {shown.length === 0 && <li className="px-3 py-4 text-center text-xs text-ink-faint">해당하는 파일이 없습니다.</li>}
            </ul>
          </>
        )}
      </div>
    </article>
  );
}

/** 경고창: the pick goes over what one review can check. */
export function LimitDialog({ batch }: { batch: Batch }) {
  const ask = batch.limitAsk;
  const okRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (ask) okRef.current?.focus();
  }, [ask]);
  useEffect(() => {
    if (!ask) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && batch.closeLimit();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ask, batch]);
  if (!ask) return null;
  const blocked = ask.kind === "blocked";
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[color-mix(in_srgb,var(--txt,#111)_45%,transparent)] p-4"
      onClick={batch.closeLimit}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="limit-title"
        onClick={(e) => e.stopPropagation()}
        className="flex w-full max-w-md flex-col gap-3 rounded-lg border border-line bg-surface p-5 text-sm text-ink"
      >
        <h2 id="limit-title" className="text-base font-bold text-warn">
          ⚠ 검토 한도 {BATCH_LIMIT}개 초과
        </h2>
        {blocked ? (
          <>
            <p>
              {ask.what === "pdf" ? "PDF까지 넣으면" : "이 폴더를 더하면"} 검토 대상이 <b>{ask.n.toLocaleString()}개</b>가 되어, 한 번에
              검토할 수 있는 {BATCH_LIMIT}개를 넘습니다.
            </p>
            <p className="rounded-md bg-warn-soft px-3 py-2 text-xs text-warn">
              {ask.what === "pdf" ? "PDF는 넣지 않았습니다." : "이 폴더는 선택하지 않았습니다."} 지금 고른 것을 먼저 검토한 뒤, 따로
              검토하세요.
            </p>
          </>
        ) : (
          <>
            <p>
              이 폴더의 검토 대상은 <b>{ask.n.toLocaleString()}개</b>로, 한 번에 검토할 수 있는 {BATCH_LIMIT}개를 넘습니다.
            </p>
            <p className="rounded-md bg-warn-soft px-3 py-2 text-xs text-warn">
              앞 {BATCH_LIMIT}개만 검토되고 나머지 {(ask.n - BATCH_LIMIT).toLocaleString()}개는 빠집니다. 빠짐없이 하려면 하위 폴더를
              골라 나눠 검토하세요.
            </p>
          </>
        )}
        <div className="flex justify-end pt-1">
          <button
            ref={okRef}
            type="button"
            onClick={batch.closeLimit}
            className="h-9 min-w-20 rounded-md bg-brand-700 px-4 font-medium text-white hover:bg-brand-800"
          >
            확인
          </button>
        </div>
      </div>
    </div>
  );
}

/** Shown above a file opened from the review: decide, then step to the next one. */
export function ReviewBar({ batch, entry, onOpen, onBack }: { batch: Batch; entry: FileEntry; onOpen: (e: FileEntry) => void; onBack: () => void }) {
  const order = reviewOrder(batch);
  const i = order.findIndex((it) => entryKey(it.entry) === entryKey(entry));
  const item = order[i];
  const go = (k: number) => order[k] && onOpen(order[k].entry);
  return (
    <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded border border-brand-200 bg-brand-50 px-3 py-2 text-xs">
      <button type="button" onClick={onBack} className="font-medium text-brand-700 underline">
        ← 일괄 검토 요약
      </button>
      {i >= 0 ? (
        <>
          <span className="text-ink-muted">
            {i + 1}/{order.length}
            {item?.status === "done" && ` · 오타 의심 ${item.flagged}건`}
          </span>
          <span className="ml-auto flex flex-wrap items-center gap-2">
            <DecisionButtons batch={batch} entry={entry} size="md" />
            <button type="button" disabled={i <= 0} onClick={() => go(i - 1)} className="rounded-sm border border-line-strong bg-surface px-2 py-1 disabled:opacity-40">
              ◀ 이전
            </button>
            <button type="button" disabled={i >= order.length - 1} onClick={() => go(i + 1)} className="rounded-sm border border-line-strong bg-surface px-2 py-1 disabled:opacity-40">
              다음 파일 ▶
            </button>
          </span>
        </>
      ) : (
        <span className="text-ink-faint">이 파일은 일괄 검토 대상이 아닙니다.</span>
      )}
    </div>
  );
}
