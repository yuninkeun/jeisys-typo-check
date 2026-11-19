// Report on the labels saved on this PC: what was read per category, and the
// suspected typos (after the zoomed second read), with a cropped image each.
//
// usage: node store-report.mjs <store-compare.json> <reread-out.json> <crops-dir> <out-base> [root]
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const [cmpPath, rereadPath, cropsDir, outBase, root = ""] = process.argv.slice(2);
const cmp = JSON.parse(readFileSync(cmpPath, "utf8"));
const reread = new Map(JSON.parse(readFileSync(rereadPath, "utf8").replace(/^﻿/, "")).map((r) => [r.id, r.text ?? ""]));
const CATS = ["박스", "스티커", "멸균지"];

const rows = cmp.findings.map((f, id) => {
  const second = reread.get(id) ?? "";
  const t = second.toLowerCase();
  const verdict = f.ocrLike ? "misread" : t.includes(f.word.toLowerCase()) ? "typo" : t.includes(f.suggest.toLowerCase()) ? "misread" : "unclear";
  return { ...f, id, second, verdict };
});
const VERDICT = { typo: "오타 의심", unclear: "판단 불가", misread: "OCR 오독" };
const HINT = { typo: "확대해 다시 읽어도 같은 글자", unclear: "확대하니 다르게 읽힘 — 그림을 보고 판단", misread: "확대해 읽으니 정상이거나 I/l·O/0 같은 OCR 혼동" };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const num = (n) => n.toLocaleString("ko-KR");
const crop = (id) => {
  const p = `${cropsDir}/${id}.png`;
  return existsSync(p) ? `<img alt="원본에서 잘라 낸 그림" src="data:image/png;base64,${readFileSync(p).toString("base64")}">` : "";
};

// What was read, per category.
const read = CATS.map((c) => {
  const d = cmp.docs.filter((x) => x.category === c);
  const lines = d.reduce((a, x) => a + x.lines, 0);
  const memo = d.reduce((a, x) => a + x.memoLines, 0);
  const r = rows.filter((x) => x.category === c);
  return {
    c,
    files: d.length,
    lines,
    avg: d.length ? Math.round(lines / d.length) : 0,
    memo,
    empty: d.filter((x) => x.lines === 0).length,
    typo: r.filter((x) => x.verdict === "typo").length,
    unclear: r.filter((x) => x.verdict === "unclear").length,
    misread: r.filter((x) => x.verdict === "misread").length,
    typoFiles: new Set(r.filter((x) => x.verdict === "typo").map((x) => x.file)).size,
  };
});
const sum = (k) => read.reduce((a, r) => a + r[k], 0);

// CSV: suspects, and the list of files read.
const cell = (s) => `"${String(s).replace(/"/g, '""')}"`;
const csv = (head, body) => "﻿" + [head, ...body].map((r) => r.map(cell).join(",")).join("\r\n");
writeFileSync(
  `${outBase}_의심.csv`,
  csv(
    ["분류", "판정", "파일", "읽은 글자", "다른 파일들의 표기", "이 표기가 나온 파일 수", "다른 표기가 나온 파일 수", "줄(1차)", "확대해 다시 읽은 줄"],
    rows
      .sort((a, b) => CATS.indexOf(a.category) - CATS.indexOf(b.category) || "tum".indexOf(a.verdict[0]) - "tum".indexOf(b.verdict[0]))
      .map((r) => [r.category, VERDICT[r.verdict], r.file, r.word, r.suggest, r.seenIn, r.suggestSeenIn, r.line, r.second]),
  ),
);
writeFileSync(
  `${outBase}_읽은파일.csv`,
  csv(
    ["분류", "파일", "읽은 줄 수", "작업 메모 줄 수", "내용 해시"],
    [...cmp.docs].sort((a, b) => CATS.indexOf(a.category) - CATS.indexOf(b.category) || a.file.localeCompare(b.file, "ko")).map((d) => [d.category, d.file, d.lines, d.memoLines, d.hash]),
  ),
);

const table = (list, withCrop) => `<table><thead><tr><th>파일</th><th>읽은 글자</th><th>다른 파일들의 표기</th><th>줄</th></tr></thead><tbody>
${list
  .map(
    (r) => `<tr><td class="f">${esc(r.file)}</td><td class="w">${esc(r.word)} <small>${r.seenIn}개</small></td><td class="s">${esc(r.suggest)} <small>${r.suggestSeenIn}개</small></td><td class="l">${esc(r.line)}${
      r.second && r.second !== r.line ? `<div class="again">다시 읽음: ${esc(r.second)}</div>` : ""
    }${withCrop ? crop(r.id) : ""}</td></tr>`,
  )
  .join("\n")}
</tbody></table>`;

const section = (c) => {
  const r = rows.filter((x) => x.category === c);
  const part = (v) => {
    const list = r.filter((x) => x.verdict === v);
    if (!list.length) return "";
    const body = table(list, v !== "misread");
    return v === "misread"
      ? `<details><summary>${VERDICT[v]} ${list.length}건 <span class="n">· ${HINT[v]}</span></summary>${body}</details>`
      : `<h3 class="${v}">${VERDICT[v]} ${list.length}건 <span class="n">· ${HINT[v]}</span></h3>${body}`;
  };
  const s = read.find((x) => x.c === c);
  return `<section><h2>${c} <span class="n">${num(s.files)}개 파일 · 오타 의심 ${s.typo} · 판단 불가 ${s.unclear}</span></h2>
${part("typo")}${part("unclear")}${part("misread")}
${r.filter((x) => x.verdict !== "misread").length === 0 ? `<p class="ok">다른 파일들과 다르게 쓴 글자를 찾지 못했습니다.</p>` : ""}</section>`;
};

