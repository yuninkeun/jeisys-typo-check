"use client";

import { useEffect, useRef, useState } from "react";
import { compactText, memoFlags, ocrVerdict, rereadBox, type OcrVerdict } from "@/lib/ocr-compare";
import { sha256 } from "./batch";
import { localGet, localMarkUploaded, localPut, ocrFile, useBridgeInfo, type LocalDoc, type LocalLine } from "./bridge";
import { categoryOf, entryKey, type FileEntry } from "./file-tree";
import { checkAgainstDb, getStoredOcr, saveOcr, type LabelCategory } from "./ocr-actions";
import { Section, type OcrRow } from "./ocr-batch";

/** 기준 대비 검사: this one label against every label of its category in the
 *  OCR 문구 DB. Free (Windows OCR via the 연결 도우미); a label read before
 *  (on this PC or by anyone into the DB) is not read again. */

const STORED: LabelCategory[] = ["박스", "스티커", "멸균지"];

type State =
  | { step: "idle" }
  | { step: "run"; label: string }
  | { step: "done"; rows: OcrRow[]; reference: number; category: LabelCategory; source: string; reread: boolean }
  | { step: "error"; message: string };

const VERDICTS: OcrVerdict[] = ["typo", "unclear"];

export function OcrFileCheck({ entry, onOpen }: { entry: FileEntry; onOpen: (e: FileEntry) => void }) {
  const bridge = useBridgeInfo();
  const [state, setState] = useState<State>({ step: "idle" });
  const [showMisread, setShowMisread] = useState(false);
  const runRef = useRef(0);
  /** A newer run (or leaving the file) makes an older one stop writing. */
  const cancel = () => {
    runRef.current++;
  };
  const c = categoryOf(entryKey(entry));
  const category = c && STORED.includes(c) ? (c as LabelCategory) : null;
  const helper = bridge.state === "on" && bridge.ocr && !bridge.old;

  async function run() {
    if (!category) return;
    const run = ++runRef.current;
    const live = () => run === runRef.current;
    try {
      setState({ step: "run", label: "파일 확인 중…" });
      const file = await entry.getFile();
      const hash = await sha256(file);

      // 1. This label's text: this PC → DB → read it now.
      let doc: { w: number; h: number; lines: LocalLine[] } | null = null;
      let source = "";
      const local = helper ? await localGet([hash]) : null;
      if (local?.length) {
        doc = local[0];
        source = "이 PC에 저장된 글자";
      } else {
        const db = await getStoredOcr([hash]);
        if (db.ok && db.docs.length) {
          doc = db.docs[0];
          source = "DB에 저장된 글자";
        }
      }
      if (!doc) {
        if (!helper) {
          if (live()) setState({ step: "error", message: "처음 보는 파일이라 글자를 읽어야 합니다 — 이 PC에서 연결 도우미(버전 3)를 켜 주세요." });
          return;
        }
        if (live()) setState({ step: "run", label: "글자 읽는 중(약 8초)…" });
        const res = await ocrFile(file);
        if (!res.ok) throw new Error(res.message);
        const memo = memoFlags(res.lines);
        const label: LocalDoc = {
          hash,
          fileName: entry.name,
          filePath: entryKey(entry),
          category,
          w: res.w,
          h: res.h,
          lines: res.lines.map((l, i) => ({ t: l.t, bbox: { x: l.x / res.w, y: l.y / res.h, w: l.w / res.w, h: l.h / res.h }, memo: memo[i] })),
          compact: compactText(res.lines, memo),
        };
        doc = label;
        source = "방금 읽음 · 이 PC와 DB에 저장";
        await localPut(label);
        const saved = await saveOcr(label);
        if (saved.ok) await localMarkUploaded([hash]);
        else source = "방금 읽음 · 이 PC에 저장(DB 저장 실패)";
      }

      // 2. Compare with the category in the DB.
      if (live()) setState({ step: "run", label: `DB의 ${category} 라벨과 비교 중…` });
      const res = await checkAgainstDb({ hash, category, w: doc.w, h: doc.h, lines: doc.lines });
      if (!res.ok) throw new Error(res.reason === "not_ready" ? "OCR 문구 DB가 아직 준비되지 않았습니다." : (res.message ?? "비교하지 못했습니다."));
      const rows: OcrRow[] = res.findings.map((f) => ({ ...f, entry, verdict: f.ocrLike ? "misread" : "unclear", second: null }));

      // 3. Each suspect read again, enlarged (needs the helper).
      let reread = false;
      if (helper) {
        reread = true;
        for (let i = 0; i < rows.length; i++) {
          if (rows[i].ocrLike) continue;
          if (live()) setState({ step: "run", label: `의심 자리 확대해 다시 읽는 중 · ${i + 1}/${rows.length}` });
          const again = await ocrFile(file, rereadBox(rows[i]));
          const second = again.ok ? again.lines.map((l) => l.t).join(" ") : null;
          rows[i] = { ...rows[i], second, verdict: ocrVerdict(rows[i], second) };
        }
      }
      if (live()) setState({ step: "done", rows, reference: res.reference, category, source, reread });
    } catch (err) {
      if (live()) setState({ step: "error", message: err instanceof Error ? err.message : "검사하지 못했습니다." });
    }
  }

  // Runs by itself when a label is opened (free; a label read before takes a second or two).
  useEffect(() => {
    setShowMisread(false);
    if (!category || bridge.state === "checking") return;
    void run();
    return cancel;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryKey(entry), bridge.state]);

  if (entry.ext !== "ai" && entry.ext !== "pdf") return null;
  const count = (v: OcrVerdict) => (state.step === "done" ? state.rows.filter((r) => r.verdict === v).length : 0);

  return (
    <section className="flex flex-col gap-2 rounded border border-line p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-bold text-ink">기준 대비 검사 (OCR · 무료)</h3>
        {state.step === "done" && (
          <span className="text-xs text-ink-muted">
            DB의 {state.category} 라벨 {state.reference.toLocaleString()}개와 비교 · {state.source}
          </span>
        )}
        {category && state.step !== "run" && (
          <button type="button" onClick={() => void run()} className="ml-auto rounded-sm border border-line-strong px-2 py-0.5 text-xs hover:bg-canvas">
            다시 검사
          </button>
        )}
      </div>

      {!category && <p className="text-xs text-ink-muted">박스·스티커·멸균지 파일만 기준 대비 검사를 합니다.</p>}
      {state.step === "run" && <p className="text-xs text-brand-700">{state.label}</p>}
      {state.step === "error" && (
        <p role="alert" className="rounded border border-flag-line bg-flag-soft px-3 py-2 text-xs text-flag">
          {state.message}
        </p>
      )}

      {state.step === "done" && (
        <>
          {count("typo") + count("unclear") === 0 ? (
            <p className="rounded border border-pass-line bg-pass-soft px-3 py-2 text-xs text-pass">
              같은 분류의 다른 라벨들과 다르게 쓴 글자를 찾지 못했습니다.
            </p>
          ) : (
            VERDICTS.map((v) => <Section key={v} v={v} rows={state.rows} onOpen={onOpen} crops />)
          )}
          {!state.reread && state.rows.some((r) => !r.ocrLike) && (
            <p className="text-xs text-warn">연결 도우미가 꺼져 있어 확대해 다시 읽지 못했습니다 — 의심은 모두 «판단 불가»로 표시합니다.</p>
          )}
          {count("misread") > 0 && (
            <div className="flex flex-col gap-1.5">
              <button type="button" onClick={() => setShowMisread((s) => !s)} className="w-fit text-xs text-ink-muted underline">
                {showMisread ? "OCR 오독 숨기기" : `OCR 오독으로 걸러낸 ${count("misread")}건 보기`}
              </button>
              {showMisread && <Section v="misread" rows={state.rows} onOpen={onOpen} crops={false} />}
            </div>
          )}
          <p className="text-[11px] text-ink-faint">
            기준: 1페이지를 Windows OCR로 읽어, DB에 쌓인 같은 분류 라벨에 많이 나온 표기와 한 글자 다르면 의심 · 작업 메모·조사·대소문자 차이 제외 · 모든 라벨이
            똑같이 틀렸거나 이 라벨에만 있는 문장은 못 잡음 · 최종 판단은 담당자.
          </p>
        </>
      )}
    </section>
  );
}
