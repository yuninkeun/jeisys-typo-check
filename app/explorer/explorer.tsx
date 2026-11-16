"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildTree,
  entriesFromFileList,
  fillSizes,
  formatSize,
  scanDirectoryHandle,
  type DirNode,
  type FileEntry,
  type ScanProgress,
} from "./file-tree";
import { FilePanel } from "./file-panel";

type ExtFilter = "all" | "ai" | "pdf" | "image";

const EXT_FILTERS: { value: ExtFilter; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "ai", label: "AI" },
  { value: "pdf", label: "PDF" },
  { value: "image", label: "이미지" },
];

function matchesExt(entry: FileEntry, filter: ExtFilter) {
  if (filter === "all") return true;
  if (filter === "image") return entry.ext === "png" || entry.ext === "jpg" || entry.ext === "jpeg";
  return entry.ext === filter;
}

const EXT_BADGE: Record<string, string> = {
  ai: "border-[#f3c58a] bg-[#fff6ea] text-[#9a5b00]",
  pdf: "border-flag-line bg-flag-soft text-flag",
  png: "border-brand-200 bg-brand-50 text-brand-700",
  jpg: "border-brand-200 bg-brand-50 text-brand-700",
  jpeg: "border-brand-200 bg-brand-50 text-brand-700",
};

function ExtBadge({ ext }: { ext: string }) {
  return (
    <span
      className={`w-9 shrink-0 rounded-sm border text-center text-[10px] font-bold uppercase leading-4 ${EXT_BADGE[ext]}`}
    >
      {ext === "jpeg" ? "jpg" : ext}
    </span>
  );
}

function FileRow({
  entry,
  depth,
  selected,
  onSelect,
  showPath,
}: {
  entry: FileEntry;
  depth: number;
  selected: boolean;
  onSelect: (e: FileEntry) => void;
  showPath?: boolean;
}) {
  const dir = entry.path.split("/").slice(0, -1).join(" / ");
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(entry)}
        title={entry.path}
        style={{ paddingLeft: 8 + depth * 16 }}
        className={`flex w-full items-center gap-2 py-1 pr-2 text-left text-[13px] ${
          selected ? "bg-brand-700 text-white" : "text-ink hover:bg-canvas"
        }`}
      >
        <ExtBadge ext={entry.ext} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate">{entry.name}</span>
          {showPath && dir && (
            <span className={`truncate text-[11px] ${selected ? "text-brand-100" : "text-ink-faint"}`}>
              {dir}
            </span>
          )}
        </span>
        <span className={`shrink-0 text-[11px] tabular-nums ${selected ? "text-brand-100" : "text-ink-faint"}`}>
          {formatSize(entry.size)}
        </span>
      </button>
    </li>
  );
}

