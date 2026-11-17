"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getCheckResult, uploadAndCheck } from "../check/actions";
import { entryKey, filesUnder, type DirNode, type FileEntry } from "./file-tree";
import { toUploadable } from "./file-panel";

/** A folder review runs about 10–30 seconds per new file, so it is capped. */
export const BATCH_LIMIT = 200;
const CONCURRENCY = 3;

export type Decision = "ok" | "fix" | "hold";
export const DECISIONS: { value: Decision; label: string; cls: string }[] = [
  { value: "ok", label: "문제없음", cls: "border-pass-line bg-pass-soft text-pass" },
  { value: "fix", label: "수정 필요", cls: "border-flag-line bg-flag-soft text-flag" },
  { value: "hold", label: "보류", cls: "border-line-strong bg-canvas text-ink-muted" },
];

type Status = "wait" | "run" | "done" | "error";
export type BatchItem = {
  entry: FileEntry;
  status: Status;
  lines?: number;
  flagged?: number;
  /** First few flagged lines, for the summary. */
  samples?: { text: string; to?: string }[];
  cached?: boolean;
  note?: string;
  error?: string;
};

export type Batch = ReturnType<typeof useBatch>;

const STORE = "jeisys-typo-decisions";

function loadDecisions(): Record<string, Decision> {
  try {
    return JSON.parse(localStorage.getItem(STORE) ?? "{}");
  } catch {
    return {};
  }
}

async function checkOne(entry: FileEntry): Promise<Partial<BatchItem>> {
  const { file, note } = await toUploadable(entry);
  const fd = new FormData();
  fd.append("file", file);
  let state = await uploadAndCheck({}, fd);
  const cached = !!state.duplicateOf;
  if (state.duplicateOf) state = await getCheckResult(state.duplicateOf.id);
  if (state.error) throw new Error(state.error);
  const lines = state.lines ?? [];
  const flagged = lines.filter((l) => l.is_flagged);
  return {
    lines: lines.length,
    flagged: flagged.length,
    samples: flagged.slice(0, 3).map((l) => ({ text: l.text, to: l.suggested_text })),
    cached,
    note,
  };
}

/** Folder review: checks the folder's files a few at a time and keeps the
 *  reviewer's decision per file (kept in this browser across visits). */
export function useBatch() {
  const [folder, setFolder] = useState<DirNode | null>(null);
  const [withPdf, setWithPdf] = useState(false);
  const [items, setItems] = useState<BatchItem[]>([]);
  const [running, setRunning] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const stopRef = useRef(false);
  const runRef = useRef(0);

  useEffect(() => {
    void Promise.resolve().then(() => setDecisions(loadDecisions()));
  }, []);

  const candidates = useMemo(() => {
    if (!folder) return { all: 0, list: [] as FileEntry[] };
    const all = filesUnder(folder).filter((e) => e.ext === "ai" || (withPdf && e.ext === "pdf"));
    return { all: all.length, list: all.slice(0, BATCH_LIMIT) };
  }, [folder, withPdf]);

  function choose(node: DirNode) {
    stopRef.current = true;
    runRef.current++;
    setRunning(false);
    setFolder(node);
    setItems([]);
    setStartedAt(null);
  }

  function close() {
    stopRef.current = true;
    runRef.current++;
    setRunning(false);
    setFolder(null);
    setItems([]);
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
    async function worker() {
      while (next < list.length && !stopRef.current && run === runRef.current) {
        const i = next++;
        patch(i, { status: "run" });
        try {
          patch(i, { status: "done", ...(await checkOne(list[i])) });
        } catch (err) {
          patch(i, { status: "error", error: err instanceof Error ? err.message : "검사하지 못했습니다." });
        }
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    if (run === runRef.current) setRunning(false);
  }

  function stop() {
    stopRef.current = true;
  }

  function decide(entry: FileEntry, d: Decision | null) {
    setDecisions((prev) => {
      const next = { ...prev };
      if (d) next[entryKey(entry)] = d;
      else delete next[entryKey(entry)];
      try {
        localStorage.setItem(STORE, JSON.stringify(next));
      } catch {
        // Private window: decisions last for this visit only.
      }
      return next;
    });
  }

  const decisionOf = (entry: FileEntry) => decisions[entryKey(entry)] ?? null;

  return { folder, withPdf, setWithPdf, candidates, items, running, startedAt, choose, close, start, stop, decide, decisionOf };
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
  const rows = [["파일", "경로", "상태", "글자 줄", "오타 의심", "담당자 결정", "의심 예시"]];
  for (const it of sortItems(batch.items)) {
    rows.push([
      it.entry.name,
      entryKey(it.entry),
      it.status === "done" ? "완료" : it.status === "error" ? `오류: ${it.error}` : "미검사",
      String(it.lines ?? ""),
      String(it.flagged ?? ""),
      label(batch.decisionOf(it.entry)),
      (it.samples ?? []).map((s) => (s.to ? `${s.text} → ${s.to}` : s.text)).join(" / "),
    ]);
  }
  const text = rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob(["﻿", text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  const d = new Date();
  a.download = `일괄검토_${batch.folder?.name.split(" / ").pop()}_${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}.csv`;
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

export function DecisionButtons({ batch, entry, size = "sm" }: { batch: Batch; entry: FileEntry; size?: "sm" | "md" }) {
  const cur = batch.decisionOf(entry);
  return (
    <span className="flex shrink-0 gap-1">
      {DECISIONS.map((d) => (
        <button
          key={d.value}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            batch.decide(entry, cur === d.value ? null : d.value);
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
          폴더 안 AI {folder.ai.toLocaleString()}개 · PDF {folder.pdf.toLocaleString()}개 · 한 번에 최대 {BATCH_LIMIT}개까지 검토합니다.
        </p>
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
                이 폴더에는 검토할 {batch.withPdf ? "AI·PDF" : "AI"} 파일이 없습니다.
              </p>
            ) : (
              <>
                <p className="text-sm text-ink">
                  검토 대상 <b>{candidates.list.length.toLocaleString()}개</b>
                  {candidates.all > BATCH_LIMIT && (
                    <span className="text-flag"> (전체 {candidates.all.toLocaleString()}개 중 트리 순서로 앞 {BATCH_LIMIT}개 — 나머지는 하위 폴더를 골라 따로 검토하세요)</span>
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
                          {it.cached && <span className="ml-1 text-[10px] text-ink-faint">(저장된 결과)</span>}
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
