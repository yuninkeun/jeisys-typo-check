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

/** AUTO: run by the 연결 도우미 from the web page — no questions, the report
 *  is returned instead of shown, and TARGET_PATH names the file to open. */
function isAuto() { return typeof AUTO !== "undefined" && AUTO; }
function ask(q) { return isAuto() || confirm(q); }

function openTarget() {
  if (typeof TARGET_PATH === "undefined" || !TARGET_PATH) return;
  var f = new File(TARGET_PATH);
  for (var i = 0; i < app.documents.length; i++) {
    try {
      if (app.documents[i].fullName.fsName === f.fsName) { app.activeDocument = app.documents[i]; return; }
    } catch (e) {}
  }
  app.open(f);
}

var LAST_SAVED = "";

/** Returns the report ("" when the reviewer cancelled). */
function main() {
  if (isAuto()) openTarget();
  if (app.documents.length === 0) {
    return "열린 Illustrator 문서가 없습니다.\n수정할 파일(" + EXPECTED_FILE + ")을 먼저 열어 주세요.";
  }
  var doc = app.activeDocument;
  if (doc.name !== EXPECTED_FILE &&
      !ask("이 스크립트는 '" + EXPECTED_FILE + "'용입니다.\n지금 열린 문서는 '" + doc.name + "'입니다.\n그래도 적용할까요?")) {
    return "";
  }
  var folder = null;
  try { folder = doc.path; } catch (e) { folder = null; }
  if (!folder || !folder.exists) {
    return "이 문서는 아직 저장된 적이 없어 저장할 폴더를 알 수 없습니다.\n원본 파일을 연 상태에서 다시 실행해 주세요.";
  }
  var target = completedFile(folder, doc.name);
  if (!ask("오타 수정 " + FIXES.length + "건을 '" + doc.name + "'에 적용하고\n같은 폴더에 '" + decodeURI(target.name) + "'(으)로 저장합니다.\n원본 파일은 그대로 둡니다.")) {
    return "";
  }
  var r = applyFixes(doc, FIXES);
  var msg = "적용 " + r.applied.length + "건 / 못 찾음 " + r.missing.length + "건" +
            (r.failed.length ? " / 실패 " + r.failed.length + "건" : "");
  if (r.applied.length) msg += "\n\n[적용됨]\n" + r.applied.join("\n");
  if (r.missing.length) msg += "\n\n[못 찾음 — 윤곽선으로 바뀐 글자이거나 표기가 다릅니다. 직접 수정하세요]\n" + r.missing.join("\n");
  if (r.failed.length) msg += "\n\n[실패]\n" + r.failed.join("\n");
  if (r.applied.length === 0) {
    return msg + "\n\n바뀐 글자가 없어 새 파일을 저장하지 않았습니다.";
  }
  try {
    var opts = new IllustratorSaveOptions();
    // Keep the PDF part so the typo checker can preview and compare the result.
    opts.pdfCompatible = true;
    opts.embedLinkedFiles = false;
    opts.fontSubsetThreshold = 100;
    doc.saveAs(target, opts);
    LAST_SAVED = target.fsName;
    msg += "\n\n[저장 완료]\n" + decodeURI(target.fsName) +
           "\n원본은 그대로 두었습니다. 지금 열린 문서는 새로 저장한 완성본입니다.";
  } catch (e) {
    msg += "\n\n[저장 실패] " + e + "\n파일 > 다른 이름으로 저장으로 직접 저장해 주세요.";
  }
  return msg;
}

