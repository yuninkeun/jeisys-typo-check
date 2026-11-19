-- OCR 문구 DB (설계: docs/DESIGN-ocr-corpus.md 1단계 «적재»)
-- 연결 도우미(Windows OCR)가 읽은 라벨 글자를 파일별로 쌓아, 다음 검사의 비교 기준으로 쓴다.
-- 파일 원본은 올리지 않고 글자와 위치만 저장한다. 파일은 내용 해시(sha256)로 구분 —
-- documents.content_hash · review_decisions.content_hash 와 같은 값이다.
-- 우선 박스·스티커·멸균지만 쌓는다.
-- 실행: Supabase 대시보드 > SQL Editor에 붙여 넣고 Run (한 번만, 다시 실행해도 안전).

create table if not exists public.label_files (
  content_hash text primary key,
  file_name text not null,
  file_path text,
  category text not null check (category in ('박스', '스티커', '멸균지')),
  product text,
  page_w int not null,
  page_h int not null,
  line_count int not null default 0,
  -- 작업 메모 블록을 뺀 전체 글자(소문자·공백 제거) — 2단계 문맥 확인용
  compact_text text not null default '',
  ocr_engine text not null default 'win-ocr-ko@1',
  read_by uuid not null default auth.uid() references auth.users (id),
  read_at timestamptz not null default now()
);

create table if not exists public.label_lines (
  content_hash text not null references public.label_files (content_hash) on delete cascade,
  line_index int not null,
  text text not null,
  -- 페이지 대비 0~1 비율 {x, y, w, h}
  bbox jsonb not null,
  -- 작업 메모(용지·금박·팬톤·날짜·버전) 블록 — 비교에서 뺀다
  is_memo boolean not null default false,
  primary key (content_hash, line_index)
);

create index if not exists label_files_category_idx on public.label_files (category);
create index if not exists label_lines_text_trgm on public.label_lines using gin (text gin_trgm_ops);

alter table public.label_files enable row level security;
alter table public.label_lines enable row level security;

-- 로그인한 사내 계정은 모두 읽는다(검증 이력과 같은 원칙). 쓰는 사람은 자기 이름으로만 기록된다.
drop policy if exists "label_files read" on public.label_files;
create policy "label_files read" on public.label_files for select to authenticated using (true);
drop policy if exists "label_files insert" on public.label_files;
create policy "label_files insert" on public.label_files for insert to authenticated with check (read_by = auth.uid());

drop policy if exists "label_lines read" on public.label_lines;
create policy "label_lines read" on public.label_lines for select to authenticated using (true);
drop policy if exists "label_lines insert" on public.label_lines;
create policy "label_lines insert" on public.label_lines for insert to authenticated
  with check (exists (select 1 from public.label_files f where f.content_hash = label_lines.content_hash and f.read_by = auth.uid()));

grant select, insert on public.label_files, public.label_lines to authenticated;

-- 파일 1개를 줄까지 한 번에 저장한다(중간에 실패하면 아무것도 남지 않음).
-- 이미 있는 파일이면 아무것도 하지 않고 false.
create or replace function public.save_label_ocr(doc jsonb)
returns boolean
language plpgsql
security invoker
as $$
begin
  insert into public.label_files (content_hash, file_name, file_path, category, product, page_w, page_h, line_count, compact_text)
  values (
    doc->>'hash', doc->>'fileName', doc->>'filePath', doc->>'category', nullif(doc->>'product', ''),
    (doc->>'w')::int, (doc->>'h')::int, jsonb_array_length(doc->'lines'), coalesce(doc->>'compact', '')
  )
  on conflict (content_hash) do nothing;
  if not found then
    return false;
  end if;
  insert into public.label_lines (content_hash, line_index, text, bbox, is_memo)
  select doc->>'hash', (l.ordinality - 1)::int, l.value->>'t', l.value->'bbox', coalesce((l.value->>'memo')::boolean, false)
  from jsonb_array_elements(doc->'lines') with ordinality as l;
  return true;
end;
$$;

-- 쌓인 파일들의 줄을 파일별 한 행(jsonb)으로 — 행 수 제한(1000) 없이 200개를 한 번에 받는다.
create or replace function public.get_label_ocr(hashes text[])
returns table (content_hash text, page_w int, page_h int, lines jsonb)
language sql
stable
security invoker
as $$
  select f.content_hash, f.page_w, f.page_h,
    coalesce((select jsonb_agg(jsonb_build_object('t', l.text, 'bbox', l.bbox, 'memo', l.is_memo) order by l.line_index)
              from public.label_lines l where l.content_hash = f.content_hash), '[]'::jsonb)
  from public.label_files f
  where f.content_hash = any(hashes);
$$;

grant execute on function public.save_label_ocr(jsonb), public.get_label_ocr(text[]) to authenticated;
