/** Files the checker can read. .ai is PDF-compatible, so it renders like a PDF. */
export const SUPPORTED_EXTS = ["ai", "pdf", "png", "jpg", "jpeg"] as const;
export type SupportedExt = (typeof SUPPORTED_EXTS)[number];

export type FileEntry = {
  /** Path relative to the opened folder, "/"-separated, including the name. */
  path: string;
  name: string;
  ext: SupportedExt;
  /** Unknown until filled in after the scan — reading every file's size up
   *  front made opening a big folder take minutes. */
  size?: number;
  getFile: () => Promise<File>;
};

export type DirNode = {
  name: string;
  path: string;
  dirs: DirNode[];
  files: FileEntry[];
  /** Supported files anywhere below this folder. */
  total: number;
  ai: number;
  pdf: number;
};

export function extOf(name: string): SupportedExt | null {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return (SUPPORTED_EXTS as readonly string[]).includes(ext)
    ? (ext as SupportedExt)
    : null;
}

// The File System Access API's async iterators aren't in TypeScript's DOM lib yet.
type DirHandle = {
  name: string;
  kind: "directory";
  values(): AsyncIterable<DirHandle | FileHandle>;
};
type FileHandle = { name: string; kind: "file"; getFile(): Promise<File> };

export type ScanProgress = { found: number; folders: number; folder: string };

/** Walks a folder picked with showDirectoryPicker, keeping only supported files.
 *  Only names are read (no per-file open), and sibling folders are listed in
 *  parallel, so thousands of files come back in seconds. */
export async function scanDirectoryHandle(
  root: DirHandle,
  onProgress: (p: ScanProgress) => void,
  signal?: AbortSignal,
): Promise<FileEntry[]> {
  const out: FileEntry[] = [];
  let folders = 0;
  let lastReport = 0;
  const report = (folder: string, force = false) => {
    const now = performance.now();
    if (!force && now - lastReport < 120) return;
    lastReport = now;
    onProgress({ found: out.length, folders, folder });
  };

  async function walk(dir: DirHandle, prefix: string): Promise<void> {
    if (signal?.aborted) throw new DOMException("취소됨", "AbortError");
    folders++;
    report(prefix || dir.name);
    const subdirs: Promise<void>[] = [];
    for await (const handle of dir.values()) {
      const path = prefix ? `${prefix}/${handle.name}` : handle.name;
      if (handle.kind === "directory") {
        // Skip system/hidden folders such as $RECYCLE.BIN or .git.
        if (/^[.$]/.test(handle.name) || handle.name === "System Volume Information") continue;
        subdirs.push(walk(handle, path));
      } else {
        const ext = extOf(handle.name);
        if (!ext) continue;
        out.push({ path, name: handle.name, ext, getFile: () => handle.getFile() });
      }
    }
    await Promise.all(subdirs);
  }

  await walk(root, "");
  report(root.name, true);
  return out;
}

/** Reads file sizes after the tree is on screen, a few at a time. */
export async function fillSizes(
  entries: FileEntry[],
  onBatch: () => void,
  signal: AbortSignal,
) {
  let next = 0;
  let sinceUpdate = 0;
  async function worker() {
    while (next < entries.length && !signal.aborted) {
      const entry = entries[next++];
      if (entry.size != null) continue;
      try {
        entry.size = (await entry.getFile()).size;
      } catch {
        // Unreadable file: leave the size blank.
      }
      if (++sinceUpdate >= 200) {
        sinceUpdate = 0;
        onBatch();
      }
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker));
  if (!signal.aborted) onBatch();
}

/** Same result from an <input webkitdirectory> selection (browsers without the picker). */
export function entriesFromFileList(files: FileList): FileEntry[] {
  const out: FileEntry[] = [];
  for (const file of Array.from(files)) {
    const ext = extOf(file.name);
    if (!ext) continue;
    // Drop the picked folder's own name so paths match the picker version.
    const path = (file.webkitRelativePath || file.name).split("/").slice(1).join("/") || file.name;
    out.push({ path, name: file.name, ext, size: file.size, getFile: async () => file });
  }
  return out;
}

