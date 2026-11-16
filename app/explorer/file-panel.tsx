"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { getCheckResult, uploadAndCheck, type CheckState } from "../check/actions";
import { MAX_FILE_BYTES } from "../check/limits";
import { buildIllustratorScript, scriptFileName, type TextFix } from "@/lib/illustrator-script";
import { formatSize, type FileEntry } from "./file-tree";
import { extractLines, openPdf, pageAsJpeg, renderPage } from "./pdf-render";
import { XmpEditor } from "./xmp-editor";

type Line = NonNullable<CheckState["lines"]>[number];
type Edit = { on: boolean; to: string };

type Snapshot = { blob: Blob; modified: number };

/** Copies the file's bytes now, so this version can still be shown after the
 *  file on disk is overwritten by Illustrator. */
async function snapshot(entry: FileEntry): Promise<Snapshot> {
  const file = await entry.getFile();
  return { blob: new Blob([await file.arrayBuffer()], { type: file.type }), modified: file.lastModified };
}

/** One page of a PDF/.ai (or an image). The page is controlled by the parent so
 *  the before/after previews turn pages together. */
function Preview({
  source,
  isPdf,
  alt,
  page,
  onPages,
  tall = true,
}: {
  source: Blob | null;
  isPdf: boolean;
  alt: string;
  page: number;
  onPages?: (n: number) => void;
  tall?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [doc, setDoc] = useState<Awaited<ReturnType<typeof openPdf>> | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    if (!source) return;
    let cancelled = false;
    let url: string | null = null;
    let opened: Awaited<ReturnType<typeof openPdf>> | null = null;
    (async () => {
      try {
        if (isPdf) {
          opened = await openPdf(source);
          if (cancelled) return void opened.destroy();
          setDoc(opened);
          onPages?.(opened.numPages);
        } else {
          url = URL.createObjectURL(source);
          setImgUrl(url);
          setStatus("ready");
        }
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
      opened?.destroy();
      setDoc(null);
    };
  }, [source, isPdf, onPages]);

  useEffect(() => {
    if (!doc || !canvasRef.current) return;
    setStatus("loading");
    renderPage(doc, Math.min(page, doc.numPages), canvasRef.current, 1400)
      .then(() => setStatus("ready"))
      .catch(() => setStatus("error"));
  }, [doc, page]);

  const maxH = tall ? "max-h-[460px]" : "max-h-[380px]";
  return (
    <div className="flex flex-col gap-2">
      <div className="relative flex min-h-[220px] items-center justify-center overflow-hidden rounded border border-line bg-[repeating-conic-gradient(#f1f3f6_0_25%,#fff_0_50%)] bg-[length:16px_16px] p-3">
        {imgUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imgUrl} alt={alt} className={`${maxH} max-w-full object-contain`} />
        ) : (
          <canvas ref={canvasRef} className={`${maxH} max-w-full object-contain shadow-sm`} />
        )}
        {status === "loading" && (
          <span className="absolute inset-0 flex items-center justify-center bg-white/60 text-sm text-ink-muted">
            미리보기 만드는 중…
          </span>
        )}
        {status === "error" && (
          <span className="absolute inset-0 flex items-center justify-center bg-white text-center text-sm text-ink-muted">
            미리보기를 만들 수 없습니다.
            <br />
            (PDF 호환 저장이 꺼진 .ai 파일일 수 있습니다)
          </span>
        )}
      </div>
    </div>
  );
}

function PageNav({ page, pages, setPage }: { page: number; pages: number; setPage: (n: number) => void }) {
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-center gap-2 text-xs text-ink-muted">
      <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} className="rounded-sm border border-line-strong px-2 py-0.5 disabled:opacity-40">
        ◀
      </button>
      {page} / {pages} 페이지
      <button type="button" disabled={page >= pages} onClick={() => setPage(page + 1)} className="rounded-sm border border-line-strong px-2 py-0.5 disabled:opacity-40">
        ▶
      </button>
    </div>
  );
}

