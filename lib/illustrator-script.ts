/**
 * Builds an Adobe Illustrator ExtendScript (.jsx) that applies approved typo
 * fixes to the live text frames of the active document.
 *
 * Only the characters that actually differ are rewritten (common prefix and
 * suffix are left alone), so the font, size and colour of the surrounding text
 * are kept. Text that was converted to outlines has no text frame and is
 * reported as "not found" instead of being touched.
 *
 * ExtendScript is ES3: no let/const, arrow functions or JSON — keep the
 * template that way. Non-ASCII is \u-escaped so the file's encoding can't
 * garble Korean text.
 */

export type TextFix = { from: string; to: string };

function toEs3Literal(value: unknown): string {
  return JSON.stringify(value).replace(
    /[\u007f-￿]/g,
    (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

const SCRIPT_BODY = String.raw`
function normalizeBreaks(s) {
  // Illustrator uses \r for paragraph ends and \u0003 for forced line breaks.
  return s.replace(/\r\n|\r|\u0003/g, "\n");
}

function stripSpaces(s) {
  var out = { text: "", map: [] };
  for (var i = 0; i < s.length; i++) {
    var c = s.charAt(i);
    if (!/\s/.test(c)) { out.text += c; out.map.push(i); }
  }
  return out;
}

/** Finds 'needle' in 'hay' starting at 'from'. Falls back to a match that
 *  ignores whitespace, since extracted lines rarely keep the exact spacing or
 *  line breaks of the text frame. Returns {start, end} in hay, or null. */
function findSegment(hay, needle, from) {
  var i = hay.indexOf(needle, from);
  if (i >= 0) return { start: i, end: i + needle.length };
  var h = stripSpaces(hay);
  var n = stripSpaces(needle).text;
  if (!n.length) return null;
  var fromCompact = 0;
  while (fromCompact < h.map.length && h.map[fromCompact] < from) fromCompact++;
  var j = h.text.indexOf(n, fromCompact);
  if (j < 0) return null;
  return { start: h.map[j], end: h.map[j + n.length - 1] + 1 };
}

/** A line break in the frame counts as matching a space in the fix, so a fix
 *  written on one line never flattens the frame's line breaks. */
function sameChar(frameChar, fixChar) {
  return frameChar === fixChar || (frameChar === "\n" && /\s/.test(fixChar));
}

/** Smallest edit turning 'a' into 'b': keeps the shared prefix and suffix. */
function minimalEdit(a, b) {
  var p = 0;
  while (p < a.length && p < b.length && sameChar(a.charAt(p), b.charAt(p))) p++;
  var s = 0;
  while (s < a.length - p && s < b.length - p &&
         sameChar(a.charAt(a.length - 1 - s), b.charAt(b.length - 1 - s))) s++;
  return { offset: p, removeLength: a.length - p - s, insert: b.substring(p, b.length - s) };
}

/** Replaces len characters at start with str, inheriting the style of the
 *  first replaced character (or the one before an insertion point). */
function replaceRange(tf, start, len, str) {
  var k;
  for (k = len - 1; k >= 1; k--) tf.textRange.characters[start + k].remove();
  if (len > 0) {
    if (str.length > 0) tf.textRange.characters[start].contents = str;
    else tf.textRange.characters[start].remove();
  } else if (str.length > 0) {
    if (start > 0) {
      var prev = tf.textRange.characters[start - 1];
      prev.contents = prev.contents + str;
    } else {
      var first = tf.textRange.characters[0];
      first.contents = str + first.contents;
    }
  }
}

function applyFixes(doc, fixes) {
  var report = { applied: [], missing: [], failed: [] };
  for (var f = 0; f < fixes.length; f++) {
    var fix = fixes[f];
    var target = normalizeBreaks(fix.to);
    var count = 0;
    var failed = false;
    for (var t = 0; t < doc.textFrames.length; t++) {
      var tf = doc.textFrames[t];
      var guard = 0;
      var searchFrom = 0;
      while (guard++ < 50) {
        var hay = normalizeBreaks(tf.contents);
        var seg = findSegment(hay, normalizeBreaks(fix.from), searchFrom);
        if (!seg) break;
        var edit = minimalEdit(hay.substring(seg.start, seg.end), target);
        try {
          if (edit.removeLength > 0 || edit.insert.length > 0) {
            replaceRange(tf, seg.start + edit.offset, edit.removeLength, edit.insert);
          }
          count++;
        } catch (e) {
          failed = true;
          break;
        }
        searchFrom = seg.start + (seg.end - seg.start) - edit.removeLength + edit.insert.length;
      }
    }
    if (count > 0) report.applied.push(fix.from + "  →  " + fix.to + "  (" + count + "곳)");
    else if (failed) report.failed.push(fix.from + "  (잠긴 레이어/개체일 수 있음)");
    else report.missing.push(fix.from);
  }
  return report;
}

function main() {
  if (app.documents.length === 0) {
    alert("열린 Illustrator 문서가 없습니다.\n수정할 파일(" + EXPECTED_FILE + ")을 먼저 열어 주세요.");
    return;
  }
  var doc = app.activeDocument;
  if (doc.name !== EXPECTED_FILE &&
      !confirm("이 스크립트는 '" + EXPECTED_FILE + "'용입니다.\n지금 열린 문서는 '" + doc.name + "'입니다.\n그래도 적용할까요?")) {
    return;
  }
  if (!confirm("오타 수정 " + FIXES.length + "건을 '" + doc.name + "'에 적용합니다.\n(저장은 하지 않습니다. 결과를 확인한 뒤 직접 저장하세요.)")) {
    return;
  }
  var r = applyFixes(doc, FIXES);
  var msg = "적용 " + r.applied.length + "건 / 못 찾음 " + r.missing.length + "건" +
            (r.failed.length ? " / 실패 " + r.failed.length + "건" : "");
  if (r.applied.length) msg += "\n\n[적용됨]\n" + r.applied.join("\n");
  if (r.missing.length) msg += "\n\n[못 찾음 — 윤곽선으로 바뀐 글자이거나 표기가 다릅니다. 직접 수정하세요]\n" + r.missing.join("\n");
  if (r.failed.length) msg += "\n\n[실패]\n" + r.failed.join("\n");
  msg += "\n\n확인 후 저장하세요. 되돌리려면 Ctrl+Z.";
  alert(msg);
}
`;

export function buildIllustratorScript(fileName: string, fixes: TextFix[]): string {
  const header = [
    "// Jeisys 오타 검증 — Illustrator 텍스트 수정 스크립트",
    `// 대상 파일: ${fileName}`,
    `// 생성: ${new Date().toLocaleString("ko-KR")}`,
    "// 사용법: Illustrator에서 대상 파일을 연 뒤 파일 > 스크립트 > 기타 스크립트… 에서 이 파일을 선택합니다.",
    "// 텍스트만 바꾸며, 폰트·색상·위치는 그대로 둡니다. 파일은 저장하지 않습니다.",
    "",
    "#target illustrator",
    `var EXPECTED_FILE = ${toEs3Literal(fileName)};`,
    `var FIXES = ${toEs3Literal(fixes)};`,
  ].join("\n");
  // Header comments are plain text for humans; escape only what goes into code.
  return `${header}\n${SCRIPT_BODY}\nif (typeof app !== "undefined") main();\n`;
}

export function scriptFileName(fileName: string) {
  return `${fileName.replace(/\.[^.]+$/, "")}_오타수정.jsx`;
}
