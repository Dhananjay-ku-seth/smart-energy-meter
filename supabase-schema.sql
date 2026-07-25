-- Run this once in the Supabase SQL Editor (same project as logic-circuit-sim).
create table if not exists public.energy_meter_presets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  config jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.energy_meter_presets enable row level security;

create policy "select own energy_meter_presets" on public.energy_meter_presets for select using (auth.uid() = user_id);
create policy "insert own energy_meter_presets" on public.energy_meter_presets for insert with check (auth.uid() = user_id);
create policy "delete own energy_meter_presets" on public.energy_meter_presets for delete using (auth.uid() = user_id);
