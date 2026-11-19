// Finds likely typos by comparing OCR text across many label files — no AI.
//
// A word is suspicious when it appears in very few files while a word one
// letter away appears in many (e.g. "비침샵" once vs "비침습" in 20 files).
// Production notes on the artboard (paper, foil, Pantone, dates, version tags)
// are left out, and differences that are just case, spacing, punctuation,
// Korean particles or typical OCR misreads are not reported as typos.
//
// usage: node compare.mjs <out.json> <ocr-1.jsonl> [<ocr-2.jsonl> …]
import { readFileSync, writeFileSync } from "node:fs";

const [out, ...inputs] = process.argv.slice(2);

/** Production / ordering notes the designer leaves next to the artwork. */
const MEMO =
  /금박|박지|용지|지종|인쇄|코팅|라미|별색|팬톤|펜톤|pantone|후가공|엠보|원색|옵셋|오버프린트|레이어|도안|의뢰자|제작처|거래처|파일\s*번호|인쇄자|작성\s*날짜|샘플|발송|진행합니다|진행해|요청자|요청일자|디자인\s*담당|관리번호|적용\s*국가|칼선|재단|접착|전개도|제작\s*데이터|로얄|아이보리|화일라|마니라|\bver[._ ]|^\s*\d{2,4}\s*[.,]\s*\d{1,2}\s*[.,]\s*\d{1,2}/i;

const PARTICLES = new Set("은는이가을를에의도로와과서고며요다".split(""));

function readOcr(path) {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    // Older ocr.ps1 output kept PowerShell metadata around the path.
    .map((r) => ({ ...r, path: typeof r.path === "string" ? r.path : r.path?.value }));
}

/** Lines close together (same paragraph) form a block; a block with any
 *  production-note line is left out as a whole. */
function blocks(lines) {
  const parent = lines.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < lines.length; i++)
    for (let j = i + 1; j < lines.length; j++) {
      const a = lines[i], b = lines[j];
      const lh = Math.max(a.h, b.h, 1);
      const vgap = Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h));
      const xover = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const sameSize = Math.min(a.h, b.h) / lh > 0.6;
      if (vgap < lh * 1.2 && xover > -lh && sameSize) parent[find(i)] = find(j);
    }
  const groups = new Map();
  lines.forEach((l, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), l]));
  return [...groups.values()];
}

const norm = (s) => s.normalize("NFC").replace(/\s+/g, " ").trim();
/** Words: Hangul, Latin or digits; punctuation splits words. */
const words = (s) => norm(s).match(/[가-힣A-Za-z0-9]+/g) ?? [];
const key = (w) => w.toLowerCase();

function editDistance(a, b) {
  const A = [...a], B = [...b];
  const d = Array.from({ length: A.length + 1 }, (_, i) => [i, ...Array(B.length).fill(0)]);
  for (let j = 1; j <= B.length; j++) d[0][j] = j;
  for (let i = 1; i <= A.length; i++)
    for (let j = 1; j <= B.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (A[i - 1] === B[j - 1] ? 0 : 1));
  return d[A.length][B.length];
}

/** Differences the OCR itself typically makes: digits inside Hangul
 *  (전21수술 for 전기수술), I/l/1, O/0, rn/m … */
function ocrLike(w, v) {
  if (/[가-힣]/.test(v) && /\d/.test(w) && !/\d/.test(v)) return true;
  const fold = (s) => s.replace(/[Iil1|]/g, "l").replace(/[O0o]/g, "o").replace(/rn/g, "m").replace(/[5S]/g, "s").replace(/[8B]/g, "b");
  return fold(w.toLowerCase()) === fold(v.toLowerCase());
}

/** Only the last syllable differs and both are particles (제품은/제품을). */
function particleOnly(w, v) {
  const A = [...w], B = [...v];
  if (A.length !== B.length || A.length < 2) return false;
  if (A.slice(0, -1).join("") !== B.slice(0, -1).join("")) return false;
  return PARTICLES.has(A.at(-1)) && PARTICLES.has(B.at(-1));
}

const docs = [];
for (const input of inputs)
  for (const row of readOcr(input)) {
    if (row.error || !row.lines) {
      docs.push({ path: row.path, error: row.error ?? "글자 없음", lines: [] });
      continue;
    }
    const kept = [], memo = [];
    for (const b of blocks(row.lines)) (b.some((l) => MEMO.test(norm(l.t))) ? memo : kept).push(...b);
    docs.push({ path: row.path, w: row.w, h: row.h, lines: kept, memoLines: memo.length });
  }

// In how many files each word appears (case-insensitive).
const df = new Map();
const variants = new Map(); // key -> most common spelling
for (const d of docs) {
  const seen = new Set();
  for (const l of d.lines) for (const w of words(l.t)) seen.add(key(w));
  for (const k of seen) df.set(k, (df.get(k) ?? 0) + 1);
  for (const l of d.lines) for (const w of words(l.t)) variants.set(key(w), variants.get(key(w)) ?? w);
}
const common = [...df.entries()].filter(([, n]) => n >= 4).map(([k]) => k);
const byLen = new Map();
for (const k of common) {
  const n = [...k].length;
  byLen.set(n, [...(byLen.get(n) ?? []), k]);
}

