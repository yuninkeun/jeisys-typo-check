"use client";

import { useEffect, useRef, useState } from "react";
import {
  applyDecisions,
  compactText,
  decisionRules,
  memoFlags,
  ocrVerdict,
  rereadBox,
  type DecisionRow,
  type FindingDecision,
  type OcrFinding,
  type OcrVerdict,
} from "@/lib/ocr-compare";
import { sha256 } from "./batch";
import { localGet, localMarkUploaded, localPut, ocrFile, useBridgeInfo, type LocalDoc, type LocalLine } from "./bridge";
import { categoryOf, entryKey, type FileEntry } from "./file-tree";
import { checkAgainstDb, getFindingDecisions, getStoredOcr, guessCategory, saveFindingDecision, saveOcr, type LabelCategory } from "./ocr-actions";
import { Section, type Decide, type OcrRow } from "./ocr-batch";

/** 기준 대비 검사: this one label against the labels of its category in the
 *  OCR 문구 DB. Free (Windows OCR via the 연결 도우미); a label read before
 *  (on this PC or by anyone into the DB) is not read again. The category comes
 *  from the folder path when there is one, else from the label's own text. */

const STORED: LabelCategory[] = ["박스", "스티커", "멸균지"];

type Done = {
  step: "done";
  rows: OcrRow[];
  reference: number;
  /** "전체" = the category couldn't be told, so all labels were the reference. */
  category: LabelCategory | "전체";
  guessed: boolean;
  source: string;
  reread: boolean;
  approved: number;
};
type State = { step: "idle" } | { step: "run"; label: string } | Done | { step: "error"; message: string };

const VERDICTS: OcrVerdict[] = ["typo", "unclear"];

/** Result counts for a card header (the quick-check list shows them per file). */
export type CheckSummary = { typo: number; unclear: number } | "run" | "error" | null;