const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>OCR 저장분 보고</title>
<style>
:root{--bg:#f6f7f9;--panel:#fff;--line:#e3e6eb;--txt:#1d2433;--mut:#667085;--acc:#1a3591;--bad:#c62828;--warn:#b26a00;--ok:#2e7d32}
body{margin:0;background:var(--bg);color:var(--txt);font:13px/1.5 "Pretendard","Segoe UI","Malgun Gothic",sans-serif;word-break:keep-all}
main{max-width:1200px;margin:0 auto;padding:24px 16px}
h1{font-size:22px;margin:0 0 4px}h2{font-size:17px;margin:32px 0 8px}h3{font-size:14px;margin:16px 0 6px}.n{color:var(--mut);font-weight:400;font-size:13px}
h3.typo{color:var(--bad)}h3.unclear{color:var(--warn)}
.sub{color:var(--mut);margin:0 0 16px}
.kpi{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px}
.kpi div{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:10px 12px}.kpi b{display:block;font-size:22px}
.kpi .bad b{color:var(--bad)}.kpi .warn b{color:var(--warn)}
.basis{background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:8px 12px;color:var(--mut);font-size:12px;margin:12px 0}
table{width:100%;border-collapse:collapse;background:var(--panel);border:1px solid var(--line);border-radius:8px;overflow:hidden;margin-bottom:8px}
th,td{text-align:left;padding:6px 8px;border-top:1px solid var(--line);vertical-align:top}th{background:#eef1f5;font-weight:600;border-top:0}
td.r,th.r{text-align:right;font-variant-numeric:tabular-nums}
td.f{max-width:300px;overflow-wrap:anywhere;color:var(--mut);font-size:12px}td.w{color:var(--bad);font-weight:600;white-space:nowrap}td.s{color:var(--ok);white-space:nowrap}
small{color:var(--mut);font-weight:400}td.l img{display:block;max-width:100%;max-height:110px;margin-top:6px;border:1px solid var(--line);border-radius:6px}.again{color:var(--mut);font-size:12px;margin-top:2px}
details{margin:12px 0}summary{cursor:pointer;color:var(--mut);font-weight:600}
.ok{color:var(--ok)}
.concl{border-left:3px solid var(--acc);background:#eef2fb;padding:10px 14px;border-radius:0 6px 6px 0;margin-top:28px}
</style></head><body><main>
<h1>박스·스티커·멸균지 OCR 저장분 보고</h1>
<p class="sub">연결 도우미(Windows OCR)로 읽어 이 PC에 저장한 라벨 ${num(cmp.docs.length)}개 · ${esc(root)} · ${new Date().toLocaleString("ko-KR")}</p>
<div class="kpi">
<div><b>${num(cmp.docs.length)}</b>저장한 라벨(중복 제외)</div>
${read.map((r) => `<div><b>${num(r.files)}</b>${r.c}</div>`).join("")}
<div><b>${num(sum("lines"))}</b>읽은 줄</div>
<div class="bad"><b>${sum("typo")}</b>오타 의심</div>
<div class="warn"><b>${sum("unclear")}</b>판단 불가</div>
</div>
<div class="basis"><b>기준</b> : 열어 둔 폴더의 AI 파일 1페이지를 Windows 한국어 OCR로 읽음(PDF·2페이지 이후 제외) · 내용이 같은 파일은 한 번만 · 분류별로 따로 비교해, 그 분류에 많이 나온 표기와 한 글자 다르면 의심 · 작업 메모(용지·금박·팬톤·날짜·버전)·조사·대소문자 차이 제외 · 의심 자리는 확대해 한 번 더 읽어 OCR 오독을 거름 · 모든 파일이 똑같이 틀렸거나 한 파일에만 있는 문장은 못 잡음 · <b>[기준 확인 필요]</b> 최종 판단은 담당자</div>

<h2>읽은 것</h2>
<table><thead><tr><th>분류</th><th class="r">라벨(중복 제외)</th><th class="r">읽은 줄</th><th class="r">파일당 줄</th><th class="r">작업 메모 줄(비교 제외)</th><th class="r">글자 없음</th><th class="r">오타 의심</th><th class="r">판단 불가</th><th class="r">OCR 오독</th></tr></thead><tbody>
${read.map((r) => `<tr><td>${r.c}</td><td class="r">${num(r.files)}</td><td class="r">${num(r.lines)}</td><td class="r">${r.avg}</td><td class="r">${num(r.memo)}</td><td class="r">${r.empty}</td><td class="r">${r.typo}</td><td class="r">${r.unclear}</td><td class="r">${r.misread}</td></tr>`).join("\n")}
<tr><th>합계</th><th class="r">${num(cmp.docs.length)}</th><th class="r">${num(sum("lines"))}</th><th class="r">${Math.round(sum("lines") / Math.max(1, cmp.docs.length))}</th><th class="r">${num(sum("memo"))}</th><th class="r">${sum("empty")}</th><th class="r">${sum("typo")}</th><th class="r">${sum("unclear")}</th><th class="r">${sum("misread")}</th></tr>
</tbody></table>

${CATS.map(section).join("\n")}

<p class="concl"><b>결국 뭐 하자:</b> «오타 의심» ${sum("typo")}건부터 그림을 보고 진짜 오타면 원본을 고친다. «판단 불가» ${sum("unclear")}건은 그림으로 판단한다. 저장분 ${num(cmp.docs.length)}개는 DB가 준비되면 «DB로 올리기»로 팀 기준으로 쌓는다.</p>
</main></body></html>`;
writeFileSync(`${outBase}.html`, html);
console.log(`오타 의심 ${sum("typo")} · 판단 불가 ${sum("unclear")} · 오독 ${sum("misread")} → ${outBase}.html / _의심.csv / _읽은파일.csv`);
