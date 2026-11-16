/**
 * Reads and rewrites the XMP metadata packet (XML: title, author, description,
 * keywords…) inside an .ai/.pdf file, in the browser.
 *
 * The packet is replaced in place with exactly the same byte length, using the
 * whitespace padding XMP reserves for this. Byte offsets elsewhere in the file
 * (the PDF cross-reference table) therefore stay valid. The artwork is untouched.
 */

const NS = {
  rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
  dc: "http://purl.org/dc/elements/1.1/",
  xmp: "http://ns.adobe.com/xap/1.0/",
  xml: "http://www.w3.org/XML/1998/namespace",
};

export type XmpPacket = {
  /** Byte offset where <x:xmpmeta starts. */
  metaStart: number;
  /** Byte offset where <?xpacket end starts (meta + padding end here). */
  padEnd: number;
  /** The x:xmpmeta element as text. */
  xml: string;
  writable: boolean;
};

export type XmpFields = {
  title: string;
  creators: string[];
  description: string;
  keywords: string[];
};

export type XmpInfo = {
  creatorTool: string;
  createDate: string;
  modifyDate: string;
  format: string;
};

const enc = new TextEncoder();
const dec = new TextDecoder("utf-8");

function indexOfBytes(hay: Uint8Array, needle: Uint8Array, from = 0): number {
  const first = needle[0];
  const last = hay.length - needle.length;
  outer: for (let i = hay.indexOf(first, from); i !== -1 && i <= last; i = hay.indexOf(first, i + 1)) {
    for (let j = 1; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

const BEGIN = enc.encode("<?xpacket begin");
const META = enc.encode("<x:xmpmeta");
const END = enc.encode("<?xpacket end");

/** Every XMP packet found in the file, in file order. */
export function findPackets(bytes: Uint8Array): XmpPacket[] {
  const out: XmpPacket[] = [];
  let at = 0;
  while (true) {
    const begin = indexOfBytes(bytes, BEGIN, at);
    if (begin === -1) break;
    const padEnd = indexOfBytes(bytes, END, begin);
    if (padEnd === -1) break;
    const metaStart = indexOfBytes(bytes, META, begin);
    if (metaStart !== -1 && metaStart < padEnd) {
      const text = dec.decode(bytes.subarray(metaStart, padEnd));
      const close = text.lastIndexOf("</x:xmpmeta>");
      if (close !== -1) {
        const trailer = dec.decode(bytes.subarray(padEnd, Math.min(bytes.length, padEnd + 30)));
        out.push({
          metaStart,
          padEnd,
          xml: text.slice(0, close + "</x:xmpmeta>".length),
          writable: !/end=["']r["']/.test(trailer),
        });
      }
    }
    at = padEnd + END.length;
  }
  return out;
}

/** The document's own packet: the largest one (embedded images carry small ones). */
export function mainPacket(packets: XmpPacket[]): XmpPacket | null {
  return packets.reduce<XmpPacket | null>(
    (best, p) => (!best || p.padEnd - p.metaStart > best.padEnd - best.metaStart ? p : best),
    null,
  );
}

export function parseXmp(xml: string): Document {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) {
    throw new Error("파일 정보(XML)를 읽을 수 없습니다.");
  }
  return doc;
}

function descriptions(doc: Document) {
  return Array.from(doc.getElementsByTagNameNS(NS.rdf, "Description"));
}

function listValues(doc: Document, name: string): string[] {
  const el = doc.getElementsByTagNameNS(NS.dc, name)[0];
  if (!el) return [];
  return Array.from(el.getElementsByTagNameNS(NS.rdf, "li")).map((li) => li.textContent ?? "");
}

/** A simple property, written either as an attribute or as an element. */
function simple(doc: Document, ns: string, name: string): string {
  const el = doc.getElementsByTagNameNS(ns, name)[0];
  if (el) return el.textContent ?? "";
  for (const d of descriptions(doc)) {
    const v = d.getAttributeNS(ns, name);
    if (v) return v;
  }
  return "";
}

export function readFields(doc: Document): XmpFields {
  return {
    title: listValues(doc, "title")[0] ?? "",
    creators: listValues(doc, "creator"),
    description: listValues(doc, "description")[0] ?? "",
    keywords: listValues(doc, "subject"),
  };
}

export function readInfo(doc: Document): XmpInfo {
  return {
    creatorTool: simple(doc, NS.xmp, "CreatorTool"),
    createDate: simple(doc, NS.xmp, "CreateDate"),
    modifyDate: simple(doc, NS.xmp, "ModifyDate"),
    format: simple(doc, NS.dc, "format"),
  };
}

function setList(doc: Document, name: string, kind: "Alt" | "Seq" | "Bag", values: string[]) {
  const clean = values.map((v) => v.trim()).filter(Boolean);
  let el = doc.getElementsByTagNameNS(NS.dc, name)[0];
  if (clean.length === 0) {
    el?.parentNode?.removeChild(el);
    return;
  }
  if (!el) {
    const all = descriptions(doc);
    const host =
      all.find((d) => d.getElementsByTagNameNS(NS.dc, "*").length > 0 || d.getAttributeNS(NS.dc, "format")) ??
      all[0];
    if (!host) throw new Error("파일 정보에 rdf:Description이 없어 항목을 추가할 수 없습니다.");
    el = doc.createElementNS(NS.dc, `dc:${name}`);
    host.appendChild(el);
  }
  while (el.firstChild) el.removeChild(el.firstChild);
  const container = doc.createElementNS(NS.rdf, `rdf:${kind}`);
  for (const v of clean) {
    const li = doc.createElementNS(NS.rdf, "rdf:li");
    if (kind === "Alt") li.setAttributeNS(NS.xml, "xml:lang", "x-default");
    li.textContent = v;
    container.appendChild(li);
  }
  el.appendChild(container);
}

/** XMP date with the local offset, e.g. 2026-11-16T10:20:30+09:00. */
function xmpNow() {
  const d = new Date();
  const pad = (n: number) => String(Math.abs(n)).padStart(2, "0");
  const off = -d.getTimezoneOffset();
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${off >= 0 ? "+" : "-"}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`
  );
}

/** Returns the edited x:xmpmeta XML. */
export function writeFields(xml: string, fields: XmpFields): string {
  const doc = parseXmp(xml);
  setList(doc, "title", "Alt", [fields.title]);
  setList(doc, "creator", "Seq", fields.creators);
  setList(doc, "description", "Alt", [fields.description]);
  setList(doc, "subject", "Bag", fields.keywords);

  // Record that the metadata changed, where the file already tracks it.
  const now = xmpNow();
  const metaEl = doc.getElementsByTagNameNS(NS.xmp, "MetadataDate")[0];
  if (metaEl) metaEl.textContent = now;
  for (const d of descriptions(doc)) {
    if (d.hasAttributeNS(NS.xmp, "MetadataDate")) d.setAttributeNS(NS.xmp, "xmp:MetadataDate", now);
  }
  return new XMLSerializer().serializeToString(doc.documentElement);
}

export function spaceFor(packet: XmpPacket) {
  return packet.padEnd - packet.metaStart;
}

export function byteLength(text: string) {
  return enc.encode(text).length;
}

/** A copy of the file with the packet's XML replaced, same total size. */
export function replacePacket(bytes: Uint8Array, packet: XmpPacket, newXml: string): Uint8Array {
  const body = enc.encode(newXml);
  const room = spaceFor(packet);
  // Keep at least a newline before the padding, as XMP writers do.
  if (body.length + 1 > room) {
    throw new Error(
      `고친 내용이 파일 정보 칸보다 ${(body.length + 1 - room).toLocaleString()}바이트 깁니다. 설명이나 키워드를 줄여 주세요.`,
    );
  }
  const out = new Uint8Array(bytes);
  out.set(body, packet.metaStart);
  let i = packet.metaStart + body.length;
  out[i++] = 0x0a;
  // Padding: spaces, with a line break every 100 bytes like Adobe's writer.
  for (let col = 0; i < packet.padEnd; i++, col++) out[i] = col % 100 === 99 ? 0x0a : 0x20;
  return out;
}
