# 운영 런북 (Runbook)

이 문서는 실제로 겪었던 시행착오를 다음에는 반복하지 않기 위해 정리한 절차서입니다.
문제가 생기면 먼저 이 문서에서 비슷한 증상을 찾아보고, 아래 단계를 그대로 따라 하세요.

---

## 1. 커밋 → 푸시 → 배포 (표준 절차)

매번 아래 순서 그대로 진행합니다. 순서를 건너뛰지 않습니다.

1. **변경 범위 확인**
   ```bash
   git status
   ```
   `.bkit/`로 시작하는 파일들은 bkit 플러그인이 세션마다 자동으로 건드리는 런타임 로그입니다.
   실제 코드 변경 파일만 골라서 스테이징합니다 (`git add -A` 금지).
   ```bash
   git add app/check/xxx.tsx public/xxx.mjs
   ```

2. **커밋** (heredoc 대신 `-m` 여러 개 사용 — heredoc은 훅에 막힘)
   ```bash
   git commit -m "요약 제목" -m "왜 필요한지 한두 줄" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
   ```

3. **푸시**
   ```bash
   git push origin master
   ```

4. **Vercel 배포** — `.env`의 토큰은 절대 화면에 출력하지 않습니다.
   ```bash
   set -a && . ./.env && set +a
   npx vercel deploy --prod --token "$VERCEL_TOKEN" --yes
   ```
   출력의 `"Aliased"` 줄에서 실제 서비스 URL(`https://my-app-xi-ten-51.vercel.app`)을 확인합니다.

5. **배포 확인** — 로컬 개발 서버가 아니라 **운영 URL**로 직접 접속해서 확인합니다.
   (로컬 dev 서버는 OneDrive 폴더 안에 있어서 동기화가 파일을 계속 건드리고,
   그때마다 Turbopack이 재컴파일(Fast Refresh)을 반복해서 렌더링이 불안정해집니다.
   버그 재현·수정 확인은 되도록 운영 배포본에서 하세요.)

---

## 2. "OOO is not a function" — pdfjs-dist 크래시 패턴

### 증상
브라우저 콘솔/미리보기 에러에 `X.prototype.Y is not a function` 형태로 뜬다.
지금까지 실제로 겪은 두 가지 사례:
- `Uint8Array.prototype.toHex is not a function`
- `Map.prototype(또는 WeakMap.prototype).getOrInsertComputed is not a function`

### 원인
`pdfjs-dist` 최신 버전(6.x)이 아직 모든 브라우저에 표준으로 들어가지 않은
**TC39 최신 제안 단계의 내장 함수**를 내부적으로 사용한다. 브라우저가 해당 함수를
아직 지원하지 않으면 그대로 크래시난다. 라이브러리 버그가 아니라 "브라우저 쪽의 공백"이므로
버전을 내리는 게 아니라 **폴리필**로 메꾸는 게 맞는 방향이다.

### 진단 절차
1. 에러 메시지에서 정확한 메서드 이름을 확인한다 (예: `getOrInsertComputed`).
2. 그 메서드가 어느 번들에서 쓰이는지 확인한다 — **이게 핵심**, 번들마다 폴리필 위치가 다르다.
   ```bash
   grep -rl "메서드이름" node_modules/pdfjs-dist/build/*.mjs
   ```
   - `pdf.worker.min.mjs` / `pdf.worker.mjs`에서만 나오면 → **워커 스레드**에만 폴리필하면 됨.
   - `pdf.mjs` / `pdf.min.mjs`(메인 스레드 번들)에도 나오면 → **메인 스레드에도** 반드시 폴리필해야 함.
     (`getOrInsertComputed`는 이 경우였음 — `toHex`는 워커에만 있었음.)

### 수정 위치 (반드시 둘 다 확인)
- **메인 스레드**: [app/check/file-preview.tsx](app/check/file-preview.tsx) 상단의
  `ensureXxxPolyfill()` 함수들. `await import("pdfjs-dist")` **직전**에 호출해야 한다.
- **워커 스레드**: [public/pdf-worker-entry.mjs](public/pdf-worker-entry.mjs).
  메인 스레드에서 폴리필해도 워커는 별도의 전역 스코프라서 적용 안 됨 — 반드시 워커 진입점
  파일 자체에 동일한 폴리필을 넣고, 그 다음에 `await import("/pdf.worker.min.mjs")` 한다.

폴리필 코드 형태 (둘 다 같은 패턴):
```js
if (typeof Map.prototype.getOrInsertComputed !== "function") {
  Object.defineProperty(Map.prototype, "getOrInsertComputed", {
    value: function (key, callback) {
      if (this.has(key)) return this.get(key);
      const value = callback(key);
      this.set(key, value);
      return value;
    },
    writable: true,
    configurable: true,
  });
}
// WeakMap.prototype에도 동일하게 반복
```

