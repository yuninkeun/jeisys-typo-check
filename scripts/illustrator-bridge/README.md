# Illustrator 연결 도우미

폴더 탐색 화면의 **Illustrator에서 바로 수정** 버튼이 이 PC의 Illustrator를 움직이게 하는 작은 프로그램.

- 하는 일: 웹에서 받은 수정 내용을 Illustrator(COM)에 넘겨 파일을 열고, 바뀐 글자만 고친 뒤
  원본과 같은 폴더에 `원본이름_날짜.ai`로 저장한다. 원본은 건드리지 않는다.
- 받는 곳: `http://localhost:47811` (이 PC 안). 오타 검증 사이트(`https://my-app-xi-ten-51.vercel.app`,
  로컬 개발 `http://localhost:3000`)에서 온 요청만 처리한다.
- 파일 찾기: 웹에서 연 폴더 이름으로 드라이브·바탕 화면·OneDrive 아래 4단계까지 찾는다.
  못 찾으면 폴더를 고르는 창을 띄우고, 찾은 위치는 `%APPDATA%\JeisysTypoBridge\roots.json`에 기억한다.

## 켜기

```
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\illustrator-bridge\bridge.ps1
```

"연결 도우미가 켜졌습니다"가 나오면 창을 열어 둔 채 웹에서 쓴다. 끄려면 창을 닫는다.
파일은 UTF-8(BOM) 그대로 둔다 — BOM이 없으면 Windows PowerShell 5.1이 한글을 깨뜨린다.

## OCR 비교 (버전 2부터) · 이 PC 저장 (버전 3부터)

폴더 탐색 › 일괄 검토의 **AI 없이 OCR로 읽어 비교**도 이 도우미가 처리한다. Illustrator는 없어도 된다.

- 읽기: 웹이 보낸 파일(PDF 호환 .ai)의 1페이지를 Windows 자체 PDF 렌더러 + 한국어 OCR로 읽는다.
  파일은 메모리에서만 읽고 저장하지 않는다. 비용 없음, 1개에 약 4~8초.
- 이 PC 저장: 박스·스티커·멸균지는 읽은 글자·위치를 `%APPDATA%\JeisysTypoBridge\ocr\<내용 해시>.json`에
  남긴다(`index.tsv` = 목록, `uploaded.txt` = DB에 올린 것). 같은 파일은 다시 읽지 않는다.
- DB로 올리기: DB(supabase/migrations/20261119_label_ocr.sql)가 준비되면 웹의 «DB로 올리기»가
  아직 안 올린 것만 올린다.
- 기록: 오류와 시작·종료는 `%APPDATA%\JeisysTypoBridge\bridge.log`에 남는다.
- 웹이 "옛 버전"이라고 하면 도우미 창을 닫고 이 파일로 다시 켠다.

받는 요청: `/ping`, `/fix`, `/saved`, `/ocr`, `/store/get`, `/store/put`, `/store/stats`, `/store/pending`, `/store/uploaded`.
로컬 개발 주소는 `http://localhost:3000`, `http://localhost:3001`도 허용한다.
