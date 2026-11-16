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

export function buildTree(rootName: string, entries: FileEntry[]): DirNode {
  const root: DirNode = { name: rootName, path: "", dirs: [], files: [], total: 0 };
  const byPath = new Map<string, DirNode>([["", root]]);

  for (const entry of entries) {
    const parts = entry.path.split("/");
    let node = root;
    node.total++;
    for (let i = 0; i < parts.length - 1; i++) {
      const path = parts.slice(0, i + 1).join("/");
      let child = byPath.get(path);
      if (!child) {
        child = { name: parts[i], path, dirs: [], files: [], total: 0 };
        byPath.set(path, child);
        node.dirs.push(child);
      }
      child.total++;
      node = child;
    }
    node.files.push(entry);
  }

  for (const node of byPath.values()) {
    node.dirs.sort((a, b) => collator.compare(a.name, b.name));
    node.files.sort((a, b) => collator.compare(a.name, b.name));
  }
  return root;
}

export function formatSize(bytes: number | undefined) {
  if (bytes == null) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