function DirBranch({
  node,
  depth,
  expanded,
  toggle,
  selectedPath,
  onSelect,
}: {
  node: DirNode;
  depth: number;
  expanded: Set<string>;
  toggle: (path: string) => void;
  selectedPath: string | null;
  onSelect: (e: FileEntry) => void;
}) {
  const open = expanded.has(node.path);
  return (
    <li>
      <button
        type="button"
        onClick={() => toggle(node.path)}
        aria-expanded={open}
        style={{ paddingLeft: 8 + depth * 16 }}
        className="flex w-full items-center gap-1.5 py-1 pr-2 text-left text-[13px] font-medium text-ink hover:bg-canvas"
      >
        <span aria-hidden className={`inline-block w-3 text-[10px] text-ink-faint transition-transform ${open ? "rotate-90" : ""}`}>
          ▶
        </span>
        <span aria-hidden>{open ? "📂" : "📁"}</span>
        <span className="min-w-0 flex-1 truncate">{node.name}</span>
        <span className="shrink-0 rounded-full bg-canvas px-1.5 text-[11px] tabular-nums text-ink-muted">
          {node.total}
        </span>
      </button>
      {open && (
        <ul>
          {node.dirs.map((d) => (
            <DirBranch
              key={d.path}
              node={d}
              depth={depth + 1}
              expanded={expanded}
              toggle={toggle}
              selectedPath={selectedPath}
              onSelect={onSelect}
            />
          ))}
          {node.files.map((f) => (
            <FileRow
              key={f.path}
              entry={f}
              depth={depth + 1}
              selected={selectedPath === f.path}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

const SEARCH_LIMIT = 300;

function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent ${className}`}
    />
  );
}

export function Explorer() {
  const [rootName, setRootName] = useState<string | null>(null);
  const [entries, setEntries] = useState<FileEntry[]>([]);
  /** "picking" = the OS folder dialog is open; then scanning progress. */
  const [phase, setPhase] = useState<"idle" | "picking" | "scanning">("idle");
  const [scanning, setScanning] = useState<ScanProgress | null>(null);
  const [scanSeconds, setScanSeconds] = useState<number | null>(null);
  const [, setSizeTick] = useState(0);
  const scanAbort = useRef<AbortController | null>(null);
  const sizeAbort = useRef<AbortController | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [extFilter, setExtFilter] = useState<ExtFilter>("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set([""]));
  const [selected, setSelected] = useState<FileEntry | null>(null);
  const fallbackInput = useRef<HTMLInputElement>(null);
  // Closing the folder input without choosing fires "cancel" (not in React's typings).
  useEffect(() => {
    const input = fallbackInput.current;
    if (!input) return;
    const onCancel = () => setPhase("idle");
    input.addEventListener("cancel", onCancel);
    return () => input.removeEventListener("cancel", onCancel);
  }, []);

  const filtered = useMemo(
    () => entries.filter((e) => matchesExt(e, extFilter)),
    [entries, extFilter],
  );
  const tree = useMemo(
    () => (rootName ? buildTree(rootName, filtered) : null),
    [rootName, filtered],
  );
  const searchResults = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return null;
    return filtered.filter((e) => {
      const p = e.path.toLowerCase();
      return words.every((w) => p.includes(w));
    });
  }, [filtered, query]);

  useEffect(() => () => {
    scanAbort.current?.abort();
    sizeAbort.current?.abort();
  }, []);

  function loaded(name: string, list: FileEntry[]) {
    setRootName(name);
    setEntries(list);
    setExpanded(new Set([""]));
    setSelected(null);
    setQuery("");
    // Sizes are only for display, so read them after the tree is usable.
    sizeAbort.current?.abort();
    const ctrl = new AbortController();
    sizeAbort.current = ctrl;
    if (list.some((e) => e.size == null)) {
      fillSizes(list, () => setSizeTick((t) => t + 1), ctrl.signal);
    }
  }

  async function openFolder() {
    setError(null);
    const picker = (window as unknown as {
      showDirectoryPicker?: (o: { mode: "read" }) => Promise<Parameters<typeof scanDirectoryHandle>[0]>;
    }).showDirectoryPicker;
    // The Claude desktop app's built-in browser shows the folder picker but then
    // rejects the read permission (AbortError even when a folder was chosen),
    // so use the plain folder input there.
    if (!picker || /\bClaude\//.test(navigator.userAgent)) {
      setPhase("picking");
      fallbackInput.current?.click();
      return;
    }
    setPhase("picking");
    let handle: Parameters<typeof scanDirectoryHandle>[0];
    try {
      handle = await picker({ mode: "read" });
    } catch (err) {
      setPhase("idle");
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(
        `폴더를 열지 못했습니다: ${err instanceof Error ? err.message : ""} (드라이브 최상위(D:\\)는 브라우저가 막을 수 있습니다. 그 안의 폴더를 선택해 주세요.)`,
      );
      return;
    }

    const ctrl = new AbortController();
    scanAbort.current = ctrl;
    sizeAbort.current?.abort();
    setPhase("scanning");
    setScanning({ found: 0, folders: 0, folder: handle.name });
    const started = performance.now();
    try {
      const list = await scanDirectoryHandle(handle, setScanning, ctrl.signal);
      setScanSeconds((performance.now() - started) / 1000);
      loaded(handle.name, list);
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        setError(`폴더를 읽다가 멈췄습니다: ${err instanceof Error ? err.message : ""}`);
      }
    } finally {
      setPhase("idle");
      setScanning(null);
      scanAbort.current = null;
    }
  }

  function onFallbackPicked(files: FileList | null) {
    if (!files || files.length === 0) return;
    const first = files[0].webkitRelativePath.split("/")[0] || "선택한 폴더";
    const started = performance.now();
    const list = entriesFromFileList(files);
    setScanSeconds((performance.now() - started) / 1000);
    loaded(first, list);
  }

  function toggle(path: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function setAll(open: boolean) {
    if (!tree) return;
    if (!open) return setExpanded(new Set([""]));
    const all = new Set<string>();
    const walk = (n: DirNode) => {
      all.add(n.path);
      n.dirs.forEach(walk);
    };
    walk(tree);
    setExpanded(all);
  }

  /** Opens every folder above a search hit, so it can be seen in the tree too. */
  function reveal(entry: FileEntry) {
    const parts = entry.path.split("/");
    setExpanded((prev) => {
      const next = new Set(prev);
      for (let i = 1; i < parts.length; i++) next.add(parts.slice(0, i).join("/"));
      return next;
    });
  }

  function select(entry: FileEntry) {
    setSelected(entry);
    reveal(entry);
  }

  const counts = useMemo(() => {
    const c = { ai: 0, pdf: 0, image: 0 };
    for (const e of entries) {
      if (e.ext === "ai") c.ai++;
      else if (e.ext === "pdf") c.pdf++;
      else c.image++;
    }
    return c;
  }, [entries]);

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[minmax(320px,400px)_1fr]">
      <aside className="flex min-h-[420px] flex-col overflow-hidden rounded border border-line bg-surface lg:h-[calc(100vh-170px)]">
        <div className="flex flex-col gap-2.5 border-b border-line p-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={openFolder}
              disabled={phase !== "idle"}
              aria-busy={phase !== "idle"}
              className="flex h-9 shrink-0 items-center gap-2 rounded bg-brand-700 px-3 text-sm font-medium text-white transition hover:bg-brand-800 active:scale-95 disabled:cursor-wait disabled:bg-brand-500"
            >
              {phase === "picking" ? (
                <>
                  <Spinner /> 폴더 선택 창 열림…
                </>
              ) : phase === "scanning" ? (
                <>
                  <Spinner /> 읽는 중… {scanning?.found.toLocaleString() ?? 0}개
                </>
              ) : rootName ? (
                "다른 폴더 열기"
              ) : (
                "📂 폴더 열기"
              )}
            </button>
            <input
              ref={fallbackInput}
              type="file"
              multiple
              hidden
              onChange={(e) => {
                const files = e.target.files;
                setPhase("idle");
                onFallbackPicked(files);
                e.target.value = "";
              }}
              {...{ webkitdirectory: "", directory: "" }}
            />
            {rootName && phase === "idle" && (
              <span className="min-w-0 truncate text-xs text-ink-muted" title={rootName}>
                📂 {rootName} · AI {counts.ai} · PDF {counts.pdf} · 이미지 {counts.image}
                {scanSeconds != null && ` · ${scanSeconds.toFixed(1)}초`}
              </span>
            )}
          </div>

          {rootName && (
            <>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="파일명·폴더명 검색 (예: POTENZA 멸균지)"
                className="h-9 rounded border border-line-strong bg-white px-3 text-sm text-ink placeholder:text-ink-faint"
              />
              <div className="flex flex-wrap items-center gap-1.5">
                {EXT_FILTERS.map((f) => (
                  <button
                    key={f.value}
                    type="button"
                    onClick={() => setExtFilter(f.value)}
                    className={
                      extFilter === f.value
                        ? "rounded-sm bg-brand-700 px-2 py-0.5 text-xs font-medium text-white"
                        : "rounded-sm border border-line-strong px-2 py-0.5 text-xs text-ink-muted hover:bg-canvas"
                    }
                  >
                    {f.label}
                  </button>
                ))}
                {!searchResults && (
                  <span className="ml-auto flex gap-2 text-xs">
                    <button type="button" onClick={() => setAll(true)} className="text-ink-muted underline hover:text-ink">
                      모두 펼치기
                    </button>
                    <button type="button" onClick={() => setAll(false)} className="text-ink-muted underline hover:text-ink">
                      접기
                    </button>
                  </span>
                )}
              </div>
            </>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-auto py-1">
          {phase === "picking" ? (
            <div className="flex flex-col items-center gap-2 px-5 py-10 text-center text-sm text-ink-muted">
              <Spinner className="h-6 w-6 text-brand-700" />
              <p>폴더 선택 창이 열렸습니다.</p>
              <p className="text-xs text-ink-faint">
                창이 안 보이면 작업 표시줄에서 찾아 주세요. 폴더를 고른 뒤 &quot;보기&quot; 또는
                &quot;업로드&quot; 확인을 누르면 하위 폴더까지 모두 읽습니다. (실제로 업로드되지는 않습니다)
              </p>
            </div>
          ) : phase === "scanning" && scanning ? (
            <div className="flex flex-col items-center gap-3 px-5 py-10 text-center">
              <Spinner className="h-7 w-7 text-brand-700" />
              <p className="text-sm font-medium text-ink">폴더 구조를 읽는 중…</p>
              <p className="text-2xl font-bold tabular-nums text-brand-700">
                {scanning.found.toLocaleString()}
                <span className="ml-1 text-sm font-normal text-ink-muted">개 파일</span>
              </p>
              <p className="text-xs text-ink-muted">폴더 {scanning.folders.toLocaleString()}개 확인</p>
              <p className="w-full truncate text-[11px] text-ink-faint" title={scanning.folder}>
                {scanning.folder}
              </p>
              <button
                type="button"
                onClick={() => scanAbort.current?.abort()}
                className="rounded-sm border border-line-strong px-3 py-1 text-xs text-ink-muted hover:bg-canvas"
              >
                취소
              </button>
            </div>
          ) : error ? (
            <p role="alert" className="m-3 rounded border border-flag-line bg-flag-soft px-3 py-2 text-sm text-flag">
              {error}
            </p>
          ) : !tree ? (
            <div className="flex flex-col gap-2 px-5 py-10 text-center text-sm text-ink-muted">
              <p>검사할 일러스트 파일이 있는 폴더를 열어 주세요.</p>
              <p className="text-xs text-ink-faint">
                예: D:\라벨 관련자료 · 파일은 이 PC에서만 읽고, 검사할 때 선택한 파일
                하나만 서버로 보냅니다.
              </p>
            </div>
          ) : searchResults ? (
            <>
              <p className="px-3 py-1.5 text-xs text-ink-muted">
                검색 결과 {searchResults.length.toLocaleString()}개
                {searchResults.length > SEARCH_LIMIT && ` (앞 ${SEARCH_LIMIT}개만 표시)`}
              </p>
              <ul>
                {searchResults.slice(0, SEARCH_LIMIT).map((e) => (
                  <FileRow
                    key={e.path}
                    entry={e}
                    depth={0}
                    selected={selected?.path === e.path}
                    onSelect={select}
                    showPath
                  />
                ))}
              </ul>
            </>
          ) : tree.total === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-ink-muted">
              이 폴더에는 AI·PDF·이미지 파일이 없습니다.
            </p>
          ) : (
            <ul>
              <DirBranch
                node={tree}
                depth={0}
                expanded={expanded}
                toggle={toggle}
                selectedPath={selected?.path ?? null}
                onSelect={select}
              />
            </ul>
          )}
        </div>
      </aside>

      <section className="min-w-0">
        {selected ? (
          <FilePanel key={selected.path} entry={selected} rootName={rootName ?? ""} />
        ) : (
          <div className="flex h-full min-h-[300px] items-center justify-center rounded border border-dashed border-line-strong bg-surface p-8 text-center text-sm text-ink-muted">
            왼쪽에서 파일을 선택하면 미리보기와 오타 검사, 수정 스크립트 만들기를 할 수 있습니다.
          </div>
        )}
      </section>
    </div>
  );
}