### 검증 절차
1. 실제로 문제를 일으켰던 **실제 업로드 파일**로 재현한다 (합성 테스트 PDF는 재현 안 될 수 있음 —
   실제로 `/ID` 트레일러가 없는 손수 만든 PDF에서는 `toHex` 버그가 재현되지 않았었다).
2. 로컬이 불안정하면 배포 후 운영 URL의 `/check/[id]` 상세 페이지에서 직접 확인한다.
3. 브라우저 콘솔에 에러가 없는지, 실제 이미지/캔버스가 렌더링되는지 확인한다.

---

## 3. 오탈자 위치 표시(bbox)의 정확도 한계

### 배경
`app/check/actions.ts`의 `SYSTEM_PROMPT`는 OpenAI Vision에게 각 줄의 위치를
페이지 대비 비율(x, y, w, h, 0~1)로 "눈대중 추정"하게 시킨다. **OCR 수준의 정밀 좌표가 아니다.**

### 확인된 실패 패턴
동일한 라벨이 여러 번 반복되는 시트(예: 카트리지 라벨 6종이 한 페이지에 배치된 경우)에서는
모델이 줄 하나만큼(한 행) 아래로 밀려서 좌표를 주는 경우가 있었다. 예: "Model : Basic" 줄의
bbox가 실제로는 그 아래 "SN" 줄 위치를 가리킴. 실제 PDF를 파이썬(PyMuPDF)으로 렌더링하고
bbox를 겹쳐 그려서 확인함 — 스크린샷만으로는 판단하기 애매하면 이 방법을 쓴다 (5번 항목 참고).

### 내려진 결정 (2026-09-16 기준)
- **전체 페이지 미리보기 + 빨간 번호 마커** (`PagePreview` 컴포넌트)는 **완전히 제거**했다.
  좌표 오차가 반복적으로 발생해 신뢰하기 어렵다는 판단.
- **AS-IS/TO-BE 카드의 확대 크롭 이미지**(`RegionCrop`)는 유지한다. 이쪽은 원래부터
  여유 있게 패딩(`paddedRect`, 가로 세로 각각 넉넉히 확장)을 두고 자르기 때문에 다소 부정확해도
  실제 텍스트가 크롭 안에 들어올 확률이 높다.
- 관련 파일: [app/check/result-view.tsx](app/check/result-view.tsx),
  [app/check/file-preview.tsx](app/check/file-preview.tsx)
  (`PagePreview`, `Marker` 타입, `paddedMarkerRect`는 삭제됨 — 재도입하지 말 것,
  다시 필요해지면 이 문서의 "실패 패턴"부터 다시 검토).

