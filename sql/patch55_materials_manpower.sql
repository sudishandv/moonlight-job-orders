-- Patch 55: Material Used + Manpower Details
-- Run this in Supabase: Dashboard > SQL Editor > New query > paste all > Run

create table model_materials (
  id uuid default gen_random_uuid() primary key,
  model_id uuid references models(id) on delete cascade not null,
  material_type text,
  material_code text,
  quantity text,
  created_at timestamptz default now()
);

create table model_manpower (
  id uuid default gen_random_uuid() primary key,
  model_id uuid references models(id) on delete cascade not null,
  person_name text,
  department text,
  time_used text,
  created_at timestamptz default now()
);

alter table model_materials enable row level security;
alter table model_manpower enable row level security;

create policy "auth read model_materials" on model_materials for select using (auth.role() = 'authenticated');
create policy "auth insert model_materials" on model_materials for insert with check (auth.role() = 'authenticated');
create policy "auth delete model_materials" on model_materials for delete using (auth.role() = 'authenticated');

create policy "auth read model_manpower" on model_manpower for select using (auth.role() = 'authenticated');
create policy "auth insert model_manpower" on model_manpower for insert with check (auth.role() = 'authenticated');
create policy "auth delete model_manpower" on model_manpower for delete using (auth.role() = 'authenticated');
