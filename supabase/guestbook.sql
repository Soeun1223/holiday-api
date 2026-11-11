-- 한 줄 방명록 표 · Supabase SQL Editor 또는 MCP(apply_migration)로 한 번 실행합니다.
--
-- 규칙
--   - 이름 1~20자, 내용 1~200자 (앞뒤 공백을 뺀 길이, 코드포인트 기준 = char_length)
--   - 누구나(anon, authenticated) 읽기만 할 수 있습니다. 쓰기·고치기·지우기는 못 합니다.
--   - 저장은 서버 함수(api/guestbook.js)가 secret 키(service_role)로만 합니다.
--     service_role은 RLS를 건너뛰므로 정책이 아니라 GRANT로 범위를 좁힙니다.

create table if not exists public.guestbook (
  id         bigint generated always as identity primary key,
  name       text        not null,
  message    text        not null,
  created_at timestamptz not null default now(),
  constraint guestbook_name_length    check (char_length(btrim(name))    between 1 and 20  and name    = btrim(name)),
  constraint guestbook_message_length check (char_length(btrim(message)) between 1 and 200 and message = btrim(message))
);

comment on table public.guestbook is '한 줄 방명록 (공개 읽기 전용, 저장은 서버 함수만)';

-- 최근 글부터 읽는 질의(order by created_at desc limit 20)를 위한 색인
create index if not exists guestbook_created_at_idx on public.guestbook (created_at desc);

-- RLS: 켜 두면 정책이 허락한 행만 보입니다
alter table public.guestbook enable row level security;

drop policy if exists "guestbook: anyone can read" on public.guestbook;
create policy "guestbook: anyone can read"
  on public.guestbook
  for select
  to anon, authenticated
  using (true);

-- 권한: Supabase 기본값은 공개 역할에 모든 권한을 주므로, 모두 회수한 뒤 필요한 것만 줍니다
revoke all on table public.guestbook from anon, authenticated, public;
grant select on table public.guestbook to anon, authenticated;

revoke all on table public.guestbook from service_role;
grant select, insert on table public.guestbook to service_role;
