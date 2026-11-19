# OCR 비교 스크립트 (AI·크레딧 없이)

라벨 파일을 Windows OCR로 읽어 파일끼리 비교해 오타를 찾는다. 웹 앱의 «OCR로 읽어 비교»와
같은 규칙(`lib/ocr-compare.ts`)을 쓴다. PS1은 PowerShell(실행 정책 Bypass)로 돌린다.

## 이 PC에 저장된 것으로 보고서 만들기 (권장)

웹에서 OCR 비교를 돌리면 박스·스티커·멸균지는 `%APPDATA%\JeisysTypoBridge\ocr`에 저장된다.

```
node --experimental-strip-types scripts/ocr-compare/store-compare.mjs "<웹에서 연 폴더>" out/cmp.json
# out/reread-in.json = cmp.json의 findings 중 ocrLike가 아닌 것 [{id, path, box}]
powershell -File scripts/ocr-compare/reread.ps1 -In out/reread-in.json -Out out/reread-out.json
powershell -File scripts/ocr-compare/crop.ps1 -In out/reread-in.json -OutDir out/crops
node scripts/ocr-compare/store-report.mjs out/cmp.json out/reread-out.json out/crops reports/이름 "<웹에서 연 폴더>"
```

결과: `reports/이름.html`(그림 포함), `_의심.csv`, `_읽은파일.csv`. 사내 라벨 문구가 들어 있어
`reports/`는 git에 올리지 않는다.

## 시제품(처음부터 직접 읽기)

`ocr.ps1`(파일 목록 → OCR JSONL) → `compare.mjs` → `reread.ps1` → `crop.ps1` → `report.mjs`.