/** Words the OCR glued together from different scripts (리a, 0묘, 전7) are noise. */
const mixed = (k) => /[가-힣]/.test(k) && /[a-z0-9]/.test(k);

function nearestCommon(w) {
  const k = key(w);
  const n = [...k].length;
  const hangul = /[가-힣]/.test(k);
  if (/\d/.test(k) || mixed(k)) return null; // numbers: versions, sizes, dates
  // Two-syllable Korean words are too often other real words (제조/참조).
  if (hangul ? n < 3 : n < 5) return null;
  const maxEd = hangul ? 1 : n >= 8 ? 2 : 1;
  let best = null;
  for (let L = n - maxEd; L <= n + maxEd; L++)
    for (const c of byLen.get(L) ?? []) {
      if (c === k) continue;
      const ed = editDistance(k, c);
      if (ed > maxEd) continue;
      if ((df.get(c) ?? 0) < Math.max(4, 3 * (df.get(k) ?? 0))) continue;
      if (!best || df.get(c) > df.get(best)) best = c;
    }
  return best;
}

// The same sentence elsewhere: a word is only a typo if the words around it
// appear in other files with the common spelling (and never with this one).
// That drops different-but-valid words (넣는다/않는다) and other languages.
const compact = (s) => s.normalize("NFC").toLowerCase().replace(/\s+/g, "");
const docText = docs.map((d) => compact(d.lines.map((l) => l.t).join("\n")));
function context(line, w, v, doc) {
  const L = compact(line), wk = compact(w), vk = compact(v);
  const i = L.indexOf(wk);
  if (i < 0) return { support: 0, contra: 0 };
  for (const n of [6, 3]) {
    const before = L.slice(Math.max(0, i - n), i), after = L.slice(i + wk.length, i + wk.length + n);
    if (before.length + after.length < 3) continue;
    let support = 0, contra = 0;
    docText.forEach((t, k) => {
      if (k === doc) return;
      if (t.includes(before + vk + after)) support++;
      if (t.includes(before + wk + after)) contra++;
    });
    if (support || contra || n === 3) return { support, contra };
  }
  return { support: 0, contra: 0 };
}
/** Company, address and brand names: one spelling everywhere, in any language. */
const NAMES = new Set(
  "jeisys medical gamasan geumcheon daeryung techno seoul korea potenza density intracel linearz linear ultracel cellec acgen intragen gasan".split(" "),
);
const properNoun = (c) => NAMES.has(c);
/** Rotated or mirrored text reads as junk (「」乙田…); its "words" are noise. */
const junkLine = (s) => (s.match(/[^\p{Script=Hangul}\p{Script=Latin}\d\s.,:;()\[\]/%&'’"“”·•*+\-–~℃°®™×x]/gu) ?? []).length >= 2;

const findings = [];
let weak = 0;
for (const [di, d] of docs.entries()) {
  for (const l of d.lines) {
    for (const w of words(l.t)) {
      const k = key(w);
      if ((df.get(k) ?? 0) > 2) continue;
      const c = nearestCommon(w);
      if (!c) continue;
      const v = variants.get(c);
      if (particleOnly(w, v)) continue;
      // One word inside the other: a particle or ending (재사용을/재사용, target/targeted),
      // or a letter glued on from the next word (FTIP/Tip) — not a misspelling.
      if (c.includes(k) || k.includes(c)) continue;
      if (mixed(c)) continue;
      if (junkLine(l.t)) continue;
      const ctx = context(l.t, w, v, di);
      // A typo copied into a second file still counts, as long as the common
      // spelling clearly wins (대륭테크노타워 in 2 files vs 타운 in 36).
      const outvoted = ctx.support >= 2 && ctx.support >= 3 * ctx.contra;
      if (!outvoted && !properNoun(c)) {
        weak++;
        continue;
      }
      findings.push({
        support: ctx.support,
        path: d.path,
        line: norm(l.t),
        box: { x: l.x, y: l.y, w: l.w, h: l.h, pw: d.w, ph: d.h },
        word: w,
        suggest: v,
        seenIn: df.get(k) ?? 0,
        suggestSeenIn: df.get(c),
        ocrLike: ocrLike(w, v),
      });
    }
  }
}

writeFileSync(out, JSON.stringify({ docs: docs.map((d) => ({ path: d.path, lines: d.lines.length, memoLines: d.memoLines ?? 0, error: d.error })), findings }, null, 1));
const files = new Set(findings.filter((f) => !f.ocrLike).map((f) => f.path));
console.log(`문맥이 안 맞아 뺀 것 ${weak}건`);
console.log(`파일 ${docs.length}개 · 의심 ${findings.length}건 (OCR 오독 같음 ${findings.filter((f) => f.ocrLike).length}건) · 의심 있는 파일 ${files.size}개`);