export function OcrFileCheck({
  entry,
  onOpen,
  title,
  onSummary,
}: {
  entry: FileEntry;
  onOpen: (e: FileEntry) => void;
  /** Shown instead of the section name (the quick-check page shows the file name). */
  title?: string;
  onSummary?: (s: CheckSummary) => void;
}) {
  const bridge = useBridgeInfo();
  const [state, setState] = useState<State>({ step: "idle" });
  const [showMisread, setShowMisread] = useState(false);
  /** The team's decisions (null = the table isn't set up yet). */
  const [decisions, setDecisions] = useState<DecisionRow[] | null>([]);
  const [decideError, setDecideError] = useState<string | null>(null);
  const runRef = useRef(0);
  /** A newer run (or leaving the file) makes an older one stop writing. */
  const cancel = () => {
    runRef.current++;
  };
  const fromPath = categoryOf(entryKey(entry));
  const pathCategory = fromPath && STORED.includes(fromPath) ? (fromPath as LabelCategory) : null;
  const helper = bridge.state === "on" && bridge.ocr && !bridge.old;
  const isLabelFile = entry.ext === "ai" || entry.ext === "pdf";

  async function run() {
    const run = ++runRef.current;
    const live = () => run === runRef.current;
    const show = (s: State) => {
      if (!live()) return;
      setState(s);
      onSummary?.(
        s.step === "done"
          ? { typo: s.rows.filter((r) => r.verdict === "typo").length, unclear: s.rows.filter((r) => r.verdict === "unclear").length }
          : s.step === "error"
            ? "error"
            : "run",
      );
    };
    try {
      show({ step: "run", label: "파일 확인 중…" });
      const file = await entry.getFile();
      const hash = await sha256(file);

      // 1. This label's text: this PC → DB → read it now.
      let doc: { w: number; h: number; lines: LocalLine[] } | null = null;
      let known: LabelCategory | null = null;
      let source = "";
      let fresh = false;
      const local = helper ? await localGet([hash]) : null;
      if (local?.length) {
        doc = local[0];
        known = local[0].category;
        source = "전에 읽은 글자";
      } else {
        const db = await getStoredOcr([hash]);
        if (db.ok && db.docs.length) {
          doc = db.docs[0];
          source = "전에 읽은 글자";
        }
      }
      if (!doc) {
        if (!helper) {
          show({
            step: "error",
            message:
              bridge.state === "on" && bridge.old
                ? "이 PC의 검증 도우미가 옛 버전입니다. 도우미 창을 닫고 새 버전으로 다시 켠 뒤 «다시 검사»를 눌러 주세요."
                : "처음 보는 파일이라 글자를 읽어야 합니다. 이 PC에서 검증 도우미를 켠 뒤 «다시 검사»를 눌러 주세요(설치는 담당자에게 요청).",
          });
          return;
        }
        show({ step: "run", label: "글자 읽는 중(약 8초)…" });
        const res = await ocrFile(file);
        if (!res.ok) throw new Error(res.message);
        const memo = memoFlags(res.lines);
        doc = {
          w: res.w,
          h: res.h,
          lines: res.lines.map((l, i) => ({ t: l.t, bbox: { x: l.x / res.w, y: l.y / res.h, w: l.w / res.w, h: l.h / res.h }, memo: memo[i] })),
        };
        fresh = true;
        source = "방금 읽음";
      }

      // 2. Which labels to compare with.
      let category: LabelCategory | "전체" = known ?? pathCategory ?? "전체";
      let guessed = false;
      let saveAs: LabelCategory | null = known ?? pathCategory;
      if (!known && !pathCategory) {
        show({ step: "run", label: "어떤 라벨인지 판별 중…" });
        const g = await guessCategory({ hash, lines: doc.lines });
        if (g.ok) {
          category = g.category ?? "전체";
          saveAs = g.category ?? g.best;
          guessed = true;
        }
      }

      // 3. A label read just now is kept on this PC and in the DB, so it becomes reference too.
      if (fresh && saveAs) {
        const memo = doc.lines.map((l) => l.memo);
        const label: LocalDoc = {
          hash,
          fileName: entry.name,
          filePath: entryKey(entry),
          category: saveAs,
          w: doc.w,
          h: doc.h,
          lines: doc.lines,
          compact: compactText(
            doc.lines.map((l) => ({ t: l.t, x: 0, y: 0, w: 0, h: 0 })),
            memo,
          ),
        };
        await localPut(label);
        const saved = await saveOcr(label);
        if (saved.ok) await localMarkUploaded([hash]);
      }

      // 4. Compare.
      show({ step: "run", label: category === "전체" ? "모든 라벨과 비교 중…" : `${category} 라벨들과 비교 중…` });
      const res = await checkAgainstDb({ hash, category, w: doc.w, h: doc.h, lines: doc.lines });
      if (!res.ok) throw new Error(res.reason === "not_ready" ? "비교할 라벨 DB가 아직 준비되지 않았습니다." : (res.message ?? "비교하지 못했습니다."));

      // 5. The team's decisions: approved spellings drop out, confirmed typos and
      //    OCR misreads are labelled as such.
      const dec = await getFindingDecisions();
      const decRows = dec.ok ? dec.rows : null;
      if (live()) setDecisions(decRows);
      const toRow = (f: OcrFinding): OcrRow => ({ ...f, entry, hash, verdict: f.ocrLike ? "misread" : "unclear", second: null });
      const pageDoc = { key: "target", w: doc.w, h: doc.h, lines: doc.lines.map((l) => ({ t: l.t, x: l.bbox.x * doc.w, y: l.bbox.y * doc.h, w: l.bbox.w * doc.w, h: l.bbox.h * doc.h })) };
      const applied = applyDecisions(res.findings.map(toRow), decisionRules(decRows ?? []), pageDoc, toRow);
      const rows: OcrRow[] = applied.findings.map((r) =>
        r.rule?.decision === "typo" ? { ...r, verdict: "typo" } : r.rule?.decision === "misread" ? { ...r, verdict: "misread" } : r,
      );

      // 6. Each suspect read again, enlarged (needs the helper).
      let reread = false;
      if (helper) {
        reread = true;
        for (let i = 0; i < rows.length; i++) {
          if (rows[i].ocrLike || rows[i].rule) continue;
          show({ step: "run", label: `의심 자리 확대해 다시 읽는 중 · ${i + 1}/${rows.length}` });
          const again = await ocrFile(file, rereadBox(rows[i]));
          const second = again.ok ? again.lines.map((l) => l.t).join(" ") : null;
          rows[i] = { ...rows[i], second, verdict: ocrVerdict(rows[i], second) };
        }
      }
      show({ step: "done", rows, reference: res.reference, category, guessed, source, reread, approved: applied.approved });
    } catch (err) {
      show({ step: "error", message: err instanceof Error ? err.message : "검사하지 못했습니다." });
    }
  }

  const decide: Decide | undefined =
    decisions === null
      ? undefined
      : {
          mine: (r) => decisions.find((d) => d.hash === r.hash && d.word === r.word && d.suggest === r.suggest),
          onDecide: async (r, d: FindingDecision | null) => {
            if (!r.hash) return;
            setDecideError(null);
            const res = await saveFindingDecision({ hash: r.hash, word: r.word, suggest: r.suggest, decision: d, fileName: entry.name });
            if (!res.ok) return setDecideError(res.reason === "not_ready" ? "판정을 저장할 곳이 아직 준비되지 않았습니다." : (res.message ?? "판정을 저장하지 못했습니다."));
            setDecisions((prev) => [
              ...(prev ?? []).filter((x) => !(x.hash === r.hash && x.word === r.word && x.suggest === r.suggest)),
              ...(res.row ? [res.row] : []),
            ]);
          },
          error: decideError,
        };

  // Runs by itself when a label is opened (free; a label read before takes a second or two).
  useEffect(() => {
    setShowMisread(false);
    if (!isLabelFile || bridge.state === "checking") return;
    void run();
    return cancel;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryKey(entry), bridge.state]);

  if (!isLabelFile) return null;
  const count = (v: OcrVerdict) => (state.step === "done" ? state.rows.filter((r) => r.verdict === v).length : 0);
  const against = (s: Done) =>
    s.category === "전체"
      ? `어떤 라벨인지 판별하기 어려워 모든 라벨 ${s.reference.toLocaleString()}개와 비교`
      : `${s.category}${s.guessed ? "(자동 판별)" : ""} 라벨 ${s.reference.toLocaleString()}개와 비교`;

  return (
    <section className="flex flex-col gap-2 rounded border border-line p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="min-w-0 break-all text-sm font-bold text-ink">{title ?? "오타 검증 (라벨 DB 기준 · 무료)"}</h3>
        {state.step === "done" && (
          <span className="text-xs text-ink-muted">
            {against(state)} · {state.source}
          </span>
        )}
        {state.step !== "run" && (
          <button type="button" onClick={() => void run()} className="ml-auto rounded-sm border border-line-strong px-2 py-0.5 text-xs hover:bg-canvas">
            다시 검사
          </button>
        )}
      </div>

      {state.step === "run" && <p className="text-xs text-brand-700">{state.label}</p>}
      {state.step === "error" && (
        <p role="alert" className="rounded border border-flag-line bg-flag-soft px-3 py-2 text-xs text-flag">
          {state.message}
        </p>
      )}

      {state.step === "done" && (
        <>
          {count("typo") + count("unclear") === 0 ? (
            <p className="rounded border border-pass-line bg-pass-soft px-3 py-2 text-xs text-pass">다른 라벨들과 다르게 쓴 글자를 찾지 못했습니다.</p>
          ) : (
            VERDICTS.map((v) => <Section key={v} v={v} rows={state.rows} onOpen={onOpen} crops decide={decide} />)
          )}
          {decideError && (
            <p role="alert" className="text-xs text-flag">
              {decideError}
            </p>
          )}
          {state.approved > 0 && <p className="text-xs text-ink-muted">«정상 표기»로 판정된 {state.approved}건은 빼고 보여 줍니다.</p>}
          {!state.reread && state.rows.some((r) => !r.ocrLike && !r.rule) && (
            <p className="text-xs text-warn">검증 도우미가 꺼져 있어 확대해 다시 읽지 못했습니다 — 의심은 모두 «판단 불가»로 표시합니다.</p>
          )}
          {count("misread") > 0 && (
            <div className="flex flex-col gap-1.5">
              <button type="button" onClick={() => setShowMisread((s) => !s)} className="w-fit text-xs text-ink-muted underline">
                {showMisread ? "OCR 오독 숨기기" : `글자를 잘못 읽은 것으로 걸러낸 ${count("misread")}건 보기`}
              </button>
              {showMisread && <Section v="misread" rows={state.rows} onOpen={onOpen} crops={false} decide={decide} />}
            </div>
          )}
          <p className="text-[11px] text-ink-faint">
            기준: 1페이지 글자를 읽어(Windows OCR), DB에 쌓인 같은 종류 라벨에 많이 나온 표기와 한 글자 다르면 의심 · 작업 메모·조사·대소문자 차이 제외 · 모든
            라벨이 똑같이 틀렸거나 이 라벨에만 있는 문장은 못 잡음 · 최종 판단은 담당자.
          </p>
        </>
      )}
    </section>
  );
}
