// Merges compare.mjs findings with reread.ps1's second look and writes a CSV
// (opens in Excel) and an HTML report.
//
// usage: node report.mjs <title> <root> <compare.json> <reread-out.json> <out-base> [crops-dir]
//   root: folder the paths are shown relative to (e.g. "D:\라벨 관련자료\구매팀 자료\…")
//   crops-dir: <finding index>.png from crop.ps1, shown next to each row
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const [title, root, cmpPath, rereadPath, outBase, cropsDir] = process.argv.slice(2);
const crop = (i) => {
  const p = cropsDir && `${cropsDir}/${i}.png`;
  return p && existsSync(p) ? `<img alt="원본 그림" src="data:image/png;base64,${readFileSync(p).toString("base64")}">` : "";
};
const cmp = JSON.parse(readFileSync(cmpPath, "utf8"));
const reread = new Map(JSON.parse(readFileSync(rereadPath, "utf8").replace(/^\uFEFF/, "")).map((r) => [r.id, r.text ?? ""]));

const rel = (p) => (p.startsWith(root) ? p.slice(root.length).replace(/^[\\/]/, "") : p);
const VERDICT = {
  typo: "오타 의심 — 두 번 읽어도 같음",
  misread: "OCR 오독 — 확대해 읽으니 정상",
  unclear: "판단 불가 — 확대해도 다르게 읽힘",
};

const rows = cmp.findings.map((f, i) => {
  const t = (reread.get(i) ?? "").toLowerCase();
  // I/l, O/0 … differences are what OCR gets wrong, even twice in a row.
  const verdict = f.ocrLike ? "misread" : t.includes(f.word.toLowerCase()) ? "typo" : t.includes(f.suggest.toLowerCase()) ? "misread" : "unclear";
  return { ...f, id: i, file: rel(f.path), verdict, second: reread.get(i) ?? "" };
});

// One row per file+word (the same word can show twice on one label).
const seen = new Set();
const uniq = rows.filter((r) => {
  const k = `${r.file}|${r.word}|${r.suggest}`;
  return seen.has(k) ? false : seen.add(k);
});

const order = { typo: 0, unclear: 1, misread: 2 };
uniq.sort((a, b) => order[a.verdict] - order[b.verdict] || a.file.localeCompare(b.file, "ko"));

const csvCell = (s) => `"${String(s).replace(/"/g, '""')}"`;
const csv = [
  ["판정", "파일", "읽은 글자", "다른 파일들의 표기", "이 표기가 나온 파일 수", "다른 표기가 나온 파일 수", "줄 전체(1차)", "확대해 다시 읽은 줄"],
  ...uniq.map((r) => [VERDICT[r.verdict], r.file, r.word, r.suggest, r.seenIn, r.suggestSeenIn, r.line, r.second]),
]
  .map((r) => r.map(csvCell).join(","))
  .join("\r\n");
writeFileSync(`${outBase}.csv`, "\uFEFF" + csv);

const docs = cmp.docs;
const typoFiles = new Set(uniq.filter((r) => r.verdict === "typo").map((r) => r.file));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const count = (v) => uniq.filter((r) => r.verdict === v).length;
const section = (v) => {
  const list = uniq.filter((r) => r.verdict === v);
  if (!list.length) return "";
  return `<h2>${esc(VERDICT[v])} <span class="n">${list.length}</span></h2>
<table><thead><tr><th>파일</th><th>읽은 글자</th><th>다른 파일들의 표기</th><th>줄</th></tr></thead><tbody>
${list
  .map(
    (r) => `<tr><td class="f">${esc(r.file)}</td><td class="w">${esc(r.word)} <small>${r.seenIn}개 파일</small></td><td class="s">${esc(r.suggest)} <small>${r.suggestSeenIn}개 파일</small></td><td class="l">${esc(r.line)}${
      r.second && r.second !== r.line ? `<div class="again">다시 읽음: ${esc(r.second)}</div>` : ""
    }${v === "misread" ? "" : crop(r.id)}</td></tr>`,
  )
  .join("\n")}
</tbody></table>`;
};

const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
:root{--bg:#f6f7f9;--panel:#fff;--line:#e3e6eb;--txt:#1d2433;--mut:#667085;--acc:#1a3591;--bad:#c62828;--bad-bg:#fdecea;--warn:#b26a00;--warn-bg:#fff4e0;--ok:#2e7d32}
body{margin:0;background:var(--bg);color:var(--txt);font:13px/1.5 "Pretendard","Segoe UI","Malgun Gothic",sans-serif;word-break:keep-all}
main{max-width:1200px;margin:0 auto;padding:24px 16px}
h1{font-size:22px;margin:0 0 4px}h2{font-size:15px;margin:28px 0 8px}.n{color:var(--mut);font-weight:400}
.sub{color:var(--mut);margin:0 0 16px}
.kpi{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px}
.kpi div{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:10px 12px}.kpi b{display:block;font-size:20px}
.basis{background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:8px 12px;color:var(--mut);font-size:12px;margin:12px 0}
table{width:100%;border-collapse:collapse;background:var(--panel);border:1px solid var(--line);border-radius:8px;overflow:hidden}
th,td{text-align:left;padding:6px 8px;border-top:1px solid var(--line);vertical-align:top}th{background:#eef1f5;font-weight:600;border-top:0}
td.f{max-width:320px;overflow-wrap:anywhere;color:var(--mut);font-size:12px}td.w{color:var(--bad);font-weight:600;white-space:nowrap}td.s{color:var(--ok);white-space:nowrap}
small{color:var(--mut);font-weight:400}td.l img{display:block;max-width:100%;max-height:120px;margin-top:6px;border:1px solid var(--line);border-radius:6px}.again{color:var(--mut);font-size:12px;margin-top:2px}
.concl{border-left:3px solid var(--acc);background:#eef2fb;padding:10px 14px;border-radius:0 6px 6px 0;margin-top:24px}
</style></head><body><main>
<h1>${esc(title)}</h1>
<p class="sub">AI·크레딧 없이 이 PC에서 읽고(Windows OCR) 파일끼리 비교한 결과 · ${new Date().toLocaleString("ko-KR")}</p>
<div class="kpi">
<div><b>${docs.length}</b>검사한 파일(중복 제외)</div>
<div><b>${typoFiles.size}</b>오타 의심이 있는 파일</div>
<div><b>${count("typo")}</b>오타 의심</div>
<div><b>${count("unclear")}</b>판단 불가</div>
<div><b>${count("misread")}</b>OCR 오독으로 걸러냄</div>
</div>
<div class="basis"><b>기준</b> : 파일 글자를 그림으로 읽음(Windows 한국어 OCR) · 다른 파일들에 많이 나온 표기와 한 글자 다르면 의심 · 작업 메모(용지·금박·팬톤·날짜·버전)·조사·대소문자·띄어쓰기 차이는 제외 · 의심 자리는 확대해 한 번 더 읽어 OCR 오독을 거름 · <b>[기준 확인 필요]</b> 최종 판단은 담당자</div>
${section("typo")}
${section("unclear")}
${section("misread")}
<p class="concl"><b>결국 뭐 하자:</b> «오타 의심» ${count("typo")}건부터 원본을 열어 확인하고, 진짜 오타면 고친다. «판단 불가»는 그림이 흐리거나 글꼴이 특이한 곳이라 눈으로 본다.</p>
</main></body></html>`;
writeFileSync(`${outBase}.html`, html);
console.log(`오타 의심 ${count("typo")} · 판단 불가 ${count("unclear")} · 오독 ${count("misread")} · 파일 ${typoFiles.size}개 → ${outBase}.html / .csv`);
