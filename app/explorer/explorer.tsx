"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildTree,
  entriesFromFileList,
  categoryOf,
  fillSizes,
  formatSize,
  mergeRoots,
  scanDirectoryHandle,
  type DirNode,
  type FileEntry,
  type ScanProgress,
} from "./file-tree";
import { FilePanel } from "./file-panel";
import { BatchPanel, ReviewBar, useBatch } from "./batch";

type ExtFilter = "aipdf" | "all" | "ai" | "pdf" | "image";

const EXT_FILTERS: { value: ExtFilter; label: string }[] = [
  { value: "aipdf", label: "AI·PDF" },
  { value: "ai", label: "AI" },
  { value: "pdf", label: "PDF" },
  { value: "image", label: "이미지" },
  { value: "all", label: "전체" },
];

function matchesExt(entry: FileEntry, filter: ExtFilter) {
  if (filter === "all") return true;
  if (filter === "aipdf") return entry.ext === "ai" || entry.ext === "pdf";
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

const AI_COLOR = "#e8a23a";
const PDF_COLOR = "#d6455d";
const OTHER_COLOR = "#7b93c4";

/** One thin bar: how much of the parent folder this folder holds, split by type. */
function ShareBar({ node, of }: { node: DirNode; of: number }) {
  const width = of ? Math.max(4, (node.total / of) * 100) : 0;
  const other = node.total - node.ai - node.pdf;
  return (
    <span className="block h-1 w-full overflow-hidden rounded-full bg-canvas">
      <span className="flex h-full" style={{ width: `${width}%` }}>
        <span style={{ flex: node.ai, background: AI_COLOR }} />
        <span style={{ flex: node.pdf, background: PDF_COLOR }} />
        <span style={{ flex: other, background: OTHER_COLOR }} />
      </span>
    </span>
  );
}

function DirBranch({
  node,
  depth,
  parentTotal,
  expanded,
  toggle,
  selectedPath,
  onSelect,
  reviewPath,
  onReview,
}: {
  node: DirNode;
  depth: number;
  parentTotal: number;
  expanded: Set<string>;
  toggle: (path: string) => void;
  selectedPath: string | null;
  onSelect: (e: FileEntry) => void;
  reviewPath: string | null;
  onReview: (n: DirNode) => void;
}) {
  const open = expanded.has(node.path);
  const reviewing = reviewPath === node.path;
  return (
    <li>
      <div className={`group flex items-center ${reviewing ? "bg-brand-50" : "hover:bg-canvas"}`}>
      <button
        type="button"
        onClick={() => toggle(node.path)}
        aria-expanded={open}
        title={`${node.name}\nAI ${node.ai} · PDF ${node.pdf} · 전체 ${node.total}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        className="flex min-w-0 flex-1 items-center gap-1.5 py-[3px] pr-1 text-left text-[13px] font-medium text-ink"
      >
        <span aria-hidden className={`inline-block w-3 shrink-0 text-[10px] text-ink-faint transition-transform ${open ? "rotate-90" : ""}`}>
          ▶
        </span>
        <span aria-hidden className="shrink-0">{open ? "📂" : "📁"}</span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate">{node.name}</span>
          {depth > 0 && <ShareBar node={node} of={parentTotal} />}
        </span>
        <span className="flex shrink-0 gap-1 text-[10px] font-semibold tabular-nums">
          {node.ai > 0 && <span style={{ color: AI_COLOR }}>AI {node.ai}</span>}
          {node.pdf > 0 && <span style={{ color: PDF_COLOR }}>PDF {node.pdf}</span>}
          {node.total - node.ai - node.pdf > 0 && <span className="text-ink-faint">기타 {node.total - node.ai - node.pdf}</span>}
        </span>
      </button>
      {node.ai + node.pdf > 0 && (
        <button
          type="button"
          onClick={() => onReview(node)}
          title={`이 폴더의 AI 파일을 한꺼번에 검토합니다 (최대 200개)`}
          className={`mr-1.5 shrink-0 rounded-sm border px-1.5 text-[11px] font-medium leading-5 ${
            reviewing
              ? "border-brand-700 bg-brand-700 text-white"
              : "border-line-strong bg-surface text-brand-700 opacity-100 group-hover:opacity-100 focus:opacity-100 lg:opacity-0"
          }`}
        >
          검토
        </button>
      )}
      </div>
      {open && (
        <ul>
          {node.dirs.map((d) => (
            <DirBranch
              key={d.path}
              node={d}
              depth={depth + 1}
              parentTotal={node.total}
              expanded={expanded}
              toggle={toggle}
              selectedPath={selectedPath}
              onSelect={onSelect}
              reviewPath={reviewPath}
              onReview={onReview}
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

/** The biggest folders one or two levels down, as bars: where the files are, at a glance. */
function Overview({ tree, onOpen }: { tree: DirNode; onOpen: (path: string) => void }) {
  const [open, setOpen] = useState(true);
  // One opened folder holding a single big folder: look one level further.
  const level = tree.dirs.length === 1 && tree.files.length === 0 ? tree.dirs[0] : tree;
  const top = [...level.dirs].sort((a, b) => b.total - a.total);
  const shown = top.slice(0, 8);
  const rest = top.slice(8).reduce((n, d) => n + d.total, 0);
  const max = shown[0]?.total ?? 0;
  if (shown.length < 2) return null;
  return (
    <div className="border-b border-line px-3 py-2">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-1.5 text-left text-xs font-bold text-ink"
      >
        <span aria-hidden className={`inline-block text-[9px] text-ink-faint transition-transform ${open ? "rotate-90" : ""}`}>▶</span>
        구조 한눈에 보기
        <span className="font-normal text-ink-faint">— {level === tree ? "최상위" : level.name} 폴더 {top.length}개</span>
        <span className="ml-auto flex gap-2 text-[10px] font-normal">
          <span style={{ color: AI_COLOR }}>■ AI</span>
          <span style={{ color: PDF_COLOR }}>■ PDF</span>
        </span>
      </button>
      {open && (
        <ul className="mt-1.5 flex flex-col gap-1">
          {shown.map((d) => (
            <li key={d.path}>
              <button
                type="button"
                onClick={() => onOpen(d.path)}
                title={`${d.name} — AI ${d.ai} · PDF ${d.pdf} · 전체 ${d.total} (눌러서 트리에서 열기)`}
                className="grid w-full grid-cols-[minmax(0,40%)_1fr_auto] items-center gap-2 rounded-sm px-1 py-0.5 text-left text-[11px] hover:bg-canvas"
              >
                <span className="truncate text-ink">{d.name}</span>
                <span className="flex h-2.5 overflow-hidden rounded-sm bg-canvas">
                  <span className="flex h-full" style={{ width: `${(d.total / max) * 100}%` }}>
                    <span style={{ flex: d.ai, background: AI_COLOR }} />
                    <span style={{ flex: d.pdf, background: PDF_COLOR }} />
                    <span style={{ flex: d.total - d.ai - d.pdf, background: OTHER_COLOR }} />
                  </span>
                </span>
                <span className="w-9 text-right tabular-nums text-ink-muted">{d.total.toLocaleString()}</span>
              </button>
            </li>
          ))}
          {rest > 0 && (
            <li className="px-1 text-[11px] text-ink-faint">그 밖의 폴더 {top.length - shown.length}개 · {rest.toLocaleString()}개 파일</li>
          )}
        </ul>
      )}
    </div>
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
  // Several folders can be opened together (e.g. both top folders of D:) into one tree.
  const [roots, setRoots] = useState<{ name: string; entries: FileEntry[] }[]>([]);
  const entries = useMemo(() => (roots.length ? mergeRoots(roots) : []), [roots]);
  const rootName = roots.length === 0 ? null : roots.length === 1 ? roots[0].name : `열린 폴더 ${roots.length}개`;
  const addMode = useRef(false);
  const batch = useBatch();
  /** "picking" = the OS folder dialog is open; then scanning progress. */
  const [phase, setPhase] = useState<"idle" | "picking" | "scanning">("idle");
  const [scanning, setScanning] = useState<ScanProgress | null>(null);
  const [scanSeconds, setScanSeconds] = useState<number | null>(null);
  const [, setSizeTick] = useState(0);
  const scanAbort = useRef<AbortController | null>(null);
  const sizeAbort = useRef<AbortController | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [extFilter, setExtFilter] = useState<ExtFilter>("aipdf");
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

  /** "category" = only boxes, stickers and sterile pouches, sorted under those three. */
  const [view, setView] = useState<"category" | "folder">("category");
  const byExt = useMemo(
    () => entries.filter((e) => matchesExt(e, extFilter)),
    [entries, extFilter],
  );
  const { filtered, excluded } = useMemo(() => {
    if (view === "folder") return { filtered: byExt, excluded: 0 };
    const out: FileEntry[] = [];
    for (const e of byExt) {
      const cat = categoryOf(e.path);
      if (!cat) continue;
      // Sizes are read in later onto the original entry; read them through.
      out.push({
        path: `${cat}/${e.path}`,
        name: e.name,
        ext: e.ext,
        getFile: e.getFile,
        source: e,
        get size() {
          return e.size;
        },
      });
    }
    return { filtered: out, excluded: byExt.length - out.length };
  }, [byExt, view]);
  const tree = useMemo(() => {
    if (!rootName) return null;
    if (view === "folder") return buildTree(rootName, filtered);
    const t = buildTree("박스 · 스티커 · 멸균지", filtered, true);
    // Shown in the team's usual order, not the order the names are tested in.
    const order: string[] = ["박스", "스티커", "멸균지"];
    t.dirs.sort((a, b) => order.indexOf(a.path) - order.indexOf(b.path));
    return t;
  }, [rootName, filtered, view]);
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
    const add = addMode.current;
    addMode.current = false;
    setRoots((prev) => (add ? [...prev.filter((r) => r.name !== name), { name, entries: list }] : [{ name, entries: list }]));
    setExpanded(new Set([""]));
    setSelected(null);
    setQuery("");
    batch.close();
  }

  // Sizes are only for display, so read them after the tree is usable.
  useEffect(() => {
    sizeAbort.current?.abort();
    if (!entries.some((e) => e.size == null)) return;
    const ctrl = new AbortController();
    sizeAbort.current = ctrl;
    void fillSizes(entries, () => setSizeTick((t) => t + 1), ctrl.signal);
    return () => ctrl.abort();
  }, [entries]);

  async function openFolder(add = false) {
    addMode.current = add;
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

  /** Opens a folder and every folder above it. */
  function openPath(path: string) {
    const parts = path.split("/");
    setExpanded((prev) => {
      const next = new Set(prev);
      for (let i = 1; i <= parts.length; i++) next.add(parts.slice(0, i).join("/"));
      return next;
    });
    setQuery("");
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
              onClick={() => openFolder(false)}
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
              <button
                type="button"
                onClick={() => openFolder(true)}
                title="다른 폴더를 같은 트리에 더합니다 (예: D 드라이브의 다른 최상위 폴더)"
                className="h-9 shrink-0 rounded border border-line-strong px-2.5 text-xs font-medium text-ink-muted hover:bg-canvas"
              >
                ＋ 폴더 추가
              </button>
            )}
            {rootName && phase === "idle" && (
              <span className="min-w-0 truncate text-xs text-ink-muted" title={roots.map((r) => r.name).join("\n")}>
                📂 {rootName} · AI {counts.ai.toLocaleString()} · PDF {counts.pdf.toLocaleString()}
                {counts.image > 0 && ` · 이미지 ${counts.image.toLocaleString()}`}
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
              <div className="flex items-center gap-1 rounded bg-canvas p-0.5 text-xs">
                {(
                  [
                    ["category", "박스·스티커·멸균지"],
                    ["folder", "폴더 그대로"],
                  ] as const
                ).map(([v, label]) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => {
                      setView(v);
                      setExpanded(new Set([""]));
                    }}
                    className={`flex-1 rounded-sm px-2 py-1 font-medium ${
                      view === v ? "bg-surface text-brand-700 shadow-sm" : "text-ink-muted hover:text-ink"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {view === "category" && excluded > 0 && (
                <p className="text-[11px] text-ink-faint">
                  박스·스티커·멸균지가 아닌 파일 {excluded.toLocaleString()}개(매뉴얼·명판·배너 등)는 숨겼습니다. 분류는 &quot;BOX·STICKER·멸균지 정리&quot;
                  폴더를 먼저 따르고, 없으면 파일·폴더 이름으로 정합니다.
                </p>
              )}
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

        {tree && phase === "idle" && !searchResults && tree.total > 0 && <Overview tree={tree} onOpen={openPath} />}

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
                parentTotal={tree.total}
                expanded={expanded}
                toggle={toggle}
                selectedPath={selected?.path ?? null}
                onSelect={select}
                reviewPath={batch.folder?.path ?? null}
                onReview={(n) => {
                  batch.choose(n);
                  setSelected(null);
                }}
              />
            </ul>
          )}
        </div>
      </aside>

      <section className="flex min-w-0 flex-col gap-3">
        {/* Kept mounted while a file is open, so the review keeps running. */}
        {batch.folder && (
          <div hidden={!!selected}>
            <BatchPanel batch={batch} onOpen={select} />
          </div>
        )}
        {selected ? (
          <>
            {batch.folder && <ReviewBar batch={batch} entry={selected} onOpen={select} onBack={() => setSelected(null)} />}
            <FilePanel key={selected.path} entry={selected} rootName={rootName ?? ""} entries={entries} onSelect={select} />
          </>
        ) : (
          !batch.folder && (
            <div className="flex h-full min-h-[300px] flex-col items-center justify-center gap-2 rounded border border-dashed border-line-strong bg-surface p-8 text-center text-sm text-ink-muted">
              <p>왼쪽에서 파일을 선택하면 미리보기와 오타 검사, 수정 스크립트 만들기를 할 수 있습니다.</p>
              <p className="text-xs text-ink-faint">
                폴더 줄에 마우스를 올리면 나오는 <b className="text-brand-700">검토</b> 버튼을 누르면, 그 폴더의 AI 파일을 최대 200개까지
                한꺼번에 검토하고 결과를 요약해 보여 줍니다.
              </p>
            </div>
          )
        )}
      </section>
    </div>
  );
}
