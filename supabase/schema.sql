-- Glimpse collaboration schema.
--
-- Run this once in the Supabase SQL editor. Every table is behind Row Level
-- Security, because the browser talks to Postgres directly with the anon key
-- and there is no server in between to enforce anything.

-- ---------------------------------------------------------------- profiles

create table if not exists public.profiles (
  id           uuid primary key references auth.users on delete cascade,
  display_name text,
  created_at   timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "read own profile"
  on public.profiles for select using (auth.uid() = id);

create policy "write own profile"
  on public.profiles for insert with check (auth.uid() = id);

create policy "update own profile"
  on public.profiles for update using (auth.uid() = id);

-- Give every new auth user a profile row automatically.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------- projects

-- ids are client-generated so a project keeps the same identity offline and
-- online, and syncing never has to rewrite local references.
create table if not exists public.projects (
  id         text primary key,
  owner_id   uuid not null references auth.users on delete cascade,
  name       text not null,
  aspect     text not null check (aspect in ('square', 'portrait', 'landscape')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.project_members (
  project_id text not null references public.projects on delete cascade,
  user_id    uuid not null references auth.users on delete cascade,
  role       text not null default 'editor' check (role in ('owner', 'editor', 'viewer')),
  joined_at  timestamptz not null default now(),
  primary key (project_id, user_id)
);

-- SECURITY DEFINER so the membership check does not itself trigger RLS on
-- project_members, which would recurse forever.
create or replace function public.is_member(p_project_id text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.project_members m
    where m.project_id = p_project_id and m.user_id = auth.uid()
  );
$$;

alter table public.projects enable row level security;
alter table public.project_members enable row level security;

create policy "members read projects"
  on public.projects for select using (public.is_member(id));

create policy "owner creates project"
  on public.projects for insert with check (auth.uid() = owner_id);

create policy "members update project"
  on public.projects for update using (public.is_member(id));

create policy "owner deletes project"
  on public.projects for delete using (auth.uid() = owner_id);

create policy "members read membership"
  on public.project_members for select using (public.is_member(project_id));

-- The first row is inserted by the owner for themselves; later rows arrive
-- through redeem_invite, which is SECURITY DEFINER and bypasses this.
create policy "self join"
  on public.project_members for insert with check (auth.uid() = user_id);

create policy "leave project"
  on public.project_members for delete using (auth.uid() = user_id);

-- ---------------------------------------------------------------- journal

-- The same append-only journal the local app replays, shared. Sync is
-- therefore just "exchange entries we each lack", with no diffing.
create table if not exists public.entries (
  id         uuid primary key,
  project_id text not null references public.projects on delete cascade,
  author_id  uuid not null references auth.users on delete cascade,
  seq        bigserial,
  payload    jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists entries_project_seq on public.entries (project_id, seq);

alter table public.entries enable row level security;

create policy "members read entries"
  on public.entries for select using (public.is_member(project_id));

create policy "members append entries"
  on public.entries for insert
  with check (public.is_member(project_id) and auth.uid() = author_id);

-- Entries are immutable. No update or delete policy exists, so the log cannot
-- be rewritten by anyone, including the owner.

-- ---------------------------------------------------------------- invites

create table if not exists public.project_invites (
  token      text primary key,
  project_id text not null references public.projects on delete cascade,
  created_by uuid not null references auth.users on delete cascade,
  expires_at timestamptz not null default (now() + interval '30 days'),
  created_at timestamptz not null default now()
);

alter table public.project_invites enable row level security;

create policy "members manage invites"
  on public.project_invites for all using (public.is_member(project_id));

-- Redeeming needs to read an invite the caller cannot yet see, so it runs as
-- definer and returns only the project id.
create or replace function public.redeem_invite(p_token text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_project_id text;
begin
  select project_id into v_project_id
  from public.project_invites
  where token = p_token and expires_at > now();

  if v_project_id is null then
    raise exception 'invite is invalid or has expired';
  end if;

  insert into public.project_members (project_id, user_id, role)
  values (v_project_id, auth.uid(), 'editor')
  on conflict do nothing;

  return v_project_id;
end;
$$;

-- ---------------------------------------------------------------- storage

insert into storage.buckets (id, name, public)
values ('moments', 'moments', false)
on conflict (id) do nothing;

-- Files are stored as <project_id>/<blob_key>, so the first path segment is
-- the authorisation key.
create policy "members read moment files"
  on storage.objects for select
  using (bucket_id = 'moments' and public.is_member((storage.foldername(name))[1]));

create policy "members upload moment files"
  on storage.objects for insert
  with check (bucket_id = 'moments' and public.is_member((storage.foldername(name))[1]));

create policy "members delete moment files"
  on storage.objects for delete
  using (bucket_id = 'moments' and public.is_member((storage.foldername(name))[1]));

-- ---------------------------------------------------------------- realtime

alter publication supabase_realtime add table public.entries;