const collator = new Intl.Collator("ko", { numeric: true, sensitivity: "base" });

/** keepTop: never fold the first level (the 박스/스티커/멸균지 groups stay as they are). */
export function buildTree(rootName: string, entries: FileEntry[], keepTop = false): DirNode {
  const root: DirNode = { name: rootName, path: "", dirs: [], files: [], total: 0, ai: 0, pdf: 0 };
  const byPath = new Map<string, DirNode>([["", root]]);
  const count = (node: DirNode, entry: FileEntry) => {
    node.total++;
    if (entry.ext === "ai") node.ai++;
    else if (entry.ext === "pdf") node.pdf++;
  };

  for (const entry of entries) {
    const parts = entry.path.split("/");
    let node = root;
    count(node, entry);
    for (let i = 0; i < parts.length - 1; i++) {
      const path = parts.slice(0, i + 1).join("/");
      let child = byPath.get(path);
      if (!child) {
        child = { name: parts[i], path, dirs: [], files: [], total: 0, ai: 0, pdf: 0 };
        byPath.set(path, child);
        node.dirs.push(child);
      }
      count(child, entry);
      node = child;
    }
    node.files.push(entry);
  }

  for (const node of byPath.values()) {
    node.dirs.sort((a, b) => collator.compare(a.name, b.name));
    node.files.sort((a, b) => collator.compare(a.name, b.name));
  }
  root.dirs = keepTop ? root.dirs.map((d) => ({ ...d, dirs: d.dirs.map(compact) })) : root.dirs.map(compact);
  return root;
}

/** Folds a chain of folders that only hold one subfolder each ("a / b / c") into
 *  one row, so deep but empty structure takes one click instead of several. The
 *  folded node keeps the deepest path, which is what reveal() opens. */
function compact(node: DirNode): DirNode {
  let cur = node;
  let name = node.name;
  while (cur.files.length === 0 && cur.dirs.length === 1) {
    cur = cur.dirs[0];
    name = `${name} / ${cur.name}`;
  }
  return { ...cur, name, dirs: cur.dirs.map(compact) };
}

/** Packaging kinds the label team sorts by. Checked in this order, because a
 *  name often holds two: "TIP BOX 샷수 sticker" is a sticker for a box, and a
 *  sterile pouch name can mention the box it goes in. */
export const CATEGORIES = [
  { key: "멸균지", test: /멸균|tyvek|타이벡|파우치|pouch|steril/i },
  { key: "스티커", test: /스티커|sticker/i },
  { key: "박스", test: /박스|box|상자|단상자|케이스|carton|카톤/i },
] as const;
export type Category = (typeof CATEGORIES)[number]["key"];

/** The team's own sorting folders win ("BOX 정리", "STICKER 정리", "멸균지 정리":
 *  a "박스 라벨" filed under STICKER is a sticker that goes on a box). Otherwise
 *  the file name decides, then the nearest folder whose name says. */
const SORTED: [RegExp, Category][] = [
  [/^멸균지\s*정리/, "멸균지"],
  [/^sticker\s*정리/i, "스티커"],
  [/^box\s*정리/i, "박스"],
];

export function categoryOf(path: string): Category | null {
  const parts = path.split("/");
  for (let i = parts.length - 2; i >= 0; i--) {
    for (const [re, key] of SORTED) if (re.test(parts[i])) return key;
  }
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = i === parts.length - 1 ? parts[i].replace(/\.[^.]+$/, "") : parts[i];
    for (const c of CATEGORIES) if (c.test.test(part)) return c.key;
  }
  return null;
}

/** Merges several opened folders into one list; with more than one, each
 *  folder's name becomes the first part of its files' paths. */
export function mergeRoots(roots: { name: string; entries: FileEntry[] }[]): FileEntry[] {
  if (roots.length === 1) return roots[0].entries;
  return roots.flatMap((r) => r.entries.map((e) => ({ ...e, path: `${r.name}/${e.path}` })));
}

export function formatSize(bytes: number | undefined) {
  if (bytes == null) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
