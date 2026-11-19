-- OCR 의심에 대한 담당자 판정 (설계: docs/DESIGN-ocr-corpus.md 3단계 «판정 학습»)
-- 의심 1건 = 어느 파일(content_hash)의 어떤 글자(word)가 다수 표기(suggest)와 다르다는 것.
-- 판정은 다음 검사부터 모든 파일에 반영된다(같은 word→suggest 쌍 기준):
--   typo    = 오타 확정 → 다른 파일에 같은 글자가 있으면 바로 «오타 확정»
--   ok      = 정상 표기 → 다시 의심하지 않음
--   misread = OCR 오독 → «OCR 오독»으로 걸러냄
-- 실행: Supabase 대시보드 > SQL Editor에 붙여 넣고 Run (한 번만, 다시 실행해도 안전).

create table if not exists public.finding_decisions (
  content_hash text not null,
  word text not null,
  suggest text not null,
  decision text not null check (decision in ('typo', 'ok', 'misread')),
  file_name text,
  decided_by uuid not null default auth.uid() references auth.users (id),
  decided_at timestamptz not null default now(),
  primary key (content_hash, word, suggest)
);

alter table public.finding_decisions enable row level security;

-- 로그인한 사내 계정은 모두 같은 판정을 보고 바꿀 수 있다(담당자 결정과 같은 원칙).
-- 쓰는 사람은 자기 이름으로만 기록된다.
drop policy if exists "finding_decisions read" on public.finding_decisions;
create policy "finding_decisions read" on public.finding_decisions for select to authenticated using (true);
drop policy if exists "finding_decisions insert" on public.finding_decisions;
create policy "finding_decisions insert" on public.finding_decisions for insert to authenticated with check (decided_by = auth.uid());
drop policy if exists "finding_decisions update" on public.finding_decisions;
create policy "finding_decisions update" on public.finding_decisions for update to authenticated using (true) with check (decided_by = auth.uid());
drop policy if exists "finding_decisions delete" on public.finding_decisions;
create policy "finding_decisions delete" on public.finding_decisions for delete to authenticated using (true);

grant select, insert, update, delete on public.finding_decisions to authenticated;
