-- Focusline / Cognitive Workspace
-- Phase 2: database schema only
-- Run this file in the Supabase SQL Editor after creating a project.

create extension if not exists pgcrypto;

-- Application profile linked one-to-one with Supabase Auth.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  language text not null default 'en' check (language in ('en', 'zh')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  description text not null default '',
  status text not null default 'in_progress'
    check (status in ('in_progress', 'completed')),
  current_step_id uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.task_steps (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  description text not null default '',
  status text not null default 'pending'
    check (status in ('pending', 'completed')),
  step_order integer not null default 0 check (step_order >= 0),
  dependencies jsonb not null default '[]'::jsonb,
  estimated_minutes integer null check (estimated_minutes is null or estimated_minutes > 0),
  completed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Add the circular reference after both tasks and task_steps exist.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'tasks_current_step_id_fkey'
      and conrelid = 'public.tasks'::regclass
  ) then
    alter table public.tasks
      add constraint tasks_current_step_id_fkey
      foreign key (current_step_id)
      references public.task_steps(id)
      on delete set null;
  end if;
end $$;

create table if not exists public.todos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id uuid null references public.tasks(id) on delete set null,
  title text not null,
  completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.task_context (
  task_id uuid primary key references public.tasks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  last_action text not null default '',
  what_was_done jsonb not null default '[]'::jsonb,
  what_was_being_considered text not null default '',
  next_intended_action text not null default '',
  relevant_files jsonb not null default '[]'::jsonb,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.task_events (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null,
  detail text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists tasks_user_id_updated_at_idx
  on public.tasks(user_id, updated_at desc);

create index if not exists task_steps_task_id_order_idx
  on public.task_steps(task_id, step_order);

create index if not exists task_steps_user_id_idx
  on public.task_steps(user_id);

create index if not exists todos_user_id_updated_at_idx
  on public.todos(user_id, updated_at desc);

create index if not exists task_events_task_id_created_at_idx
  on public.task_events(task_id, created_at desc);

create index if not exists task_context_user_id_idx
  on public.task_context(user_id);

-- Keep updated_at server-generated for every mutable application table.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists tasks_set_updated_at on public.tasks;
create trigger tasks_set_updated_at
before update on public.tasks
for each row execute function public.set_updated_at();

drop trigger if exists task_steps_set_updated_at on public.task_steps;
create trigger task_steps_set_updated_at
before update on public.task_steps
for each row execute function public.set_updated_at();

drop trigger if exists todos_set_updated_at on public.todos;
create trigger todos_set_updated_at
before update on public.todos
for each row execute function public.set_updated_at();

drop trigger if exists task_context_set_updated_at on public.task_context;
create trigger task_context_set_updated_at
before update on public.task_context
for each row execute function public.set_updated_at();

-- Create a profile whenever a new Auth user is registered.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id)
  values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- Row Level Security: every user can access only rows owned by auth.uid().
alter table public.profiles enable row level security;
alter table public.tasks enable row level security;
alter table public.task_steps enable row level security;
alter table public.todos enable row level security;
alter table public.task_context enable row level security;
alter table public.task_events enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
on public.profiles for select
using (id = auth.uid());

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
on public.profiles for insert
with check (id = auth.uid());

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
on public.profiles for update
using (id = auth.uid())
with check (id = auth.uid());

drop policy if exists "tasks_select_own" on public.tasks;
create policy "tasks_select_own"
on public.tasks for select
using (user_id = auth.uid());

drop policy if exists "tasks_insert_own" on public.tasks;
create policy "tasks_insert_own"
on public.tasks for insert
with check (user_id = auth.uid());

drop policy if exists "tasks_update_own" on public.tasks;
create policy "tasks_update_own"
on public.tasks for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "tasks_delete_own" on public.tasks;
create policy "tasks_delete_own"
on public.tasks for delete
using (user_id = auth.uid());

drop policy if exists "task_steps_select_own" on public.task_steps;
create policy "task_steps_select_own"
on public.task_steps for select
using (
  user_id = auth.uid()
  and exists (
    select 1 from public.tasks
    where tasks.id = task_steps.task_id
      and tasks.user_id = auth.uid()
  )
);

drop policy if exists "task_steps_insert_own" on public.task_steps;
create policy "task_steps_insert_own"
on public.task_steps for insert
with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.tasks
    where tasks.id = task_steps.task_id
      and tasks.user_id = auth.uid()
  )
);

