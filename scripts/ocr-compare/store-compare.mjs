// Compares the labels the 연결 도우미 saved on this PC (%APPDATA%\JeisysTypoBridge\ocr),
// one category at a time, with the same rules as the web app (lib/ocr-compare.ts).
// Output is in the format reread.ps1 / crop.ps1 / store-report.mjs read.
//
// usage: node --experimental-strip-types store-compare.mjs <root> <out.json>
//   root: the folder that was opened in the web app (file paths are relative to it)
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [root, out] = process.argv.slice(2);
const here = new URL(".", import.meta.url);
const { findOcrTypos } = await import(new URL("../../lib/ocr-compare.ts", here).href);

const dir = join(process.env.APPDATA, "JeisysTypoBridge", "ocr");
const docs = readdirSync(dir)
  .filter((f) => /^[0-9a-f]{64}\.json$/.test(f))
  .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")));

const findings = [];
const byCat = {};
for (const cat of ["박스", "스티커", "멸균지"]) {
  const list = docs.filter((d) => d.category === cat);
  byCat[cat] = list.length;
  const px = list.map((d) => ({
    key: d.hash,
    w: d.w,
    h: d.h,
    lines: d.lines.map((l) => ({ t: l.t, x: l.bbox.x * d.w, y: l.bbox.y * d.h, w: l.bbox.w * d.w, h: l.bbox.h * d.h })),
  }));
  const meta = new Map(list.map((d) => [d.hash, d]));
  for (const f of findOcrTypos(px)) {
    const d = meta.get(f.key);
    findings.push({
      category: cat,
      path: join(root, ...d.filePath.split("/")),
      file: d.filePath,
      line: f.line,
      box: { x: f.box.x * d.w, y: f.box.y * d.h, w: f.box.w * d.w, h: f.box.h * d.h, pw: d.w, ph: d.h },
      word: f.word,
      suggest: f.suggest,
      seenIn: f.seenIn,
      suggestSeenIn: f.suggestSeenIn,
      ocrLike: f.ocrLike,
    });
  }
}

writeFileSync(
  out,
  JSON.stringify(
    {
      docs: docs.map((d) => ({
        hash: d.hash,
        category: d.category,
        file: d.filePath,
        lines: d.lines.length,
        memoLines: d.lines.filter((l) => l.memo).length,
      })),
      findings,
    },
    null,
    1,
  ),
);
console.log(`파일 ${docs.length}개 (${Object.entries(byCat).map(([k, v]) => `${k} ${v}`).join(" · ")}) · 의심 ${findings.length}건 (OCR 오독 같음 ${findings.filter((f) => f.ocrLike).length}건)`);
