-- VitalGuard — Supabase SQL Schema
-- Run this in your Supabase project: Dashboard > SQL Editor > New query

-- ─── Enable UUID generation ───────────────────────────────────
create extension if not exists "pgcrypto";

-- ─── Patients ─────────────────────────────────────────────────
create table public.patients (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  phone      text,
  email      text,
  address    text,
  nif        text,
  nhc        text,
  notes      text,
  created_at timestamptz default now()
);

-- ─── Vitals readings ──────────────────────────────────────────
create table public.vitals (
  id             uuid primary key default gen_random_uuid(),
  patient_id     uuid references public.patients(id) on delete cascade,
  heart_rate     integer,
  spo2           integer,
  temperature    real,
  fall_detected  boolean default false,
  created_at     timestamptz default now()
);

-- Index for fast patient lookups
create index vitals_patient_id_idx on public.vitals(patient_id);
create index vitals_created_at_idx on public.vitals(created_at desc);

-- ─── Alerts ───────────────────────────────────────────────────
create table public.alerts (
  id         uuid primary key default gen_random_uuid(),
  patient_id uuid references public.patients(id) on delete cascade,
  type       text check (type in ('alert', 'warn')) default 'warn',
  message    text not null,
  created_at timestamptz default now()
);

create index alerts_created_at_idx on public.alerts(created_at desc);

-- ─── Row Level Security (RLS) ─────────────────────────────────
-- Only authenticated users can access data

alter table public.patients enable row level security;
alter table public.vitals    enable row level security;
alter table public.alerts    enable row level security;

-- Authenticated users can do everything
create policy "Auth users full access" on public.patients
  for all using (auth.role() = 'authenticated');

create policy "Auth users full access" on public.vitals
  for all using (auth.role() = 'authenticated');

create policy "Auth users full access" on public.alerts
  for all using (auth.role() = 'authenticated');

-- ─── Optional: seed a test user ───────────────────────────────
-- Go to Supabase Dashboard > Authentication > Users > Invite user
-- and create an account with your email. No SQL needed for this.
