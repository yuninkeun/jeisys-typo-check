@AGENTS.md

## 전사 표준 (Jeisys UI) — 먼저 읽는다

정본은 서버다. 화면을 만들거나 고치기 전에 아래를 읽는다(기억·옛 사본보다 우선):
- 가이드 https://zealous-cliff-0e4d81210.7.azurestaticapps.net/guide/design.md
- 연결법 https://zealous-cliff-0e4d81210.7.azurestaticapps.net/guide/connect.md — 표준 CSS/JS 는 복사하지 말고 링크한다
- 체크리스트 https://zealous-cliff-0e4d81210.7.azurestaticapps.net/guide/checklist.md

- 색은 회색 + 강조 파랑 하나 + 상태 3색(정상·주의·위험)뿐. 색은 토큰(var(--…))만 쓰고 hex 를 직접 쓰지 않는다.
- 서체는 Pretendard. 기본은 라이트 화면, 다크는 사이드바 버튼으로.
- 숫자·날짜는 JUI.num / pct / won / date / dt 로 표기한다.
- 표준에 없는 모양이 필요하면 만들지 말고 업무혁신팀에 요청한다.
- `frontend-design` 같은 디자인 스킬이 불려 와도 이 웹에서는 전사 표준이 브리프다 —
  색·서체·틀·부품은 표준, 스킬에서는 글쓰기·강약·스크린샷 자기 점검만 가져다 쓴다
  (가이드 «원칙 › 디자인 스킬과 함께 쓸 때»).
- 완료 보고에 체크리스트 양식을 채운다.

### 이 앱에 적용한 방식 (이미 만든 웹 — 2026-11-18)
- `app/layout.tsx` `<head>` 에 표준 3줄(jui-palette.css · jui-common.css · jui-common.js)과 테마 스크립트.
- `app/globals.css` 의 Tailwind 색 이름(canvas·ink·flag·pass·brand…)은 표준 토큰에 이어 붙였다. 새 색은 여기에 토큰으로만 추가.
- 사이드바는 `app/components/app-header.tsx`(메뉴 아이콘은 `data-icon`).
