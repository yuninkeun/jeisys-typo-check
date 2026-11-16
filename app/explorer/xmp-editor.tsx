"use client";

import { useMemo, useState } from "react";
import type { FileEntry } from "./file-tree";
import {
  byteLength,
  findPackets,
  mainPacket,
  parseXmp,
  readFields,
  readInfo,
  replacePacket,
  spaceFor,
  writeFields,
  type XmpFields,
  type XmpInfo,
  type XmpPacket,
} from "./xmp";

type Loaded = {
  bytes: Uint8Array;
  packet: XmpPacket;
  packetCount: number;
  original: XmpFields;
  info: XmpInfo;
};

const splitList = (s: string) => s.split(/[,\n]/).map((v) => v.trim()).filter(Boolean);

function formatDate(s: string) {
  if (!s) return "-";
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleString("ko-KR");
}

function saveBytes(bytes: Uint8Array, name: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/octet-stream" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Window for viewing and editing an .ai/.pdf file's XMP info (title, author…). */
export function XmpEditor({ entry }: { entry: FileEntry }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [title, setTitle] = useState("");
  const [creators, setCreators] = useState("");
  const [description, setDescription] = useState("");
  const [keywords, setKeywords] = useState("");
  const [showXml, setShowXml] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);

  async function load() {
    setOpen(true);
    if (loaded || loading) return;
    setLoading(true);
    setError(null);
    try {
      const bytes = new Uint8Array(await (await entry.getFile()).arrayBuffer());
      const packets = findPackets(bytes);
      const packet = mainPacket(packets);
      if (!packet) {
        throw new Error(
          "이 파일에서 파일 정보(XMP)를 찾지 못했습니다. 압축된 형태로 저장된 파일일 수 있습니다. Illustrator의 파일 > 파일 정보에서 고쳐 주세요.",
        );
      }
      const doc = parseXmp(packet.xml);
      const original = readFields(doc);
      setLoaded({ bytes, packet, packetCount: packets.length, original, info: readInfo(doc) });
      setTitle(original.title);
      setCreators(original.creators.join(", "));
      setDescription(original.description);
      setKeywords(original.keywords.join(", "));
    } catch (err) {
      setError(err instanceof Error ? err.message : "파일 정보를 읽지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  const fields: XmpFields = {
    title,
    creators: splitList(creators),
    description,
    keywords: splitList(keywords),
  };

  // The edited XML and whether it still fits in the file's reserved space.
  const preview = useMemo(() => {
    if (!loaded) return null;
    try {
      const xml = writeFields(loaded.packet.xml, {
        title,
        creators: splitList(creators),
        description,
        keywords: splitList(keywords),
      });
      return { xml, left: spaceFor(loaded.packet) - byteLength(xml) - 1 };
    } catch (err) {
      return { error: err instanceof Error ? err.message : "고친 내용을 만들 수 없습니다." };
    }
  }, [loaded, title, creators, description, keywords]);

  const o = loaded?.original;
  const changed =
    !!o &&
    (o.title !== fields.title.trim() ||
      o.description !== fields.description.trim() ||
      o.creators.join("\n") !== fields.creators.join("\n") ||
      o.keywords.join("\n") !== fields.keywords.join("\n"));

  function download() {
    if (!loaded || !preview || "error" in preview) return;
    try {
      const out = replacePacket(loaded.bytes, loaded.packet, preview.xml);
      const dot = entry.name.lastIndexOf(".");
      const name = `${entry.name.slice(0, dot)}_정보수정${entry.name.slice(dot)}`;
      saveBytes(out, name);
      setSaved(name);
    } catch (err) {
      setError(err instanceof Error ? err.message : "파일을 만들지 못했습니다.");
    }
  }

  function reset() {
    if (!o) return;
    setTitle(o.title);
    setCreators(o.creators.join(", "));
    setDescription(o.description);
    setKeywords(o.keywords.join(", "));
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={load}
        className="h-8 w-fit rounded border border-line-strong px-3 text-xs text-ink-muted hover:bg-canvas"
      >
        📝 파일 정보(XMP) 편집
      </button>
    );
  }

  const input = "rounded border border-line-strong bg-white px-3 py-1.5 text-sm text-ink placeholder:text-ink-faint";

  return (
    <section className="flex flex-col gap-3 rounded border border-line bg-canvas p-4">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-bold text-ink">파일 정보(XMP) 편집</h3>
        <span className="text-xs text-ink-faint">디자인 글자는 바뀌지 않고, 파일 속성만 바뀝니다.</span>
        <button type="button" onClick={() => setOpen(false)} className="ml-auto text-xs text-ink-muted underline hover:text-ink">
          닫기
        </button>
      </div>

      {loading && <p className="text-xs text-ink-muted">파일 정보를 읽는 중…</p>}
      {error && (
        <p role="alert" className="rounded border border-flag-line bg-flag-soft px-3 py-2 text-xs text-flag">
          {error}
        </p>
      )}

      {loaded && (
        <>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
            <dt className="text-ink-faint">만든 프로그램</dt>
            <dd className="text-ink-muted">{loaded.info.creatorTool || "-"}</dd>
            <dt className="text-ink-faint">만든 날짜</dt>
            <dd className="text-ink-muted">{formatDate(loaded.info.createDate)}</dd>
            <dt className="text-ink-faint">수정 날짜</dt>
            <dd className="text-ink-muted">{formatDate(loaded.info.modifyDate)}</dd>
            <dt className="text-ink-faint">형식</dt>
            <dd className="text-ink-muted">{loaded.info.format || "-"}</dd>
          </dl>

          <label className="flex flex-col gap-1 text-xs font-medium text-ink">
            제목
            <input value={title} onChange={(e) => setTitle(e.target.value)} className={input} placeholder="예: POTENZA 멸균지 라벨" />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-ink">
            작성자 <span className="font-normal text-ink-faint">여러 명이면 쉼표(,)로 구분</span>
            <input value={creators} onChange={(e) => setCreators(e.target.value)} className={input} placeholder="예: 홍길동, 디자인팀" />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-ink">
            설명
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className={input} />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-ink">
            키워드 <span className="font-normal text-ink-faint">쉼표(,)로 구분</span>
            <input value={keywords} onChange={(e) => setKeywords(e.target.value)} className={input} placeholder="예: 라벨, 국내, R02" />
          </label>

          {preview && "error" in preview && <p className="text-xs text-flag">{preview.error}</p>}
          {preview && !("error" in preview) && (
            <p className={`text-[11px] ${preview.left < 0 ? "font-medium text-flag" : "text-ink-faint"}`}>
              {preview.left < 0
                ? `파일 정보 칸이 ${(-preview.left).toLocaleString()}바이트 모자랍니다. 내용을 줄여 주세요.`
                : `남은 여유 공간 ${preview.left.toLocaleString()}바이트 (한글 한 글자 = 3바이트)`}
              {loaded.packetCount > 1 && ` · 파일 안의 정보 묶음 ${loaded.packetCount}개 중 문서 정보만 고칩니다.`}
              {!loaded.packet.writable && " · 이 파일 정보는 읽기 전용으로 표시돼 있습니다."}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={download}
              disabled={!changed || !preview || "error" in preview || preview.left < 0}
              className="h-9 rounded bg-brand-700 px-4 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50"
            >
              수정한 파일 받기
            </button>
            <button
              type="button"
              onClick={reset}
              disabled={!changed}
              className="h-9 rounded border border-line-strong px-3 text-xs text-ink-muted hover:bg-white disabled:opacity-50"
            >
              원래대로
            </button>
            <button type="button" onClick={() => setShowXml(!showXml)} className="text-xs text-ink-muted underline hover:text-ink">
              {showXml ? "XML 숨기기" : "XML 보기"}
            </button>
          </div>

          {saved && (
            <p className="rounded border border-pass-line bg-pass-soft px-3 py-2 text-xs text-pass">
              <b>{saved}</b> 파일을 내려받았습니다. 원본은 그대로 두었으니, 확인한 뒤 원본과 바꿔 쓰세요.
            </p>
          )}

          {showXml && preview && !("error" in preview) && (
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all rounded border border-line bg-white p-3 text-[11px] leading-relaxed text-ink-muted">
              {preview.xml.replace(/(<xmpGImg:image>)[\s\S]*?(<\/xmpGImg:image>)/g, "$1(미리보기 이미지 생략)$2")}
            </pre>
          )}
        </>
      )}
    </section>
  );
}
