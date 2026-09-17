# 구현 계획 (PLAN)

- 관련 문서: [PRD.md](PRD.md)(요구사항) · [RUNBOOK.md](RUNBOOK.md)(트러블슈팅)
- 최종 업데이트: 2026-09-17
- 배포 주소: https://my-app-xi-ten-51.vercel.app

이 문서는 "무엇을 왜 만드는가"(PRD.md)에 이어 "실제로 어떻게 만들었고, 다음에 뭘 할 것인가"를
정리한다. 배포된 실제 코드를 기준으로 작성했다.

## 1. 아키텍처 개요

```
사용자 브라우저
   │  (이메일/비밀번호 로그인, 파일 업로드)
   ▼
Next.js (App Router, Vercel 배포)
   │  서버 액션(app/*/actions.ts)에서 아래 두 곳과 통신
   ├─► Supabase
   │     - Auth: 이메일/비밀번호, @jeisys.com 도메인 제한 가입
   │     - Postgres: documents / text_extractions 테이블, pg_trgm 유사도 검색
   │     - Storage: 업로드 원본 파일(illustrations 버킷), 서명된 URL로만 접근
   └─► OpenAI Responses API
         - 업로드된 이미지/PDF에서 TEXT 추출 + 오탈자 판단 (JSON 응답)
```

인증 여부 확인은 `proxy.ts`(Next.js 미들웨어 역할)에서 처리한다. `/login`, `/signup`, `/auth/*`를
제외한 모든 경로는 로그인하지 않으면 `/login`으로 리다이렉트된다.

## 2. 데이터 모델

**`documents`** — 업로드 1건당 1행
| 컬럼 | 설명 |
|---|---|
| `id` | uuid, PK |
| `user_id` | 업로더 (auth.users 참조) |
| `original_filename` | 실제 파일명 (표시용) |
| `storage_path` | Storage 상 실제 경로 (한글·특수문자 회피를 위해 UUID 기반으로 별도 생성) |
| `mime_type` | image/png, image/jpeg, application/pdf 중 하나 |
| `product` | 파일명에서 자동 인식한 제품명 (KNOWN_PRODUCTS 목록 매칭, 없으면 null) |
| `status` | processing / done / failed |
| `created_at` | 업로드 시각 |

**`text_extractions`** — 추출된 줄 1개당 1행 (document_id로 documents와 연결, `ON DELETE CASCADE`)
| 컬럼 | 설명 |
|---|---|
| `line_index` | 파일 내 줄 순서 |
| `text` | 추출된 원문 |
| `normalized_text` | 유사도 비교용 정규화 텍스트 |
| `is_flagged` | 오탈자/표기 불일치 여부 |
| `flag_reason` | 오탈자로 판단한 이유 (한국어) |
| `suggested_text` | 수정 제안 |
| `page` | 페이지 번호 (다중 페이지 PDF의 경우) |
| `bbox` | AI가 추정한 페이지 내 위치 비율(x,y,w,h) — **현재 화면에는 표시하지 않음**, 원본 추출 데이터로만 보관 (3장 참고) |

**`public.user_directory`** (뷰) — `auth.users`에서 `id`, `email`만 안전하게 노출한 뷰. 검증 이력에
업로더를 표시하고 사용자별로 필터링하기 위한 용도. `authenticated` 역할에 SELECT만 부여했다.

## 3. 화면·라우트 구성

| 경로 | 파일 | 설명 |
|---|---|---|
| `/login`, `/signup` | `app/login`, `app/signup` | 이메일/비밀번호 인증 (`app/auth/actions.ts`) |
| `/auth/confirm` | `app/auth/confirm/route.ts` | 이메일 확인 콜백 |
| `/check` | `app/check/page.tsx` | 업로드 폼 + 검증 이력 목록 (사용자 필터, 기간 검색) |
| `/check/[id]` | `app/check/[id]/page.tsx` | 특정 검증 건의 상세 결과 |

핵심 컴포넌트:
- `app/check/upload-form.tsx` — 업로드 폼, 서버 액션 `uploadAndCheck` 호출
- `app/check/actions.ts` — 업로드 처리, OpenAI 호출, 과거 이력 비교, DB 저장
- `app/check/result-view.tsx` — 검증 결과 화면(요약 카드, As-Is/To-Be 목록). **이미지 위치 마커·크롭
  이미지는 제거했다** — AI가 추정한 좌표가 반복 레이아웃에서 자주 어긋나 신뢰하기 어려웠기 때문에,
  페이지 번호 + 텍스트만 보여주는 것으로 단순화했다 (자세한 경위는 RUNBOOK.md 3장).

## 4. 만든 순서 (완료)

1. Next.js 프로젝트 초기 세팅, 브랜드 톤(네이비·골드) 스타일링
2. Supabase 이메일/비밀번호 로그인, 사내 도메인 가입 제한
3. 파일 업로드 → OpenAI Vision/PDF 추출 → 오탈자 판단 → DB 저장
4. 과거 이력 대비 표기 일관성 검사 (`pg_trgm` 유사도, 임계값 0.6)
5. 결과 화면: 요약 카드, As-Is/To-Be 비교, 이력 목록, 상세 페이지
6. PDF 미리보기 (pdf.js) — 두 차례 실제 파일에서 브라우저 호환성 크래시 발견·수정
   (`toHex`, `getOrInsertComputed` — 최신 TC39 제안 함수 폴리필, RUNBOOK.md 2장)
7. 이미지 위치 마커의 정확도 문제 확인 후, 페이지 번호 표시로 단순화 (관련 코드·의존성 정리)
8. 검증 이력에 업로더 표시 + 사용자별 필터 추가 (`user_directory` 뷰)
9. 검증 이력 기간 검색 추가 (기본 최근 20건, 최대 6개월까지 지정 검색)
10. 테스트 중 쌓인 중복 업로드 데이터 정리 (동일 파일 반복 업로드 건 삭제, 최신 것만 유지)

## 5. 다음 계획 (로드맵, 미착수)

우선순위 순. PRD.md 5장의 "nice" 항목과 동일하다.

1. **자주 틀리는 단어·제품명 사전 등록** — 반복되는 오탈자 판정을 더 빠르고 일관되게
2. **오탈자 발생 통계 대시보드** — 부서·제품별 월별 추이 (성공 기준 모니터링용)
3. **여러 파일 일괄 업로드·검증**
4. **위치 표시 정확도 개선** — 지금은 페이지 번호까지만 제공. 프롬프트를 개선하거나
   (반복 레이아웃에서 각 인스턴스를 구분해서 좌표를 잡도록), 마커 자체에 세로 패딩을 주는 방식을
   다시 시도할 수 있다 (RUNBOOK.md 3장에 이전 시도 기록).
5. **스토리지 정리 자동화** — 테스트/중복 업로드 시 DB 행은 정리했지만, Storage에 남은 원본 파일은
   수동으로만 지울 수 있었다(대량 삭제 방지 정책). 문서 삭제 시 연결된 Storage 객체도 함께 지우는
   흐름을 만들 필요가 있다.

## 6. 배포 메모

- `git push` 이후에는 항상 `vercel deploy --prod`를 별도로 실행해야 실제 서비스에 반영된다 —
  둘은 별개 단계이며, 커밋·푸시만으로는 운영 사이트가 바뀌지 않는다.
- 배포 전 로컬에서 `npx tsc --noEmit`, `npx eslint`, `npm run build`로 확인하는 것을 기본으로 한다.
- 정확한 배포 절차는 RUNBOOK.md 1장 참고.