/** "Precise target depth" → "Precise target[ed] depth": only the changed middle is marked. */
function DiffText({ from, to }: { from: string; to: string }) {
  let pre = 0;
  while (pre < from.length && pre < to.length && from[pre] === to[pre]) pre++;
  let suf = 0;
  while (
    suf < from.length - pre &&
    suf < to.length - pre &&
    from[from.length - 1 - suf] === to[to.length - 1 - suf]
  )
    suf++;
  return (
    <span className="whitespace-pre-wrap break-words">
      {from.slice(0, pre)}
      {from.length - suf > pre && (
        <del className="rounded-sm bg-flag-soft px-0.5 text-flag decoration-2">{from.slice(pre, from.length - suf)}</del>
      )}
      {to.length - suf > pre && (
        <ins className="rounded-sm bg-pass-soft px-0.5 font-semibold text-pass no-underline">{to.slice(pre, to.length - suf)}</ins>
      )}
      {from.slice(from.length - suf)}
    </span>
  );
}

/** Turns the picked file into something uploadAndCheck accepts (≤4MB PDF/PNG/JPG). */
async function toUploadable(entry: FileEntry): Promise<{ file: File; note?: string }> {
  const file = await entry.getFile();
  const isPdfLike = entry.ext === "pdf" || entry.ext === "ai";
  if (file.size <= MAX_FILE_BYTES) {
    if (isPdfLike) return { file: new File([file], file.name, { type: "application/pdf" }) };
    return { file: new File([file], file.name, { type: entry.ext === "png" ? "image/png" : "image/jpeg" }) };
  }
  if (!isPdfLike) throw new Error(`이미지가 ${formatSize(file.size)}라 4MB 제한을 넘습니다.`);
  const jpeg = await pageAsJpeg(file, MAX_FILE_BYTES);
  return {
    file: new File([jpeg], `${file.name} (1페이지).jpg`, { type: "image/jpeg" }),
    note: `파일이 ${formatSize(file.size)}라서 1페이지를 이미지로 바꿔 검사했습니다. 다른 페이지는 검사하지 않았습니다.`,
  };
}

