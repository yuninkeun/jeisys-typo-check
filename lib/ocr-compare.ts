// Finds likely typos by comparing OCR text across many label files — no AI.
// (Same rules as scripts/ocr-compare/compare.mjs, which is the batch version.)
//
// A word is suspicious when it appears in very few files while a word one
// letter away appears in many (e.g. "Jeieys" once vs "Jeisys" in 60 files).
// Production notes on the artboard (paper, foil, Pantone, dates, version tags)
// are left out, and differences that are just case, spacing, punctuation,
// Korean particles or typical OCR misreads are not reported as typos.

/** One OCR line, in the pixels of the rendered page. */
export type OcrLine = { t: string; x: number; y: number; w: number; h: number };
export type OcrDoc = { key: string; w: number; h: number; lines: OcrLine[] };

export type OcrFinding = {
  /** OcrDoc.key of the file. */
  key: string;
  line: string;
  /** Line box as 0–1 fractions of the page. */
  box: { x: number; y: number; w: number; h: number };
  /** Page height / width, to keep margins square. */
  ar: number;
  word: string;
  suggest: string;
  seenIn: number;
  suggestSeenIn: number;
  /** I/l, O/0, rn/m … — what OCR itself gets wrong. */
  ocrLike: boolean;
};

/** Production / ordering notes the designer leaves next to the artwork. */
const MEMO =
  /금박|박지|용지|지종|인쇄|코팅|라미|별색|팬톤|펜톤|pantone|후가공|엠보|원색|옵셋|오버프린트|레이어|도안|의뢰자|제작처|거래처|파일\s*번호|인쇄자|작성\s*날짜|샘플|발송|진행합니다|진행해|요청자|요청일자|디자인\s*담당|관리번호|적용\s*국가|칼선|재단|접착|전개도|제작\s*데이터|로얄|아이보리|화일라|마니라|\bver[._ ]|^\s*\d{2,4}\s*[.,]\s*\d{1,2}\s*[.,]\s*\d{1,2}/i;

const PARTICLES = new Set("은는이가을를에의도로와과서고며요다".split(""));

/** Company, address and brand names: one spelling everywhere, in any language. */
const NAMES = new Set(
  "jeisys medical gamasan geumcheon daeryung techno seoul korea potenza density intracel linearz linear ultracel cellec acgen intragen gasan".split(" "),
);

const norm = (s: string) => s.normalize("NFC").replace(/\s+/g, " ").trim();
/** Words: Hangul, Latin or digits; punctuation splits words. */
const words = (s: string) => norm(s).match(/[가-힣A-Za-z0-9]+/g) ?? [];
const key = (w: string) => w.toLowerCase();
/** Words the OCR glued together from different scripts (리a, 0묘, 전7) are noise. */
const mixed = (k: string) => /[가-힣]/.test(k) && /[a-z0-9]/.test(k);
/** Rotated or mirrored text reads as junk (「」乙田…); its "words" are noise. */
const junkLine = (s: string) =>
  (s.match(/[^\p{Script=Hangul}\p{Script=Latin}\d\s.,:;()[\]/%&'’"“”·•*+\-–~℃°®™×x]/gu) ?? []).length >= 2;
const compact = (s: string) => s.normalize("NFC").toLowerCase().replace(/\s+/g, "");

function editDistance(a: string, b: string) {
  const A = [...a], B = [...b];
  const d = Array.from({ length: A.length + 1 }, (_, i) => [i, ...Array<number>(B.length).fill(0)]);
  for (let j = 1; j <= B.length; j++) d[0][j] = j;
  for (let i = 1; i <= A.length; i++)
    for (let j = 1; j <= B.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (A[i - 1] === B[j - 1] ? 0 : 1));
  return d[A.length][B.length];
}

/** Differences the OCR itself typically makes: digits inside Hangul
 *  (전21수술 for 전기수술), I/l/1, O/0, rn/m … */
function ocrLike(w: string, v: string) {
  if (/[가-힣]/.test(v) && /\d/.test(w) && !/\d/.test(v)) return true;
  const fold = (s: string) =>
    s.replace(/[Iil1|]/g, "l").replace(/[O0o]/g, "o").replace(/rn/g, "m").replace(/[5S]/g, "s").replace(/[8B]/g, "b");
  return fold(w.toLowerCase()) === fold(v.toLowerCase());
}

/** Only the last syllable differs and both are particles (제품은/제품을). */
function particleOnly(w: string, v: string) {
  const A = [...w], B = [...v];
  if (A.length !== B.length || A.length < 2) return false;
  if (A.slice(0, -1).join("") !== B.slice(0, -1).join("")) return false;
  return PARTICLES.has(A.at(-1)!) && PARTICLES.has(B.at(-1)!);
}

/** Lines close together (same paragraph) form a block; a block with any
 *  production-note line is left out as a whole. */
function blocks(lines: OcrLine[]) {
  const parent = lines.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < lines.length; i++)
    for (let j = i + 1; j < lines.length; j++) {
      const a = lines[i], b = lines[j];
      const lh = Math.max(a.h, b.h, 1);
      const vgap = Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h));
      const xover = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const sameSize = Math.min(a.h, b.h) / lh > 0.6;
      if (vgap < lh * 1.2 && xover > -lh && sameSize) parent[find(i)] = find(j);
    }
  const groups = new Map<number, OcrLine[]>();
  lines.forEach((l, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), l]));
  return [...groups.values()];
}