drop policy if exists "task_steps_update_own" on public.task_steps;
create policy "task_steps_update_own"
on public.task_steps for update
using (
  user_id = auth.uid()
  and exists (
    select 1 from public.tasks
    where tasks.id = task_steps.task_id
      and tasks.user_id = auth.uid()
  )
)
with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.tasks
    where tasks.id = task_steps.task_id
      and tasks.user_id = auth.uid()
  )
);

drop policy if exists "task_steps_delete_own" on public.task_steps;
create policy "task_steps_delete_own"
on public.task_steps for delete
using (
  user_id = auth.uid()
  and exists (
    select 1 from public.tasks
    where tasks.id = task_steps.task_id
      and tasks.user_id = auth.uid()
  )
);

drop policy if exists "todos_select_own" on public.todos;
create policy "todos_select_own"
on public.todos for select
using (user_id = auth.uid());

drop policy if exists "todos_insert_own" on public.todos;
create policy "todos_insert_own"
on public.todos for insert
with check (
  user_id = auth.uid()
  and (
    task_id is null
    or exists (
      select 1 from public.tasks
      where tasks.id = todos.task_id
        and tasks.user_id = auth.uid()
    )
  )
);

drop policy if exists "todos_update_own" on public.todos;
create policy "todos_update_own"
on public.todos for update
using (user_id = auth.uid())
with check (
  user_id = auth.uid()
  and (
    task_id is null
    or exists (
      select 1 from public.tasks
      where tasks.id = todos.task_id
        and tasks.user_id = auth.uid()
    )
  )
);

drop policy if exists "todos_delete_own" on public.todos;
create policy "todos_delete_own"
on public.todos for delete
using (user_id = auth.uid());

drop policy if exists "task_context_select_own" on public.task_context;
create policy "task_context_select_own"
on public.task_context for select
using (
  user_id = auth.uid()
  and exists (
    select 1 from public.tasks
    where tasks.id = task_context.task_id
      and tasks.user_id = auth.uid()
  )
);

drop policy if exists "task_context_insert_own" on public.task_context;
create policy "task_context_insert_own"
on public.task_context for insert
with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.tasks
    where tasks.id = task_context.task_id
      and tasks.user_id = auth.uid()
  )
);

drop policy if exists "task_context_update_own" on public.task_context;
create policy "task_context_update_own"
on public.task_context for update
using (
  user_id = auth.uid()
  and exists (
    select 1 from public.tasks
    where tasks.id = task_context.task_id
      and tasks.user_id = auth.uid()
  )
)
with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.tasks
    where tasks.id = task_context.task_id
      and tasks.user_id = auth.uid()
  )
);

drop policy if exists "task_context_delete_own" on public.task_context;
create policy "task_context_delete_own"
on public.task_context for delete
using (
  user_id = auth.uid()
  and exists (
    select 1 from public.tasks
    where tasks.id = task_context.task_id
      and tasks.user_id = auth.uid()
  )
);

drop policy if exists "task_events_select_own" on public.task_events;
create policy "task_events_select_own"
on public.task_events for select
using (
  user_id = auth.uid()
  and exists (
    select 1 from public.tasks
    where tasks.id = task_events.task_id
      and tasks.user_id = auth.uid()
  )
);

drop policy if exists "task_events_insert_own" on public.task_events;
create policy "task_events_insert_own"
on public.task_events for insert
with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.tasks
    where tasks.id = task_events.task_id
      and tasks.user_id = auth.uid()
  )
);

drop policy if exists "task_events_delete_own" on public.task_events;
create policy "task_events_delete_own"
on public.task_events for delete
using (
  user_id = auth.uid()
  and exists (
    select 1 from public.tasks
    where tasks.id = task_events.task_id
      and tasks.user_id = auth.uid()
  )
);