function download(text: string, name: string) {
  // UTF-8 BOM so Illustrator's script engine reads the Korean comments correctly.
  const blob = new Blob(["﻿", text], { type: "application/javascript;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function FilePanel({ entry, rootName }: { entry: FileEntry; rootName: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [result, setResult] = useState<CheckState | null>(null);
  const [edits, setEdits] = useState<Map<number, Edit>>(new Map());
  const [filter, setFilter] = useState<"all" | "flagged" | "changed">("all");
  // The file's own text, read in the browser before (or without) the AI check.
  const [localLines, setLocalLines] = useState<Line[] | null>(null);
  const [extractMsg, setExtractMsg] = useState<string | null>(null);

  // Before/after: the version as first opened here, and the one saved later in Illustrator.
  const isPdf = entry.ext === "pdf" || entry.ext === "ai";
  const [original, setOriginal] = useState<Snapshot | null>(null);
  const [revised, setRevised] = useState<Snapshot | null>(null);
  const [compareMsg, setCompareMsg] = useState<string | null>(null);
  const [needPick, setNeedPick] = useState(false);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(0);
  const [revPages, setRevPages] = useState(0);
  const pickInput = useRef<HTMLInputElement>(null);
  const originalRef = useRef<Snapshot | null>(null);
  const revisedRef = useRef<Snapshot | null>(null);
  const seenRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    snapshot(entry)
      .then(async (s) => {
        if (cancelled) return;
        originalRef.current = s;
        setOriginal(s);
        if (entry.ext !== "pdf" && entry.ext !== "ai") return;
        try {
          const found = await extractLines(s.blob);
          if (cancelled) return;
          setLocalLines(found.map((l) => ({ text: l.text, page: l.page, is_flagged: false })));
          setExtractMsg(
            found.length === 0
              ? "파일에서 글자를 찾지 못했습니다. 글자가 윤곽선(아웃라인)으로 바뀌었을 수 있습니다. 오타 검사를 누르면 그림에서 글자를 읽어 봅니다."
              : null,
          );
        } catch {
          if (!cancelled) setExtractMsg("파일에서 글자를 읽지 못했습니다. 오타 검사로 확인해 주세요.");
        }
      })
      .catch(() => {
        if (!cancelled) setOriginal({ blob: new Blob(), modified: 0 });
      });
    return () => {
      cancelled = true;
    };
  }, [entry]);

  function showRevised(s: Snapshot) {
    revisedRef.current = s;
    seenRef.current = s.modified;
    setRevised(s);
    setRevPages(0);
    setNeedPick(false);
    setCompareMsg(null);
  }

  /** Re-reads the file from disk; if it was saved since it was opened here, shows both. */
  async function loadRevised(silent: boolean) {
    const base = originalRef.current;
    if (!base) return;
    try {
      const file = await entry.getFile();
      // A File from the plain folder input keeps its old timestamp; reading it
      // throws once the file changed on disk, which sends us to the catch below.
      await file.slice(0, 1).arrayBuffer();
      // A silent (focus) check skips versions already shown or closed; the button compares to the original.
      const last = silent ? (seenRef.current ?? base.modified) : (revisedRef.current?.modified ?? base.modified);
      if (file.lastModified === last) {
        if (!silent) setCompareMsg("아직 저장된 수정본이 없습니다. Illustrator에서 스크립트를 실행하고 저장(Ctrl+S)한 뒤 다시 눌러 주세요.");
        return;
      }
      showRevised({ blob: new Blob([await file.arrayBuffer()], { type: file.type }), modified: file.lastModified });
    } catch {
      // A file picked through the plain folder input can't be re-read once it
      // changes on disk (Chrome refuses), so ask for the saved file directly.
      setNeedPick(true);
      if (!silent) setCompareMsg("이 브라우저에서는 바뀐 파일을 자동으로 다시 읽을 수 없습니다. 저장한 수정본 파일을 직접 선택해 주세요.");
    }
  }

  // Coming back from Illustrator focuses this window again: check for a saved version then.
  useEffect(() => {
    if (!isPdf) return;
    const onFocus = () => void loadRevised(true);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry, isPdf]);

  async function onPicked(file: File | undefined) {
    if (!file) return;
    showRevised({ blob: new Blob([await file.arrayBuffer()], { type: file.type }), modified: file.lastModified });
  }

  function closeCompare() {
    revisedRef.current = null;
    setRevised(null);
    setRevPages(0);
  }

  function showResult(state: CheckState) {
    // Keep fixes typed in before the check, matched by the original text.
    const kept = new Map<string, Edit>();
    edits.forEach((edit, i) => {
      const line = lines[i];
      if (line && edit.on && edit.to !== line.text) kept.set(line.text, edit);
    });
    setResult(state);
    const next = new Map<number, Edit>();
    state.lines?.forEach((line, i) => {
      const prev = kept.get(line.text);
      if (prev) {
        next.set(i, prev);
        kept.delete(line.text);
      }
      // Not applied by default: AI suggestions are often wrong (e.g. splitting names),
      // and these go into print files, so each fix is a deliberate choice.
      else if (line.is_flagged) next.set(i, { on: false, to: line.suggested_text ?? line.text });
    });
    setEdits(next);
  }

  async function runCheck(force = false) {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const { file, note } = await toUploadable(entry);
      if (note) setNote(note);
      const fd = new FormData();
      fd.append("file", file);
      if (force) fd.append("force", "1");
      const state = await uploadAndCheck({}, fd);
      if (state.duplicateOf) {
        const prev = await getCheckResult(state.duplicateOf.id);
        if (prev.error) throw new Error(prev.error);
        setNote(
          `같은 파일을 ${new Date(state.duplicateOf.checkedAt).toLocaleString("ko-KR")}에 이미 검사해서 그 결과를 보여 줍니다.`,
        );
        showResult(prev);
      } else if (state.error) {
        setError(state.error);
      } else {
        showResult(state);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "검사 중 오류가 발생했습니다.");
    } finally {
      setBusy(false);
    }
  }

  function setEdit(i: number, patch: Partial<Edit>, line: Line) {
    setEdits((prev) => {
      const next = new Map(prev);
      const cur = next.get(i) ?? { on: false, to: line.text };
      next.set(i, { ...cur, ...patch });
      return next;
    });
  }

  function removeEdit(i: number) {
    setEdits((prev) => {
      const next = new Map(prev);
      next.delete(i);
      return next;
    });
  }

  const lines = result?.lines ?? localLines ?? [];
  const fixes: TextFix[] = [];
  edits.forEach((edit, i) => {
    const line = lines[i];
    if (line && edit.on && edit.to !== line.text) fixes.push({ from: line.text, to: edit.to });
  });
  const isChanged = (i: number) => {
    const e = edits.get(i);
    return !!e && e.on && e.to !== lines[i]?.text;
  };
  const all = lines.map((l, i) => [l, i] as const);
  const flaggedCount = all.filter(([l]) => l.is_flagged).length;
  const shown = all.filter(([l, i]) =>
    filter === "flagged" ? l.is_flagged : filter === "changed" ? isChanged(i) : true,
  );
  const canScript = entry.ext === "ai" || entry.ext === "pdf";
  const now = new Date();
  const today = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;

  return (
    <article className="flex flex-col overflow-hidden rounded border border-line bg-surface">
      <header className="flex flex-col gap-1 border-b border-line bg-canvas px-5 py-3">
        <h2 className="break-all text-sm font-bold text-ink">{entry.name}</h2>
        <p className="break-all text-xs text-ink-faint">
          {rootName} / {entry.path} · {formatSize(entry.size)}
        </p>
      </header>

      <div className="flex flex-col gap-5 p-5">
        {revised && original ? (
          <section className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-bold text-ink">수정 전 · 후 비교</h3>
              <span className="text-xs text-ink-faint">
                수정본 저장 시각 {new Date(revised.modified).toLocaleString("ko-KR")}
              </span>
              <button type="button" onClick={closeCompare} className="ml-auto text-xs text-ink-muted underline hover:text-ink">
                비교 닫기
              </button>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <span className="w-fit rounded-sm bg-flag-soft px-2 py-0.5 text-[11px] font-bold text-flag">이전 버전</span>
                <Preview source={original.blob} isPdf={isPdf} alt={`${entry.name} 이전`} page={page} onPages={setPages} tall={false} />
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="w-fit rounded-sm bg-pass-soft px-2 py-0.5 text-[11px] font-bold text-pass">수정 버전</span>
                <Preview key={revised.modified} source={revised.blob} isPdf={isPdf} alt={`${entry.name} 수정`} page={page} onPages={setRevPages} tall={false} />
              </div>
            </div>
            <PageNav page={page} pages={Math.max(pages, revPages)} setPage={setPage} />
          </section>
        ) : (
          <div className="flex flex-col gap-2">
            <Preview source={original?.blob ?? null} isPdf={isPdf} alt={entry.name} page={page} onPages={setPages} />
            <PageNav page={page} pages={pages} setPage={setPage} />
          </div>
        )}

        {isPdf && !revised && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <button
              type="button"
              onClick={() => (needPick ? pickInput.current?.click() : loadRevised(false))}
              className="h-8 rounded border border-line-strong px-3 text-ink-muted hover:bg-canvas"
            >
              {needPick ? "수정본 파일 선택해서 비교" : "수정본과 비교"}
            </button>
            <span className="text-ink-faint">
              Illustrator에서 저장하고 이 창으로 돌아오면 이전·수정 버전이 자동으로 나란히 보입니다.
            </span>
            <input
              ref={pickInput}
              type="file"
              accept=".ai,.pdf"
              hidden
              onChange={(e) => {
                void onPicked(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </div>
        )}
        {isPdf && <XmpEditor entry={entry} />}

        {compareMsg && !revised && (
          <p className="rounded border border-line-strong bg-canvas px-3 py-2 text-xs text-ink-muted">{compareMsg}</p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => runCheck(false)}
            disabled={busy}
            className="h-10 rounded bg-brand-700 px-4 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-60"
          >
            {busy ? "검사 중… (최대 30초)" : result ? "다시 불러오기" : "오타 검사"}
          </button>
          {result && !busy && (
            <button
              type="button"
              onClick={() => runCheck(true)}
              className="h-10 rounded border border-line-strong px-3 text-sm text-ink-muted hover:bg-canvas"
            >
              새로 검사
            </button>
          )}
          {result?.documentId && (
            <Link href={`/check/${result.documentId}`} className="text-xs text-ink-muted underline hover:text-ink">
              검증 이력 상세 보기 →
            </Link>
          )}
        </div>

        {note && <p className="rounded border border-line-strong bg-canvas px-3 py-2 text-xs text-ink-muted">{note}</p>}
        {error && (
          <p role="alert" className="rounded border border-flag-line bg-flag-soft px-3 py-2 text-sm text-flag">
            {error}
          </p>
        )}

        {extractMsg && !result && (
          <p className="rounded border border-line-strong bg-canvas px-3 py-2 text-xs text-ink-muted">{extractMsg}</p>
        )}

        {lines.length > 0 && (
          <>
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded border border-line px-4 py-3">
                <div className="text-2xl font-bold tabular-nums text-ink">{lines.length}</div>
                <div className="text-xs text-ink-muted">{result ? "추출된 줄" : "파일 속 글자 줄"}</div>
              </div>
              <div className="rounded border border-flag-line bg-flag-soft px-4 py-3 text-flag">
                <div className="text-2xl font-bold tabular-nums">{result ? flaggedCount : "-"}</div>
                <div className="text-xs opacity-80">{result ? "확인 필요" : "오타 검사 전"}</div>
              </div>
              <div className="rounded border border-pass-line bg-pass-soft px-4 py-3 text-pass">
                <div className="text-2xl font-bold tabular-nums">{fixes.length}</div>
                <div className="text-xs opacity-80">적용할 수정</div>
              </div>
            </div>

            <section className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-bold text-ink">글자 정보 — 기존(AS-IS) · 수정 후(TO-BE)</h3>
                <div className="ml-auto flex gap-1 text-xs">
                  {(
                    [
                      ["all", `전체 ${lines.length}`],
                      ["flagged", `오타 의심 ${flaggedCount}`],
                      ["changed", `수정함 ${fixes.length}`],
                    ] as const
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setFilter(key)}
                      className={`rounded-sm border px-2 py-0.5 ${filter === key ? "border-brand-700 bg-brand-700 text-white" : "border-line-strong text-ink-muted hover:bg-canvas"}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <p className="text-[11px] text-ink-faint">
                <b>수정</b>은 오타 검사가 제안한 글자로 바꾸고, <b>직접수정</b>은 원하는 글자를 직접 적습니다.
                {!result && " 오타 검사를 하면 오타 의심 줄과 제안이 함께 표시됩니다."}
              </p>
              {shown.length === 0 ? (
                <p className="rounded border border-line px-3 py-4 text-center text-xs text-ink-faint">해당하는 줄이 없습니다.</p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {shown.map(([line, i]) => (
                    <TextRow
                      key={`${result ? "r" : "l"}${i}`}
                      line={line}
                      edit={edits.get(i)}
                      onApply={(to) => setEdit(i, { on: true, to }, line)}
                      onUndo={() =>
                        line.is_flagged ? setEdit(i, { on: false, to: line.suggested_text ?? line.text }, line) : removeEdit(i)
                      }
                    />
                  ))}
                </ul>
              )}
            </section>

            <section className="flex flex-col gap-2 rounded border border-brand-200 bg-brand-50 p-4">
              <h3 className="text-sm font-bold text-brand-800">Illustrator에 수정 적용하기</h3>
              {canScript ? (
                <>
                  <ol className="list-decimal pl-5 text-xs leading-relaxed text-ink-muted">
                    <li>아래 <b>수정 스크립트 적용</b> 버튼으로 스크립트(.jsx)를 받습니다.</li>
                    <li>Illustrator에서 <b>{entry.name}</b> 파일을 엽니다.</li>
                    <li>파일 &gt; 스크립트 &gt; 기타 스크립트…(Ctrl+F12)에서 받은 .jsx를 선택합니다.</li>
                    <li>바뀐 글자만 다시 쓰므로 폰트·색상·크기는 그대로입니다. 적용이 끝나면 원본과 같은 폴더에 <b>{entry.name.replace(/\.[^.]+$/, "")}_{today}.ai</b> 완성본으로 자동 저장되고, 원본은 그대로 남습니다.</li>
                    <li>윤곽선으로 바뀐 글자는 고칠 수 없어 &quot;못 찾음&quot;으로 알려 줍니다.</li>
                  </ol>
                  <button
                    type="button"
                    disabled={fixes.length === 0}
                    onClick={() => download(buildIllustratorScript(entry.name, fixes), scriptFileName(entry.name))}
                    className="h-10 w-fit rounded bg-brand-700 px-4 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50"
                  >
                    수정 스크립트 적용 ({fixes.length}건)
                  </button>
                </>
              ) : (
                <p className="text-xs text-ink-muted">이미지 파일은 텍스트를 바꿀 수 없어 검사 결과만 제공합니다.</p>
              )}
            </section>
          </>
        )}
      </div>
    </article>
  );
}

/** One line of the file's text: AS-IS, TO-BE, and the 수정 / 직접수정 buttons. */
function TextRow({
  line,
  edit,
  onApply,
  onUndo,
}: {
  line: Line;
  edit?: Edit;
  onApply: (to: string) => void;
  onUndo: () => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const applied = !!edit && edit.on && edit.to !== line.text;
  const suggestion = line.suggested_text && line.suggested_text !== line.text ? line.suggested_text : null;
  const tone = applied
    ? "border-pass-line bg-pass-soft/40"
    : line.is_flagged
      ? "border-flag-line bg-flag-soft/40"
      : "border-line bg-surface";

  function confirm() {
    if (draft === null) return;
    if (draft.trim() === "" || draft === line.text) onUndo();
    else onApply(draft);
    setDraft(null);
  }

  const btn = "h-7 shrink-0 rounded-sm px-2.5 text-xs font-medium";
  return (
    <li className={`flex flex-col gap-1.5 rounded border px-3 py-2 ${tone}`}>
      <div className="flex items-center gap-1.5 text-[11px]">
        {line.page != null && <span className="rounded-sm border border-line-strong px-1.5 text-ink-muted">p.{line.page}</span>}
        {applied ? (
          <span className="rounded-sm bg-pass px-1.5 font-bold text-white">수정 예정</span>
        ) : line.is_flagged ? (
          <span className="rounded-sm bg-flag px-1.5 font-bold text-white">오타 의심</span>
        ) : null}
        <div className="ml-auto flex gap-1">
          {draft === null && !applied && suggestion && (
            <button type="button" onClick={() => onApply(suggestion)} className={`${btn} bg-brand-700 text-white hover:bg-brand-800`}>
              수정
            </button>
          )}
          {draft === null && (
            <button
              type="button"
              onClick={() => setDraft(applied && edit ? edit.to : (suggestion ?? line.text))}
              className={`${btn} border border-line-strong bg-white text-ink-muted hover:bg-canvas`}
            >
              직접수정
            </button>
          )}
          {draft === null && applied && (
            <button type="button" onClick={onUndo} className={`${btn} text-ink-faint underline hover:text-ink`}>
              되돌리기
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-[3.5rem_1fr] items-start gap-x-2 gap-y-1 text-sm">
        <span className="pt-0.5 text-[10px] font-bold tracking-wider text-ink-faint">AS-IS</span>
        <span className="whitespace-pre-wrap break-words text-ink">{line.text}</span>

        <span className="pt-0.5 text-[10px] font-bold tracking-wider text-pass">TO-BE</span>
        {draft !== null ? (
          <div className="flex flex-col gap-1.5">
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") confirm();
                if (e.key === "Escape") setDraft(null);
              }}
              className="rounded-sm border border-pass-line bg-white px-2 py-1 text-sm font-medium text-ink outline-none focus:ring-2 focus:ring-pass/30"
            />
            {draft !== line.text && draft.trim() !== "" && (
              <span className="text-xs text-ink-muted">
                바뀌는 부분: <DiffText from={line.text} to={draft} />
              </span>
            )}
            <div className="flex gap-1">
              <button type="button" onClick={confirm} className={`${btn} bg-pass text-white`}>
                확인
              </button>
              <button type="button" onClick={() => setDraft(null)} className={`${btn} border border-line-strong bg-white text-ink-muted`}>
                취소
              </button>
            </div>
          </div>
        ) : applied && edit ? (
          <DiffText from={line.text} to={edit.to} />
        ) : suggestion ? (
          <span className="text-ink-muted">
            <span className="mr-1 text-[10px] text-ink-faint">(제안)</span>
            <DiffText from={line.text} to={suggestion} />
          </span>
        ) : (
          <span className="text-xs text-ink-faint">그대로</span>
        )}
      </div>
      {line.flag_reason && <p className="text-xs leading-relaxed text-ink-muted">{line.flag_reason}</p>}
    </li>
  );
}