/** "<name>_YYYYMMDD<suffix>.ai" next to the original; adds _2, _3… if that file exists. */
function completedFile(folder, name, suffix) {
  suffix = suffix || "";
  var d = new Date();
  var pad = function (n) { return (n < 10 ? "0" : "") + n; };
  var stamp = d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate());
  var base = decodeURI(name).replace(/\.[^.]+$/, "");
  var f = new File(folder.fsName + "/" + base + "_" + stamp + suffix + ".ai");
  for (var n = 2; f.exists && n < 100; n++) f = new File(folder.fsName + "/" + base + "_" + stamp + suffix + "_" + n + ".ai");
  return f;
}
`;

/** Separates the saved file's path from the report in an AUTO run's result. */
export const AUTO_SPLIT = "\n@@JEISYS@@\n";

/** auto: for the 연결 도우미, which puts `var TARGET_PATH = "…";` in front;
 *  the script's value is then "<saved path>" + AUTO_SPLIT + "<report>". */
export function buildIllustratorScript(fileName: string, fixes: TextFix[], { auto = false } = {}): string {
  const header = [
    "// Jeisys 오타 검증 — Illustrator 텍스트 수정 스크립트",
    `// 대상 파일: ${fileName}`,
    `// 생성: ${new Date().toLocaleString("ko-KR")}`,
    "// 사용법: Illustrator에서 대상 파일을 연 뒤 파일 > 스크립트 > 기타 스크립트… 에서 이 파일을 선택합니다.",
    "// 바뀐 글자만 다시 쓰므로 폰트·색상·크기·위치는 그대로 유지됩니다. 적용 후 같은 폴더에 원본이름_오늘날짜.ai로 저장하고, 원본은 건드리지 않습니다.",
    "",
    "#target illustrator",
    `var EXPECTED_FILE = ${toEs3Literal(fileName)};`,
    `var FIXES = ${toEs3Literal(fixes)};`,
    `var AUTO = ${auto};`,
  ].join("\n");
  // Header comments are plain text for humans; escape only what goes into code.
  const run = auto
    ? `var __report = main();\nLAST_SAVED + ${toEs3Literal(AUTO_SPLIT)} + __report;\n`
    : `if (typeof app !== "undefined") { var __report = main(); if (__report) alert(__report); }\n`;
  return `${header}\n${SCRIPT_BODY}\n${run}`;
}

export function scriptFileName(fileName: string) {
  return `${fileName.replace(/\.[^.]+$/, "")}_오타수정.jsx`;
}

