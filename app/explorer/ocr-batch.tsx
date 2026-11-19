"use client";

import { useEffect, useRef, useState } from "react";
import { applyDecisions, compactText, decisionRules, findOcrTypos, memoFlags, ocrVerdict, rereadBox, OCR_MIN_FILES, type DecisionRow, type FindingDecision, type OcrDoc, type OcrFinding, type OcrVerdict } from "@/lib/ocr-compare";
import { getFindingDecisions, getStoredOcr, ocrStats, saveFindingDecision, saveOcr, type LabelCategory, type StoredDoc } from "./ocr-actions";
import { sha256 } from "./batch";
import { localGet, localMarkUploaded, localPending, localPut, localStats, ocrFile, type BridgeInfo, type LocalDoc, type LocalStats } from "./bridge";
import { categoryOf, entryKey, type FileEntry } from "./file-tree";
import { openPdf } from "./pdf-render";

/** OCR 비교: every picked file is read on this PC by the 연결 도우미 (Windows
 *  OCR, no AI, no cost), then the files are compared with each other. A word
 *  spelled one way in one or two files and another way in many is a suspect;
 *  each suspect is read again, enlarged, to drop OCR misreads. */

type Phase = "hash" | "read" | "compare" | "reread" | "done" | "stopped";
/** `hash`: the file's content hash (for decisions); `rule`: the team's decision this row follows. */
export type OcrRow = OcrFinding & { entry: FileEntry; verdict: OcrVerdict; second: string | null; hash?: string; rule?: DecisionRow };

/** Only these go into the OCR 문구 DB for now. */
const STORED: LabelCategory[] = ["박스", "스티커", "멸균지"];

/** "server": read from / saved to the OCR 문구 DB. "not_ready": the tables are
 *  missing (supabase/migrations/20261119_label_ocr.sql), so this run keeps
 *  everything in the browser. "error": saving failed (message). */
export type OcrStore = { state: "server" | "not_ready" | "error"; message?: string };

/** OCR results for this visit, by content hash. */
const cache = new Map<string, OcrDoc>();

const fromStored = (key: string, d: StoredDoc): OcrDoc => ({
  key,
  w: d.w,
  h: d.h,
  lines: d.lines.map((l) => ({ t: l.t, x: l.bbox.x * d.w, y: l.bbox.y * d.h, w: l.bbox.w * d.w, h: l.bbox.h * d.h })),
});

export type Ocr = ReturnType<typeof useOcr>;

