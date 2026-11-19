"use client";

import { useRef, useState, type DragEvent } from "react";
import { extOf, type FileEntry } from "../explorer/file-tree";
import { OcrFileCheck, type CheckSummary } from "../explorer/ocr-file";

/** «파일만 넣으면 오타 검증»: drop label files (AI·PDF) here; each is checked
 *  against the label DB (박스·스티커·멸균지) — no folder, no category to pick. */

type Item = { id: string; entry: FileEntry; summary: CheckSummary };

const asEntry = (file: File): FileEntry | null => {
  const ext = extOf(file.name);
  if (ext !== "ai" && ext !== "pdf") return null;
  return { path: file.name, name: file.name, ext, size: file.size, getFile: async () => file } as FileEntry;
};

export function QuickCheck() {
  const [items, setItems] = useState<Item[]>([]);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  function add(files: FileList | File[]) {
    const next: Item[] = [];
    const bad: string[] = [];
    for (const f of Array.from(files)) {
      const e = asEntry(f);
      if (e) next.push({ id: `${f.name}|${f.size}|${f.lastModified}|${Math.random()}`, entry: e, summary: null });
      else bad.push(f.name);
    }
    setSkipped(bad);
    // Newest on top.
    setItems((prev) => [...next, ...prev]);
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setOver(false);
    if (e.dataTransfer.files.length) add(e.dataTransfer.files);
  }

  const done = items.filter((i) => typeof i.summary === "object" && i.summary !== null);
  const typo = done.reduce((a, i) => a + (i.summary as { typo: number }).typo, 0);
  const unclear = done.reduce((a, i) => a + (i.summary as { unclear: number }).unclear, 0);
  const running = items.filter((i) => i.summary === "run" || i.summary === null).length;

  return (
    <div className="flex flex-col gap-3">
      <div
        role="button"
        tabIndex={0}
        onClick={() => input.current?.click()}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        className={`flex cursor-pointer flex-col items-center gap-1 rounded-lg border-2 border-dashed px-4 py-8 text-center ${
          over ? "border-brand-700 bg-brand-50" : "border-line-strong bg-canvas hover:bg-brand-50"
        }`}
      >
        <span className="text-base font-bold text-ink">라벨 파일을 여기에 끌어다 놓으세요</span>
        <span className="text-xs text-ink-muted">AI·PDF · 여러 개 가능 · 누르면 파일을 고를 수 있습니다</span>
        <span className="text-[11px] text-ink-faint">박스·스티커·멸균지 라벨 DB와 비교해 다르게 쓴 글자를 찾습니다. 비용 없음 · 파일 원본은 서버로 보내지 않습니다.</span>
        <input
          ref={input}
          type="file"
          accept=".ai,.pdf"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) add(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {skipped.length > 0 && <p className="text-xs text-warn">AI·PDF 파일이 아니라 뺐습니다: {skipped.join(", ")}</p>}

      {items.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <span className="font-medium text-ink">파일 {items.length}개</span>
            {running > 0 && <span className="text-xs text-brand-700">검사 중 {running}개</span>}
            <span className="text-flag">오타 의심 {typo}건</span>
            <span className="text-warn">판단 불가 {unclear}건</span>
            <button type="button" onClick={() => setItems([])} className="ml-auto text-xs text-ink-muted underline hover:text-ink">
              모두 지우기
            </button>
          </div>
          <div className="flex flex-col gap-3">
            {items.map((it) => (
              <OcrFileCheck
                key={it.id}
                entry={it.entry}
                title={it.entry.name}
                onOpen={() => {}}
                onSummary={(s) => setItems((prev) => prev.map((x) => (x.id === it.id ? { ...x, summary: s } : x)))}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