const MARKER_BODY = String.raw`
function markColor(doc) {
  if (doc.documentColorSpace === DocumentColorSpace.CMYK) {
    var c = new CMYKColor(); c.cyan = 0; c.magenta = 100; c.yellow = 100; c.black = 0; return c;
  }
  var r = new RGBColor(); r.red = 230; r.green = 0; r.blue = 18; return r;
}

function setKoreanFont(range) {
  var names = ["MalgunGothic", "MalgunGothicBold", "NanumGothic", "AppleSDGothicNeo-Regular"];
  for (var i = 0; i < names.length; i++) {
    try { range.characterAttributes.textFont = app.textFonts.getByName(names[i]); return; } catch (e) {}
  }
}

function markMain() {
  if (app.documents.length === 0) {
    alert("열린 Illustrator 문서가 없습니다.\n표시할 파일(" + EXPECTED_FILE + ")을 먼저 열어 주세요.");
    return;
  }
  var doc = app.activeDocument;
  if (doc.name !== EXPECTED_FILE &&
      !confirm("이 스크립트는 '" + EXPECTED_FILE + "'용입니다.\n지금 열린 문서는 '" + doc.name + "'입니다.\n그래도 적용할까요?")) {
    return;
  }
  var folder = null;
  try { folder = doc.path; } catch (e) { folder = null; }
  if (!folder || !folder.exists) {
    alert("이 문서는 아직 저장된 적이 없어 저장할 폴더를 알 수 없습니다.\n원본 파일을 연 상태에서 다시 실행해 주세요.");
    return;
  }
  var target = completedFile(folder, doc.name, "_오타표시");
  if (!confirm("오타 위치 " + MARKS.length + "곳을 '오타 표시' 레이어에 빨간 상자와 메모로 표시하고\n같은 폴더에 '" + decodeURI(target.name) + "'(으)로 저장합니다.\n원본 파일은 그대로 둡니다.")) {
    return;
  }
  var oldSystem = app.coordinateSystem;
  app.coordinateSystem = CoordinateSystem.DOCUMENTCOORDINATESYSTEM;
  var layer;
  try { layer = doc.layers.getByName("오타 표시"); } catch (e) {
    layer = doc.layers.add();
    layer.name = "오타 표시";
  }
  layer.locked = false;
  layer.visible = true;
  var color = markColor(doc);
  var list = [];
  for (var i = 0; i < MARKS.length; i++) {
    var m = MARKS[i];
    var ab = doc.artboards[Math.max(0, Math.min(m.page - 1, doc.artboards.length - 1))];
    var r = ab.artboardRect; // [left, top, right, bottom], y grows upward
    var w = r[2] - r[0], h = r[1] - r[3];
    var pad = 3;
    var left = r[0] + m.x * w - pad;
    var top = r[1] - m.y * h + pad;
    var box = layer.pathItems.rectangle(top, left, m.w * w + pad * 2, m.h * h + pad * 2);
    box.filled = false;
    box.stroked = true;
    box.strokeColor = color;
    box.strokeWidth = 1.5;
    var label = layer.textFrames.add();
    label.contents = (i + 1) + ". " + m.from + "  →  " + m.to;
    setKoreanFont(label.textRange);
    label.textRange.characterAttributes.size = 7;
    label.textRange.characterAttributes.fillColor = color;
    label.position = [left, top + 10];
    list.push((i + 1) + ". p." + m.page + "  " + m.from + "  →  " + m.to);
  }
  app.coordinateSystem = oldSystem;
  var msg = "오타 위치 " + MARKS.length + "곳을 표시했습니다.\n\n" + list.join("\n");
  try {
    var opts = new IllustratorSaveOptions();
    opts.pdfCompatible = true;
    doc.saveAs(target, opts);
    msg += "\n\n[저장 완료]\n" + decodeURI(target.fsName) +
           "\n원본은 그대로 두었습니다.\n윤곽선 글자는 직접 다시 입력해야 합니다. 다 고친 뒤 '오타 표시' 레이어를 지우고 저장하세요.";
  } catch (e) {
    msg += "\n\n[저장 실패] " + e + "\n파일 > 다른 이름으로 저장으로 직접 저장해 주세요.";
  }
  alert(msg);
}
`;

export type TypoMark = { page: number; x: number; y: number; w: number; h: number; from: string; to: string };

/** For outlined artwork: draws a red box and a note at each typo on an
 *  "오타 표시" layer and saves a copy, since the letters themselves can't be edited. */
export function buildMarkerScript(fileName: string, marks: TypoMark[]): string {
  const header = [
    "// Jeisys 오타 검증 — Illustrator 오타 위치 표시 스크립트 (윤곽선 파일용)",
    `// 대상 파일: ${fileName}`,
    `// 생성: ${new Date().toLocaleString("ko-KR")}`,
    "// 글자가 윤곽선이라 자동으로 고칠 수 없어, 고칠 곳에 빨간 상자와 메모를 '오타 표시' 레이어에 그립니다.",
    "// 같은 폴더에 원본이름_오늘날짜_오타표시.ai로 저장하고, 원본은 건드리지 않습니다.",
    "",
    "#target illustrator",
    `var EXPECTED_FILE = ${toEs3Literal(fileName)};`,
    "var FIXES = [];",
    `var MARKS = ${toEs3Literal(marks)};`,
  ].join("\n");
  return `${header}\n${SCRIPT_BODY}\n${MARKER_BODY}\nif (typeof app !== "undefined") markMain();\n`;
}

export function markerScriptFileName(fileName: string) {
  return `${fileName.replace(/\.[^.]+$/, "")}_오타표시.jsx`;
}
