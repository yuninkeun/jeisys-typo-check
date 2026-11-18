"use client";

import { useEffect, useMemo, useState } from "react";
import { formatSize, type FileEntry } from "./file-tree";
import { liveTextSample } from "./pdf-render";

/** Words that mark a print/outlined copy or a version, not a different design. */
const NOISE =
  /(outlines?|outlined|ol|아웃라인|윤곽선?|인쇄용?|print|최종|final|copy|사본|복사본|cs\d+|v\d+|ver\d*|rev\d*|\(\d+\)|\d{6,8})/gi;

function baseName(name: string) {
  return name
    .replace(/\.[^.]+$/, "")
    .toLowerCase()
    .replace(NOISE, " ")
    .replace(/[\s_\-.()[\]]+/g, "");
}

function folderOf(path: string) {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i);
}

/** 0 = unrelated. Higher = more likely the same design under another name. */
function similarity(a: FileEntry, b: FileEntry) {
  const x = baseName(a.name);
  const y = baseName(b.name);
  if (!x || !y) return 0;
  let score = 0;
  if (x === y) score = 3;
  else if (x.includes(y) || y.includes(x)) score = 2;
  else {
    let p = 0;
    while (p < x.length && p < y.length && x[p] === y[p]) p++;
    if (p / Math.min(x.length, y.length) >= 0.6) score = 1;
  }
  if (score && folderOf(a.path) === folderOf(b.path)) score += 0.5;
  return score;
}

type Check = { state: "checking" } | { state: "live"; sample: string[] } | { state: "outlined" } | { state: "error" };

const MAX_CHECK_BYTES = 150 * 1024 * 1024;

/** Shown for a file whose text was converted to outlines: explains why it can't
 *  be edited and looks in the opened folder for an editable original. */
export function OutlineHelp({
  entry,
  entries,
  onSelect,
}: {
  entry: FileEntry;
  entries: FileEntry[];
  onSelect: (e: FileEntry) => void;
}) {
  const candidates = useMemo(
    () =>
      entries
        .filter((e) => e.path !== entry.path && (e.ext === "ai" || e.ext === "pdf"))
        .map((e) => ({ e, score: similarity(entry, e) + (e.ext === "ai" ? 0.2 : 0) }))
        .filter((c) => c.score >= 1)
        .sort((a, b) => b.score - a.score)
        .slice(0, 6)
        .map((c) => c.e),
    [entry, entries],
  );
  const [checks, setChecks] = useState<Record<string, Check>>({});

  // One at a time: big .ai files take a lot of memory to open.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const c of candidates) {
        if (cancelled) return;
        setChecks((prev) => ({ ...prev, [c.path]: { state: "checking" } }));
        let result: Check;
        try {
          const file = await c.getFile();
          if (file.size > MAX_CHECK_BYTES) result = { state: "error" };
          else {
            const sample = await liveTextSample(file);
            result = sample.length ? { state: "live", sample } : { state: "outlined" };
          }
        } catch {
          result = { state: "error" };
        }
        if (cancelled) return;
        setChecks((prev) => ({ ...prev, [c.path]: result }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [candidates]);

  const live = candidates.filter((c) => checks[c.path]?.state === "live");
  const done = candidates.every((c) => {
    const s = checks[c.path]?.state;
    return s && s !== "checking";
  });

  return (
    <section className="flex flex-col gap-2 rounded border border-flag-line bg-flag-soft/50 p-4">
      <h3 className="text-sm font-bold text-flag">윤곽선 파일 — 글자를 고칠 수 없습니다</h3>
      <p className="text-xs leading-relaxed text-ink-muted">
        이 파일의 글자는 그림 선(윤곽선)으로 바뀌어 있어서, 폰트·색상을 유지한 채 글자를 바꿀 수 없습니다.
        윤곽선으로 바꾸기 <b>전의 작업용 원본</b>으로 수정하는 것이 가장 확실합니다.
      </p>

      {candidates.length === 0 ? (
        <p className="text-xs text-ink-muted">
          열어 둔 폴더에서 이름이 비슷한 파일을 찾지 못했습니다. 작업용 원본이 있는 상위 폴더를 열어 보세요.
          원본이 없으면 아래 <b>오타 검사</b> 후 <b>오타 위치 표시</b>를 쓰면, 고칠 곳에 빨간 상자와 메모를 단 파일을 만들어 드립니다.
        </p>
      ) : (
        <>
          <p className="text-xs font-medium text-ink">
            이름이 비슷한 파일 {candidates.length}개를 확인합니다
            {done && (live.length ? ` — 글자가 살아 있는 파일 ${live.length}개를 찾았습니다.` : " — 모두 윤곽선 파일입니다.")}
          </p>
          <ul className="flex flex-col gap-1">
            {candidates.map((c) => {
              const s = checks[c.path];
              return (
                <li key={c.path} className="flex flex-wrap items-center gap-2 rounded border border-line bg-surface px-3 py-1.5 text-xs">
                  <span className="rounded-sm border border-line-strong px-1 text-[11px] uppercase text-ink-muted">{c.ext}</span>
                  <span className="min-w-0 flex-1 break-all text-ink" title={c.path}>
                    {c.path}
                    {c.size != null && <span className="ml-1 text-ink-faint">· {formatSize(c.size)}</span>}
                  </span>
                  {!s || s.state === "checking" ? (
                    <span className="text-ink-faint">{s ? "확인 중…" : "대기"}</span>
                  ) : s.state === "live" ? (
                    <>
                      <span className="font-medium text-pass" title={s.sample.join(" / ")}>
                        글자 있음 · 고칠 수 있음
                      </span>
                      <button
                        type="button"
                        onClick={() => onSelect(c)}
                        className="h-7 rounded-sm bg-brand-700 px-2.5 font-medium text-white hover:bg-brand-800"
                      >
                        이 파일로 수정
                      </button>
                    </>
                  ) : s.state === "outlined" ? (
                    <span className="text-ink-faint">윤곽선</span>
                  ) : (
                    <span className="text-ink-faint">확인 못 함</span>
                  )}
                </li>
              );
            })}
          </ul>
          {done && live.length === 0 && (
            <p className="text-xs text-ink-muted">
              원본이 없으면 아래 <b>오타 검사</b> 후 <b>오타 위치 표시</b>를 쓰면, 고칠 곳에 빨간 상자와 메모를 단 파일을 만들어 드립니다.
            </p>
          )}
        </>
      )}
    </section>
  );
}