export function useOcr() {
  const [phase, setPhase] = useState<Phase | null>(null);
  const [total, setTotal] = useState(0);
  const [read, setRead] = useState(0);
  /** Files that need the helper this run (not in the DB yet). */
  const [toRead, setToRead] = useState(0);
  const [counts, setCounts] = useState({ fromLocal: 0, fromDb: 0, savedLocal: 0, savedDb: 0, notLabel: 0 });
  const [store, setStore] = useState<OcrStore>({ state: "server" });
  const [failed, setFailed] = useState<{ entry: FileEntry; error: string }[]>([]);
  const [rows, setRows] = useState<OcrRow[]>([]);
  const [rereadDone, setRereadDone] = useState(0);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  /** The team's decisions on suspects (null = the table isn't set up yet). */
  const [decisions, setDecisions] = useState<DecisionRow[] | null>([]);
  const [decideError, setDecideError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [approved, setApproved] = useState(0);
  const runRef = useRef(0);

  function reset() {
    runRef.current++;
    setPhase(null);
    setRows([]);
    setFailed([]);
    setRead(0);
    setToRead(0);
    setCounts({ fromLocal: 0, fromDb: 0, savedLocal: 0, savedDb: 0, notLabel: 0 });
    setRereadDone(0);
    setFatal(null);
  }

  async function start(list: FileEntry[]) {
    const run = ++runRef.current;
    const live = () => run === runRef.current;
    setPhase("hash");
    setTotal(list.length);
    setRead(0);
    setToRead(0);
    setCounts({ fromLocal: 0, fromDb: 0, savedLocal: 0, savedDb: 0, notLabel: 0 });
    setStore({ state: "server" });
    setFailed([]);
    setRows([]);
    setRereadDone(0);
    setFatal(null);
    setStartedAt(Date.now());
    const fail = (entry: FileEntry, msg: string) =>
      setFailed((prev) => [
        ...prev,
        { entry, error: /PDF|0x8|format|형식/i.test(msg) || !msg ? "읽지 못했습니다 — PDF 호환 저장이 꺼진 AI 파일일 수 있습니다." : msg },
      ]);

    // 1. Which file is which (content hash), and what this PC or the DB already has.
    const items: { entry: FileEntry; hash: string; category: LabelCategory | null }[] = [];
    for (const entry of list) {
      if (!live()) return;
      try {
        const hash = await sha256(await entry.getFile());
        const c = categoryOf(entryKey(entry));
        items.push({ entry, hash, category: c && STORED.includes(c) ? c : null });
      } catch (err) {
        fail(entry, err instanceof Error ? err.message : "");
      }
    }
    const stored = new Map<string, StoredDoc>();
    let fromLocal = 0;
    const need = () => items.filter((it) => !cache.has(it.hash) && !stored.has(it.hash)).map((it) => it.hash);
    const onPc = need();
    for (let i = 0; i < onPc.length; i += 100) {
      const docs = await localGet(onPc.slice(i, i + 100));
      for (const d of docs ?? []) {
        stored.set(d.hash, d);
        fromLocal++;
      }
    }
    let storeState: OcrStore["state"] = "server";
    let fromDb = 0;
    const inDb = need();
    for (let i = 0; i < inDb.length && storeState === "server"; i += 100) {
      try {
        const res = await getStoredOcr(inDb.slice(i, i + 100));
        if (res.ok)
          res.docs.forEach((d) => {
            stored.set(d.hash, d);
            fromDb++;
          });
        else {
          storeState = res.reason === "not_ready" ? "not_ready" : "error";
          setStore({ state: storeState, message: res.message });
        }
      } catch (err) {
        storeState = "error";
        setStore({ state: "error", message: err instanceof Error ? err.message : "" });
      }
    }
    if (!live()) return;
    setToRead(need().length);
    setCounts((c) => ({ ...c, fromLocal, fromDb, notLabel: items.filter((it) => !it.category).length }));

    // 2. Read only what nobody has read yet. 박스·스티커·멸균지 are kept on this
    //    PC, and in the DB too when it is ready (else «DB로 올리기» later).
    setPhase("read");
    setStartedAt(Date.now()); // time left = reading speed only, not the hashing above
    const docs: OcrDoc[] = [];
    const byKey = new Map<string, FileEntry>();
    const hashByKey = new Map<string, string>();
    for (const it of items) {
      if (!live()) return;
      const key = entryKey(it.entry);
      let doc: OcrDoc | undefined = cache.get(it.hash);
      if (doc) doc = { ...doc, key };
      else if (stored.has(it.hash)) doc = fromStored(key, stored.get(it.hash)!);
      else {
        try {
          const res = await ocrFile(await it.entry.getFile());
          if (!res.ok) {
            if (res.reason === "offline" || res.reason === "no_ocr") {
              setFatal(res.message);
              setPhase("stopped");
              return;
            }
            throw new Error(res.message);
          }
          doc = { key, w: res.w, h: res.h, lines: res.lines };
          if (it.category) {
            const memo = memoFlags(res.lines);
            const label: LocalDoc = {
              hash: it.hash,
              fileName: it.entry.name,
              filePath: key,
              category: it.category,
              w: res.w,
              h: res.h,
              lines: res.lines.map((l, i) => ({
                t: l.t,
                bbox: { x: l.x / res.w, y: l.y / res.h, w: l.w / res.w, h: l.h / res.h },
                memo: memo[i],
              })),
              compact: compactText(res.lines, memo),
            };
            if (await localPut(label)) setCounts((c) => ({ ...c, savedLocal: c.savedLocal + 1 }));
            if (storeState === "server") {
              try {
                const saved = await saveOcr(label);
                if (saved.ok) {
                  await localMarkUploaded([it.hash]);
                  if (saved.saved) setCounts((c) => ({ ...c, savedDb: c.savedDb + 1 }));
                } else {
                  storeState = saved.reason === "not_ready" ? "not_ready" : "error";
                  setStore({ state: storeState, message: saved.message });
                }
              } catch (err) {
                storeState = "error";
                setStore({ state: "error", message: err instanceof Error ? err.message : "" });
              }
            }
          }
        } catch (err) {
          fail(it.entry, err instanceof Error ? err.message : "");
        }
        if (live()) setRead((n) => n + 1);
      }
      if (doc) {
        cache.set(it.hash, doc);
        docs.push(doc);
        byKey.set(key, it.entry);
        hashByKey.set(key, it.hash);
      }
    }
    if (!live()) return;

    setPhase("compare");
    await new Promise((r) => setTimeout(r, 30)); // let the screen show it
    const findings = findOcrTypos(docs);
    // The team's decisions: approved spellings drop out; confirmed typos and OCR
    // misreads are labelled (and a confirmed typo is found in every file).
    const dec = await getFindingDecisions();
    const decRows = dec.ok ? dec.rows : null;
    if (live()) setDecisions(decRows);
    const rules = decisionRules(decRows ?? []);
    const toRow = (f: OcrFinding): OcrRow => ({
      ...f,
      entry: byKey.get(f.key)!,
      hash: hashByKey.get(f.key),
      verdict: f.ocrLike ? "misread" : "unclear",
      second: null,
    });
    const grouped = new Map<string, OcrRow[]>();
    for (const f of findings) grouped.set(f.key, [...(grouped.get(f.key) ?? []), toRow(f)]);
    let dropped = 0;
    const initial: OcrRow[] = [];
    for (const d of docs) {
      const res = applyDecisions(grouped.get(d.key) ?? [], rules, d, toRow);
      dropped += res.approved;
      for (const r of res.findings)
        initial.push(r.rule?.decision === "typo" ? { ...r, verdict: "typo" } : r.rule?.decision === "misread" ? { ...r, verdict: "misread" } : r);
    }
    if (live()) setApproved(dropped);
    setRows(initial);

    setPhase("reread");
    for (let i = 0; i < initial.length; i++) {
      if (!live()) return;
      const f = initial[i];
      if (!f.ocrLike && !f.rule) {
        try {
          const res = await ocrFile(await f.entry.getFile(), rereadBox(f));
          if (!res.ok && res.reason === "offline") {
            // The rest would all fail too and land in 판단 불가 for no reason.
            setFatal(`${res.message} 남은 ${initial.length - i}건은 다시 읽지 못해 «판단 불가»로 남았습니다.`);
            setPhase("stopped");
            return;
          }
          const second = res.ok ? res.lines.map((l) => l.t).join(" ") : null;
          if (live()) setRows((prev) => prev.map((r, k) => (k === i ? { ...r, second, verdict: ocrVerdict(f, second) } : r)));
        } catch {
          // Left as 판단 불가.
        }
      }
      if (live()) setRereadDone(i + 1);
    }
    if (live()) setPhase("done");
  }

  function stop() {
    runRef.current++;
    setPhase((p) => (p && p !== "done" ? "stopped" : p));
  }

  const decide: Decide | undefined =
    decisions === null
      ? undefined
      : {
          mine: (r) => decisions.find((d) => d.hash === r.hash && d.word === r.word && d.suggest === r.suggest),
          onDecide: async (r, d) => {
            if (!r.hash) return;
            setDecideError(null);
            setNotice(null);
            const res = await saveFindingDecision({ hash: r.hash, word: r.word, suggest: r.suggest, decision: d, fileName: r.entry.name });
            if (!res.ok) return setDecideError(res.reason === "not_ready" ? "판정 저장소가 아직 준비되지 않았습니다." : (res.message ?? "판정을 저장하지 못했습니다."));
            setDecisions((prev) => [
              ...(prev ?? []).filter((x) => !(x.hash === r.hash && x.word === r.word && x.suggest === r.suggest)),
              ...(res.row ? [res.row] : []),
            ]);
            setNotice(decisionNotice(r.word, d));
          },
          error: decideError,
          notice,
        };

  return { phase, total, read, toRead, counts, store, failed, rows, rereadDone, startedAt, fatal, start, stop, reset, decide, decisionsReady: decisions !== null, approved };
}

const VERDICT: Record<OcrVerdict, { title: string; hint: string; cls: string }> = {
  typo: { title: "오타 의심", hint: "확대해 다시 읽어도 같은 글자", cls: "text-flag" },
  unclear: { title: "판단 불가", hint: "확대하니 다르게 읽힘 — 그림을 보고 판단", cls: "text-warn" },
  misread: { title: "OCR 오독으로 걸러냄", hint: "확대해 읽으니 정상", cls: "text-ink-muted" },
};

function csv(rows: OcrRow[], fileName: string) {
  const head = ["판정", "파일", "경로", "읽은 글자", "다른 파일들의 표기", "이 표기가 나온 파일 수", "다른 표기가 나온 파일 수", "줄(1차)", "확대해 다시 읽은 줄"];
  const body = rows.map((r) => [VERDICT[r.verdict].title, r.entry.name, entryKey(r.entry), r.word, r.suggest, String(r.seenIn), String(r.suggestSeenIn), r.line, r.second ?? ""]);
  const text = [head, ...body].map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob(["﻿", text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  const d = new Date();
  a.download = `OCR비교_${fileName}_${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** The suspected spot, cut out of the file and drawn here (pdf.js, in the browser). */
export function Crop({ row }: { row: OcrRow }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    (async () => {
      const doc = await openPdf(await row.entry.getFile());
      try {
        const page = await doc.getPage(1);
        const base = page.getViewport({ scale: 1 });
        const b = rereadBox(row, 1.5);
        const scale = Math.min(8, 900 / Math.max(1, b.w * base.width));
        const vp = page.getViewport({ scale, offsetX: -b.x * base.width * scale, offsetY: -b.y * base.height * scale });
        const canvas = ref.current;
        if (!canvas || !alive) return;
        canvas.width = Math.max(1, Math.round(b.w * base.width * scale));
        canvas.height = Math.max(1, Math.round(b.h * base.height * scale));
        const ctx = canvas.getContext("2d")!;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvas, canvasContext: ctx, viewport: vp }).promise;
      } finally {
        await doc.destroy();
      }
    })().catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [row]);
  if (failed) return null;
  return <canvas ref={ref} aria-label="원본에서 잘라 낸 그림" className="mt-1.5 block h-auto max-h-28 max-w-full rounded border border-line" />;
}

const DECIDE: { value: FindingDecision; label: string; on: string }[] = [
  { value: "typo", label: "오타 확정", on: "border-flag bg-flag text-white" },
  { value: "ok", label: "정상 표기", on: "border-pass bg-pass text-white" },
  { value: "misread", label: "OCR 오독", on: "border-ink-muted bg-ink-muted text-white" },
];
const RULE_TEXT: Record<FindingDecision, string> = { typo: "오타 확정", ok: "정상 표기", misread: "OCR 오독" };

/** What clicking a decision does, said right after the click. */
export function decisionNotice(word: string, d: FindingDecision | null) {
  if (d === "typo") return `«${word}» 오타 확정 — 이 파일을 «수정 필요»로 표시했고, 같은 오타가 있는 다른 파일에도 바로 «오타 확정»으로 뜹니다.`;
  if (d === "ok") return `«${word}» 정상 표기 — 다음 검사부터 이 표기는 의심하지 않습니다.`;
  if (d === "misread") return `«${word}» OCR 오독 — 글자를 잘못 읽은 것으로 보고 «OCR 오독» 목록으로 옮겼습니다. 다음 검사부터 자동으로 걸러냅니다.`;
  return `«${word}» 판정을 취소했습니다.`;
}

/** The team's decisions on suspects, and how to make one (판정 학습). */
export type Decide = {
  mine: (r: OcrRow) => DecisionRow | undefined;
  onDecide: (r: OcrRow, d: FindingDecision | null) => void;
  error?: string | null;
  notice?: string | null;
};

/** Where a row shows now: a decision made on this screen moves it right away. */
export function shownVerdict(r: OcrRow, decide?: Decide): OcrVerdict {
  const d = decide?.mine(r)?.decision;
  return d === "typo" ? "typo" : d === "misread" ? "misread" : r.verdict;
}

/** One line on what each button does, above the list. */
export function DecideHelp() {
  return (
    <p className="text-[11px] text-ink-muted">
      판정하면 바로 반영됩니다 — <b className="text-flag">오타 확정</b>: 이 파일 «수정 필요» 표시, 같은 오타는 다른 파일에서도 바로 표시 ·{" "}
      <b className="text-pass">정상 표기</b>: 다음부터 의심 안 함 · <b className="text-ink-muted">OCR 오독</b>: 잘못 읽은 것으로 걸러냄. 같은 버튼을 다시 누르면 취소.
    </p>
  );
}

export function DecideNotice({ decide }: { decide?: Decide }) {
  if (decide?.error)
    return (
      <p role="alert" className="rounded border border-flag-line bg-flag-soft px-3 py-2 text-xs text-flag">
        {decide.error}
      </p>
    );
  if (decide?.notice)
    return (
      <p role="status" className="rounded border border-pass-line bg-pass-soft px-3 py-2 text-xs text-pass">
        ✓ {decide.notice}
      </p>
    );
  return null;
}

export function Section({ v, rows, onOpen, crops, decide }: { v: OcrVerdict; rows: OcrRow[]; onOpen: (e: FileEntry) => void; crops: boolean; decide?: Decide }) {
  const list = rows
    .filter((r) => shownVerdict(r, decide) === v)
    // Confirmed typos first, approved ones last.
    .sort((a, b) => {
      const rank = (r: OcrRow) => ({ typo: 0, misread: 1, ok: 2 })[decide?.mine(r)?.decision ?? "misread"] ?? 1;
      return rank(a) - rank(b);
    });
  if (!list.length) return null;
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className={`text-sm font-bold ${VERDICT[v].cls}`}>
        {VERDICT[v].title} <span className="font-normal text-ink-muted">{list.length}건 · {VERDICT[v].hint}</span>
      </h3>
      <ul className="flex flex-col divide-y divide-line rounded border border-line">
        {list.map((r) => {
          const mine = decide?.mine(r);
          const elsewhere = r.rule && r.rule.hash !== r.hash ? r.rule : undefined;
          const approved = mine?.decision === "ok";
          return (
            <li
              key={`${r.key}|${r.word}|${r.suggest}`}
              className={`flex flex-col gap-0.5 px-3 py-2 text-xs ${mine?.decision === "typo" ? "bg-flag-soft" : approved ? "opacity-60" : ""}`}
            >
              <span className="flex flex-wrap items-baseline gap-x-2">
                <b className={approved ? "text-ink-muted line-through" : "text-flag"}>{r.word}</b>
                {r.seenIn > 0 && <span className="text-ink-faint">{r.seenIn}개 파일</span>}
                <span className="text-ink-faint">→</span>
                <b className="text-pass">{r.suggest}</b>
                {r.suggestSeenIn > 0 && <span className="text-ink-faint">{r.suggestSeenIn}개 파일</span>}
                {mine?.decision === "typo" && <span className="rounded-sm bg-flag px-1.5 text-[11px] font-medium text-white">수정 필요</span>}
                {approved && <span className="text-[11px] text-pass">정상 표기로 판정 · 다음 검사부터 안 뜸</span>}
                <button
                  type="button"
                  onClick={() => onOpen(r.entry)}
                  title={entryKey(r.entry)}
                  className="ml-auto max-w-full truncate text-[11px] text-brand-700 underline"
                >
                  {r.entry.name}
                </button>
              </span>
              {!approved && <span className="text-ink">{r.line}</span>}
              {!approved && r.second && r.second !== r.line && <span className="text-[11px] text-ink-muted">다시 읽음: {r.second}</span>}
              {elsewhere && !mine && (
                <span className="text-[11px] text-ink-muted">
                  다른 파일에서 «{RULE_TEXT[elsewhere.decision]}»으로 판정됨{elsewhere.by && ` (${elsewhere.by})`} — 이 판정을 따름
                </span>
              )}
              {crops && !approved && <Crop row={r} />}
              {decide && r.hash && (
                <span className="mt-1 flex flex-wrap items-center gap-1">
                  {DECIDE.map((d) => {
                    const on = mine?.decision === d.value;
                    return (
                      <button
                        key={d.value}
                        type="button"
                        aria-pressed={on}
                        onClick={() => decide.onDecide(r, on ? null : d.value)}
                        className={`rounded-sm border px-2 py-0.5 text-[11px] font-medium ${on ? d.on : "border-line-strong bg-surface text-ink hover:bg-canvas"}`}
                      >
                        {on ? `✓ ${d.label}` : d.label}
                      </button>
                    );
                  })}
                  {mine && (
                    <span className="ml-1 text-[11px] text-ink-faint">
                      {mine.by && `${mine.by} · `}
                      {new Date(mine.at).toLocaleDateString("ko-KR")}
                    </span>
                  )}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function OcrPanel({ ocr, fileName, onOpen }: { ocr: Ocr; fileName: string; onOpen: (e: FileEntry) => void }) {
  const [showMisread, setShowMisread] = useState(false);
  const [now, setNow] = useState(0);
  const running = ocr.phase === "hash" || ocr.phase === "read" || ocr.phase === "compare" || ocr.phase === "reread";
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);

  const count = (v: OcrVerdict) => ocr.rows.filter((r) => shownVerdict(r, ocr.decide) === v).length;
  const typoFiles = new Set(ocr.rows.filter((r) => shownVerdict(r, ocr.decide) === "typo").map((r) => r.key)).size;
  const toReread = ocr.rows.filter((r) => !r.ocrLike).length;
  const elapsed = ocr.startedAt && now ? (now - ocr.startedAt) / 1000 : 0;
  const left = ocr.phase === "read" && ocr.read > 0 ? Math.round(((elapsed / ocr.read) * (ocr.toRead - ocr.read)) / 60) : null;
  const pct =
    ocr.phase === "hash" ? 3 : ocr.phase === "read" ? 5 + (ocr.read / Math.max(1, ocr.toRead)) * 85 : ocr.phase === "reread" ? 90 + (ocr.rereadDone / Math.max(1, ocr.rows.length)) * 10 : 100;
  const status =
    ocr.phase === "hash"
      ? `파일 확인·DB 조회 중 · ${ocr.total}개`
      : ocr.phase === "read"
        ? `새 파일 글자 읽는 중 · ${ocr.read}/${ocr.toRead}`
      : ocr.phase === "compare"
        ? "파일끼리 비교 중…"
        : ocr.phase === "reread"
          ? `의심 자리 확대해 다시 읽는 중 · ${ocr.rereadDone}/${ocr.rows.length}`
          : ocr.phase === "stopped"
            ? "멈춤"
            : "비교 완료";
  const done = ocr.phase === "done";
  const readOk = ocr.total - ocr.failed.length;
  const counted = ocr.phase !== null && ocr.phase !== "hash";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
          <span className="font-medium text-ink">OCR 비교 · {status}</span>
          {left != null && <span>· 남은 시간 약 {Math.max(1, left)}분</span>}
          <span className="ml-auto flex gap-2">
            {running ? (
              <button type="button" onClick={ocr.stop} className="rounded-sm border border-line-strong px-2 py-0.5 hover:bg-canvas">
                멈추기
              </button>
            ) : (
              <button type="button" onClick={ocr.reset} className="rounded-sm border border-line-strong px-2 py-0.5 hover:bg-canvas">
                처음으로
              </button>
            )}
            {ocr.rows.length > 0 && (
              <button type="button" onClick={() => csv(ocr.rows, fileName)} className="rounded-sm border border-line-strong px-2 py-0.5 hover:bg-canvas">
                결과 CSV 받기
              </button>
            )}
          </span>
        </div>
        <span className="block h-2 overflow-hidden rounded-full bg-canvas">
          <span className="block h-full bg-brand-700 transition-all" style={{ width: `${pct}%` }} />
        </span>
      </div>

      {counted && (
        <p className="text-xs text-ink-muted">
          이 PC에서 불러옴 <b className="text-ink">{ocr.counts.fromLocal}</b> · DB에서 불러옴 <b className="text-ink">{ocr.counts.fromDb}</b> · 새로 읽음{" "}
          <b className="text-ink">{ocr.read}</b>
          {ocr.toRead > ocr.read && ` / ${ocr.toRead}`} · 이 PC에 저장 <b className="text-pass">{ocr.counts.savedLocal}</b> · DB에 저장{" "}
          <b className="text-pass">{ocr.counts.savedDb}</b>
          {ocr.counts.notLabel > 0 && (
            <span className="text-ink-faint"> · 박스·스티커·멸균지가 아닌 {ocr.counts.notLabel}개는 비교만 하고 저장하지 않음</span>
          )}
        </p>
      )}
      {ocr.store.state === "not_ready" && (
        <p className="rounded border border-line bg-warn-soft px-3 py-2 text-xs text-warn">
          DB가 아직 준비되지 않아 읽은 결과는 이 PC에만 저장합니다. DB가 준비되면 «DB로 올리기»로 한 번에 올리면 됩니다.
        </p>
      )}
      {ocr.store.state === "error" && (
        <p role="alert" className="rounded border border-flag-line bg-flag-soft px-3 py-2 text-xs text-flag">
          DB에 저장하지 못했습니다{ocr.store.message ? `: ${ocr.store.message}` : ""}. 이 PC에는 계속 저장하니, 나중에 «DB로 올리기»로 올리면 됩니다.
        </p>
      )}

      {ocr.fatal && (
        <p role="alert" className="rounded border border-flag-line bg-flag-soft px-3 py-2 text-xs text-flag">
          {ocr.fatal}
        </p>
      )}

      {(done || ocr.rows.length > 0) && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat n={readOk} label="비교한 파일" />
          <Stat n={typoFiles} label="오타 의심이 있는 파일" cls="border-flag-line bg-flag-soft text-flag" />
          <Stat n={count("typo")} label="오타 의심" cls="border-flag-line bg-flag-soft text-flag" />
          <Stat n={count("unclear")} label="판단 불가" cls="border-line bg-warn-soft text-warn" />
        </div>
      )}

      {done && readOk < OCR_MIN_FILES && (
        <p className="rounded border border-line bg-warn-soft px-3 py-2 text-xs text-warn">
          비교한 파일이 {readOk}개뿐이라 «여러 파일에 많이 나온 표기»를 정하기 어렵습니다. 같은 종류의 라벨 폴더를 더 골라 함께 비교하면 정확해집니다.
        </p>
      )}

      {ocr.phase === "reread" && toReread > 0 && <p className="text-xs text-ink-muted">의심 {toReread}건을 확대해 다시 읽고 있습니다. 끝나면 판정이 바뀔 수 있습니다.</p>}

      {ocr.decide && ocr.rows.some((r) => !r.ocrLike) && <DecideHelp />}
      <DecideNotice decide={ocr.decide} />
      {done && !ocr.decisionsReady && (
        <p className="text-xs text-ink-muted">판정 저장소가 아직 준비되지 않아 판정 버튼은 숨겼습니다. (관리자: supabase/migrations/20261120_finding_decisions.sql 실행)</p>
      )}
      {ocr.approved > 0 && <p className="text-xs text-ink-muted">«정상 표기»로 판정된 {ocr.approved}건은 빼고 보여 줍니다.</p>}
      <Section v="typo" rows={ocr.rows} onOpen={onOpen} crops decide={ocr.decide} />
      <Section v="unclear" rows={ocr.rows} onOpen={onOpen} crops decide={ocr.decide} />
      {done && count("typo") + count("unclear") === 0 && readOk > 0 && (
        <p className="rounded border border-pass-line bg-pass-soft px-3 py-2 text-xs text-pass">다른 파일들과 다르게 쓴 글자를 찾지 못했습니다.</p>
      )}
      {count("misread") > 0 && (
        <div className="flex flex-col gap-1.5">
          <button type="button" onClick={() => setShowMisread((s) => !s)} className="w-fit text-xs text-ink-muted underline">
            {showMisread ? "OCR 오독 숨기기" : `OCR 오독으로 걸러낸 ${count("misread")}건 보기`}
          </button>
          {showMisread && <Section v="misread" rows={ocr.rows} onOpen={onOpen} crops={false} decide={ocr.decide} />}
        </div>
      )}

      {ocr.failed.length > 0 && (
        <details className="text-xs text-ink-muted">
          <summary className="cursor-pointer">읽지 못한 파일 {ocr.failed.length}개</summary>
          <ul className="mt-1 flex flex-col gap-0.5 pl-3">
            {ocr.failed.map((f) => (
              <li key={entryKey(f.entry)}>
                {f.entry.name} — {f.error}
              </li>
            ))}
          </ul>
        </details>
      )}

      <p className="text-[11px] leading-relaxed text-ink-faint">
        기준: 이 PC의 Windows 한국어 OCR로 1페이지를 읽음 · 고른 파일들에 많이 나온 표기와 한 글자 다르면 의심 · 작업 메모(용지·금박·팬톤·날짜·버전)·조사·대소문자 차이는
        제외 · 모든 파일이 똑같이 틀렸거나 한 파일에만 있는 문장은 못 잡음 · 최종 판단은 담당자.
      </p>
    </div>
  );
}

function Stat({ n, label, cls = "border-line bg-surface text-ink" }: { n: number; label: string; cls?: string }) {
  return (
    <div className={`flex flex-col rounded border px-3 py-2 ${cls}`}>
      <span className="text-xl font-bold tabular-nums">{n.toLocaleString()}</span>
      <span className="text-xs opacity-80">{label}</span>
    </div>
  );
}

/** The start button in the folder review, with what the helper needs. */
/** Sends the labels kept on this PC to the DB, a few at a time. */
async function uploadPending(onProgress: (done: number) => void): Promise<{ done: number; error?: string }> {
  let done = 0;
  for (;;) {
    const batch = await localPending(20);
    if (batch === null) return { done, error: "연결 도우미에 닿지 못했습니다." };
    if (!batch.length) return { done };
    const ok: string[] = [];
    for (const d of batch) {
      const res = await saveOcr(d);
      if (!res.ok) {
        if (ok.length) await localMarkUploaded(ok);
        return { done, error: res.reason === "not_ready" ? "DB가 아직 준비되지 않았습니다." : (res.message ?? "DB에 저장하지 못했습니다.") };
      }
      ok.push(d.hash);
      onProgress(++done);
    }
    if (!(await localMarkUploaded(ok))) return { done, error: "올린 기록을 이 PC에 남기지 못했습니다." };
  }
}

export function OcrStart({ bridge, count, onStart }: { bridge: BridgeInfo; count: number; onStart: () => void }) {
  const ready = bridge.state === "on" && bridge.ocr && !bridge.old;
  const min = Math.max(1, Math.round((count * 8) / 60));
  const [db, setDb] = useState<Awaited<ReturnType<typeof ocrStats>> | null>(null);
  const [local, setLocal] = useState<LocalStats | null>(null);
  const [upload, setUpload] = useState<{ running: boolean; done: number; message?: string } | null>(null);

  const refresh = () => {
    ocrStats()
      .then(setDb)
      .catch(() => setDb(null));
    localStats().then(setLocal);
  };
  useEffect(() => {
    let alive = true;
    ocrStats()
      .then((s) => alive && setDb(s))
      .catch(() => alive && setDb(null));
    localStats().then((s) => alive && setLocal(s));
    return () => {
      alive = false;
    };
  }, [bridge.state]);

  async function runUpload() {
    setUpload({ running: true, done: 0 });
    const res = await uploadPending((done) => setUpload({ running: true, done }));
    setUpload({ running: false, done: res.done, message: res.error });
    refresh();
  }

  const dbReady = !!db?.ok;
  const by = local?.byCategory ?? {};
  return (
    <div className="flex flex-col gap-1.5 rounded border border-line bg-canvas px-3 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={!ready}
          onClick={onStart}
          className="h-9 rounded border border-brand-700 bg-surface px-3 text-sm font-medium text-brand-700 hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          AI 없이 OCR로 읽어 비교 ({count}개)
        </button>
        <span className={`text-xs ${ready ? "text-pass" : "text-ink-muted"}`}>
          {bridge.state === "checking" ? "연결 확인 중…" : ready ? "● 연결 도우미 켜짐" : "○ 연결 도우미 꺼짐"}
        </span>
      </div>
      <p className="text-xs leading-relaxed text-ink-muted">
        비용 없이 이 PC에서 글자를 읽어(Windows OCR) 고른 파일끼리 비교합니다. 다른 파일들과 다르게 쓴 글자(예: Jeieys ↔ Jeisys)를 찾고, 의심 자리는 그림으로
        보여 줍니다. 박스·스티커·멸균지는 읽은 글자를 이 PC에 저장해 다음부터 다시 읽지 않습니다. 새 파일은 1개에 약 8초(모두 새 파일이면 약 {min}분).
      </p>
      {local && (
        <p className="text-xs text-ink">
          이 PC에 저장된 라벨 <b>{local.total.toLocaleString()}개</b>
          <span className="text-ink-muted">
            {" "}
            (박스 {by["박스"] ?? 0} · 스티커 {by["스티커"] ?? 0} · 멸균지 {by["멸균지"] ?? 0})
          </span>
          {dbReady && (
            <span className="text-ink-muted">
              {" "}
              · DB에 쌓인 라벨 {db.total.toLocaleString()}개
            </span>
          )}
        </p>
      )}
      {local && local.pending > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={!dbReady || !!upload?.running}
            onClick={() => void runUpload()}
            className="h-8 rounded border border-line-strong bg-surface px-3 text-xs font-medium text-ink hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-50"
          >
            {upload?.running ? `DB로 올리는 중… ${upload.done}/${local.pending}` : `DB로 올리기 (${local.pending}개)`}
          </button>
          {!dbReady && <span className="text-xs text-ink-muted">DB가 준비되면 올릴 수 있습니다(관리자: supabase/migrations/20261119_label_ocr.sql 실행).</span>}
        </div>
      )}
      {upload && !upload.running && (
        <p className={`text-xs ${upload.message ? "text-flag" : "text-pass"}`}>
          {upload.message ? `${upload.done}개 올린 뒤 멈췄습니다 — ${upload.message}` : `${upload.done}개를 DB에 올렸습니다.`}
        </p>
      )}
      {bridge.state === "off" && (
        <p className="text-xs text-ink-muted">
          쓰려면 이 PC에서 <b>Illustrator 연결 도우미</b>를 켜 두세요(담당자에게 설치 요청 · Illustrator는 없어도 됩니다).
        </p>
      )}
      {bridge.state === "on" && bridge.old && (
        <p className="text-xs text-warn">켜져 있는 연결 도우미가 옛 버전입니다. 도우미 창을 닫고 새 버전으로 다시 켜 주세요.</p>
      )}
      {bridge.state === "on" && !bridge.old && !bridge.ocr && (
        <p className="text-xs text-warn">이 PC에서 Windows 한국어 OCR을 쓸 수 없습니다(설정 › 시간 및 언어 › 언어에 한국어 추가).</p>
      )}
    </div>
  );
}
