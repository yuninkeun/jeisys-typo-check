-- 폴더 일괄 검토: 담당자 결정(문제없음 / 수정 필요 / 보류)을 팀이 함께 보도록 저장한다.
-- 파일은 내용 해시(sha256)로 구분한다 — documents.content_hash와 같은 값이라, 어느 PC에서
-- 어떤 폴더를 열었든 같은 파일이면 같은 결정이 보인다.
-- 실행: Supabase 대시보드 > SQL Editor에 붙여 넣고 Run (한 번만).

create table if not exists public.review_decisions (
  content_hash text primary key,
  decision text not null check (decision in ('ok', 'fix', 'hold')),
  file_name text not null,
  file_path text,
  decided_by uuid not null default auth.uid() references auth.users (id),
  decided_at timestamptz not null default now()
);

alter table public.review_decisions enable row level security;

-- 로그인한 사내 계정은 모두 같은 결정을 보고 바꿀 수 있다 (검증 이력과 같은 원칙).
-- 쓰는 사람은 자기 이름으로만 기록된다.
drop policy if exists "review_decisions read" on public.review_decisions;
create policy "review_decisions read" on public.review_decisions
  for select to authenticated using (true);

drop policy if exists "review_decisions insert" on public.review_decisions;
create policy "review_decisions insert" on public.review_decisions
  for insert to authenticated with check (decided_by = auth.uid());

drop policy if exists "review_decisions update" on public.review_decisions;
create policy "review_decisions update" on public.review_decisions
  for update to authenticated using (true) with check (decided_by = auth.uid());

drop policy if exists "review_decisions delete" on public.review_decisions;
create policy "review_decisions delete" on public.review_decisions
  for delete to authenticated using (true);

grant select, insert, update, delete on public.review_decisions to authenticated;