/** Per line: is it in a production-note block? (Stored with the line in the DB.) */
export function memoFlags(lines: OcrLine[]): boolean[] {
  const memo = new Set<OcrLine>();
  for (const b of blocks(lines)) if (b.some((l) => MEMO.test(norm(l.t)))) b.forEach((l) => memo.add(l));
  return lines.map((l) => memo.has(l));
}

/** The label's own text in one string, for "is this phrase anywhere else?" checks. */
export function compactText(lines: OcrLine[], memo: boolean[]) {
  return compact(lines.filter((_, i) => !memo[i]).map((l) => l.t).join("\n"));
}

/** Fewer files than this and "most files spell it X" means little. */
export const OCR_MIN_FILES = 8;

/** `only`: report findings for that one file (OcrDoc.key) — the others are
 *  just the reference, e.g. a new label checked against the whole DB. */
export function findOcrTypos(input: OcrDoc[], opts: { only?: string } = {}): OcrFinding[] {
  const docs = input.map((d) => ({
    ...d,
    lines: blocks(d.lines)
      .filter((b) => !b.some((l) => MEMO.test(norm(l.t))))
      .flat(),
  }));

  // In how many files each word appears (case-insensitive).
  const df = new Map<string, number>();
  const variants = new Map<string, string>();
  for (const d of docs) {
    const seen = new Set<string>();
    for (const l of d.lines)
      for (const w of words(l.t)) {
        seen.add(key(w));
        if (!variants.has(key(w))) variants.set(key(w), w);
      }
    for (const k of seen) df.set(k, (df.get(k) ?? 0) + 1);
  }
  const byLen = new Map<number, string[]>();
  for (const [k, n] of df)
    if (n >= 4) {
      const L = [...k].length;
      byLen.set(L, [...(byLen.get(L) ?? []), k]);
    }

  function nearestCommon(w: string) {
    const k = key(w);
    const n = [...k].length;
    const hangul = /[가-힣]/.test(k);
    if (/\d/.test(k) || mixed(k)) return null; // numbers: versions, sizes, dates
    // Two-syllable Korean words are too often other real words (제조/참조).
    if (hangul ? n < 3 : n < 5) return null;
    const maxEd = hangul ? 1 : n >= 8 ? 2 : 1;
    let best: string | null = null;
    for (let L = n - maxEd; L <= n + maxEd; L++)
      for (const c of byLen.get(L) ?? []) {
        if (c === k) continue;
        if (editDistance(k, c) > maxEd) continue;
        if ((df.get(c) ?? 0) < Math.max(4, 3 * (df.get(k) ?? 0))) continue;
        if (!best || df.get(c)! > df.get(best)!) best = c;
      }
    return best;
  }

  // The same sentence elsewhere: a word is only a typo if the words around it
  // appear in other files with the common spelling (and rarely with this one).
  // That drops different-but-valid words (넣는다/않는다) and other languages.
  const docText = docs.map((d) => compact(d.lines.map((l) => l.t).join("\n")));
  function context(line: string, w: string, v: string, doc: number) {
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

  const findings: OcrFinding[] = [];
  docs.forEach((d, di) => {
    if (opts.only && d.key !== opts.only) return;
    const seen = new Set<string>();
    for (const l of d.lines) {
      if (junkLine(l.t)) continue;
      for (const w of words(l.t)) {
        const k = key(w);
        if ((df.get(k) ?? 0) > 2) continue;
        const c = nearestCommon(w);
        if (!c) continue;
        const v = variants.get(c)!;
        if (particleOnly(w, v)) continue;
        // One word inside the other: a particle or ending (재사용을/재사용), or a
        // letter glued on from the next word (FTIP/Tip) — not a misspelling.
        if (c.includes(k) || k.includes(c) || mixed(c)) continue;
        const ctx = context(l.t, w, v, di);
        // A typo copied into a second file still counts, as long as the common
        // spelling clearly wins (대륭테크노타워 in 2 files vs 타운 in 36).
        const outvoted = ctx.support >= 2 && ctx.support >= 3 * ctx.contra;
        if (!outvoted && !NAMES.has(c)) continue;
        // One row per file+word (the same word can show twice on one label).
        if (seen.has(`${k}|${c}`)) continue;
        seen.add(`${k}|${c}`);
        findings.push({
          key: d.key,
          line: norm(l.t),
          box: { x: l.x / d.w, y: l.y / d.h, w: l.w / d.w, h: l.h / d.h },
          ar: d.h / d.w,
          word: w,
          suggest: v,
          seenIn: df.get(k) ?? 0,
          suggestSeenIn: df.get(c)!,
          ocrLike: ocrLike(w, v),
        });
      }
    }
  });
  return findings;
}

export type OcrVerdict = "typo" | "unclear" | "misread";

/** After a zoomed second read: the same word again → a real typo; the common
 *  spelling → the first read was wrong; anything else → a person has to look. */
export function ocrVerdict(f: OcrFinding, second: string | null): OcrVerdict {
  if (f.ocrLike) return "misread";
  const t = (second ?? "").toLowerCase();
  if (t.includes(f.word.toLowerCase())) return "typo";
  if (t.includes(f.suggest.toLowerCase())) return "misread";
  return "unclear";
}

/** The spot the second read looks at: the line with a margin, as page fractions. */
export function rereadBox(f: OcrFinding, pad = 0.6) {
  const py = f.box.h * pad, px = py * f.ar;
  const x = Math.max(0, f.box.x - px), y = Math.max(0, f.box.y - py);
  return { x, y, w: Math.min(1 - x, f.box.w + 2 * px), h: Math.min(1 - y, f.box.h + 2 * py), lh: f.box.h };
}