### 만약 다시 위치 표시 기능을 원한다면
1. 프롬프트를 더 구체적으로 바꿔본다 (예: "반복되는 레이아웃에서는 각 인스턴스를 개별적으로
   좌표를 잡아라" 같은 지시 추가) — 근본적인 정확도 개선.
2. 그래도 오차가 남을 걸 가정하고 마커 자체에 세로 방향 패딩을 준다 (전에 시도했던 방식,
   `Math.max(bbox.h, 0.02)`만큼 위아래로 확장 — 코드는 git 히스토리의
   `7447220` 커밋에 있음, 필요하면 `git show 7447220`로 참고만 하고 그대로 되살리지는 말 것).

---

## 4. PPTX(발표 자료) 생성 워크플로우 — 이 Windows 환경 특이사항

`pptx` 스킬 문서는 "사전 설치되어 있다"고 가정하지만, **이 프로젝트 저장소 안(`my-app`)에는
`pptxgenjs`/`react-icons`가 없다.** 아래 순서를 따른다.

1. **격리된 빌드 폴더 준비** (저장소 `package.json`을 건드리지 않기 위해 스크래치 디렉터리 사용)
   ```bash
   mkdir -p "$SCRATCH/pptx-build" && cd "$SCRATCH/pptx-build"
   npm init -y
   npm install pptxgenjs react-icons react react-dom sharp
   ```
   ⚠️ Bash 도구는 명령 하나가 끝나면 cwd가 프로젝트 루트로 초기화된다.
   다음 명령에서 다시 `cd`가 필요하다.

2. **아이콘은 react-icons → SVG → sharp로 PNG 래스터화**해서 base64로 넣는다
   (pptx 스킬 문서의 패턴 그대로). `image/png;base64,` 접두사 필수.

3. **생성 스크립트 실행**
   ```bash
   node build-deck.js output.pptx
   ```

4. **품질 검수 도구 설치** — 이 환경엔 `markitdown`, `soffice`(LibreOffice)가 없다.
   ```bash
   py -m pip install --quiet markitdown python-pptx defusedxml pymupdf
   export PATH="$PATH:/c/Users/Yuningeun/AppData/Local/Programs/Python/Python313/Scripts"
   ```

5. **콘텐츠 검수** — `markitdown`을 콘솔로 바로 출력하면 한글이 깨진다
   (콘솔 코드페이지 문제). 파일로 저장 후 `Read` 툴로 읽거나, `python-pptx`로
   직접 텍스트를 뽑아서 UTF-8로 저장한다.
   ```bash
   py -m markitdown output.pptx > content.txt   # 콘솔에 바로 cat 하지 말 것
   ```

6. **구조 검증**
   ```bash
   py "<pptx 스킬 경로>/scripts/office/validate.py" output.pptx
   ```

7. **시각 검수(스크린샷) — LibreOffice(soffice) 대신 설치된 PowerPoint를 COM으로 사용**한다.
   `scripts/office/soffice.py`는 Linux/macOS 전용 샌드박스 가정(`socket.AF_UNIX`)이라 Windows에서
   그대로 에러난다. 대신 PowerShell + PowerPoint COM으로 슬라이드를 PNG로 뽑는다:
   ```powershell
   $ppt = New-Object -ComObject PowerPoint.Application
   $pres = $ppt.Presentations.Open($pptxPath, $true, $false, $false)
   $pres.SaveAs($outDir, 18)   # 18 = ppSaveAsPNG, 슬라이드별 PNG로 저장됨
   $pres.Close(); $ppt.Quit()
   ```
   이후 각 PNG를 `Read` 툴로 열어서 글자 잘림/겹침/여백을 직접 확인한다.

8. **최종 저장 위치**: `git 저장소 밖` (예: `...\바탕 화면\{프로젝트명}_소개.pptx`).
   저장소 안에 저장하지 않는다.

---

## 5. 실제 DB 데이터로 슬라이드/기능을 갱신할 때 — Supabase 조회 방법

로컬에는 서비스 롤 키가 없다 (`.env.local`엔 공개용 `NEXT_PUBLIC_*` 키만 있음).
대신 `.env`의 `SUPABASE_ACCESS_TOKEN`(Management API 개인 토큰)으로 SQL을 직접 실행한다.

```bash
set -a && . ./.env && set +a
REF="pmwflphcmngdrskcjyxm"   # 프로젝트 ref, NEXT_PUBLIC_SUPABASE_URL에서 확인 가능
curl -s -X POST "https://api.supabase.com/v1/projects/$REF/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query":"select ... from documents where original_filename ilike '"'"'%검색어%'"'"';"}'
```

- 컬럼명을 모를 땐 먼저 스키마부터 확인한다:
  ```sql
  select column_name, data_type from information_schema.columns where table_name = '테이블명';
  ```
- 특정 문서의 실제 원본 파일이 필요하면(오프라인 렌더링/검증용), 앱이 이미 브라우저에서
  요청한 signed URL을 `performance.getEntriesByType('resource')`로 가로채거나,
  Storage Management API로 새로 서명된 URL을 발급받아 `curl -o input.pdf "$URL"`로 내려받는다.

---

## 6. 일반 원칙 (반복해서 어겼던 것들)

- **비밀값 절대 화면에 출력 금지.** `.env`/`.env.local`은 항상
  `set -a && . ./.env && set +a` 한 줄에 이어서 같은 명령에 붙여 쓴다.
- **로컬 dev 서버(OneDrive 폴더 안)는 렌더링 타이밍이 불안정할 수 있다** — 재현/검증은
  운영 배포본에서 하는 걸 기본으로 한다.
- **브라우저 자동화 창이 백그라운드/최소화되어 있으면 canvas 렌더링(`page.render()`,
  `requestAnimationFrame` 기반)이 무한 대기할 수 있다.** 스크린샷이 계속 타임아웃되면
  창을 화면 앞으로 가져오거나, Python(PyMuPDF 등)으로 오프라인 렌더링해서 확인하는 우회로를 쓴다.
- **사용하지 않게 된 컴포넌트/타입/훅 옵션은 완전히 삭제한다** (주석 처리나 `_` 접두사로
  남겨두지 않는다) — 3번 항목에서 `PagePreview`/`Marker`를 지운 방식 참고.
- **커밋·배포는 매번 사용자에게 명시적으로 확인받는다** ("커밋"/"배포"라고 직접 말할 때 진행).
