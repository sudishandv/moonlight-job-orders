-- Run this in Supabase: Dashboard > SQL Editor > New query > paste all > Run

create table profiles (
  id uuid references auth.users on delete cascade primary key,
  name text not null,
  role text not null check (role in ('sales','production','admin')),
  branch text
);

create table branches (
  id uuid default gen_random_uuid() primary key,
  name text not null
);

create table salespersons (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  branch text
);

create table models (
  id uuid default gen_random_uuid() primary key,
  model_no text not null,
  possible_cuts text,
  main_fabric_code text,
  inner_fabric_code text,
  other_fabric text,
  size_range text,
  requirements text,
  side_finishing text,
  sleeve_open_finishing text,
  arm_hole_finishing text,
  bottom_finishing text
);

create table job_orders (
  id uuid default gen_random_uuid() primary key,
  invoice_no text,
  name text not null,
  mobile text,
  order_type text,
  model text,
  item text,
  prepared_by text,
  branch text,
  measurements jsonb default '{}',
  sheila_type text,
  abaya_option text,
  button_till text,
  delivery_date date,
  attachment_url text,
  comments text,
  status text not null default 'job_created',
  history jsonb default '[]',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Row Level Security: any signed-in user (i.e. anyone Admin has created an
-- account for) can read/write. Fine-grained role rules stay enforced in the
-- app UI, same as the prototype. Tighten later with role-based policies if needed.

alter table job_orders enable row level security;
alter table branches enable row level security;
alter table salespersons enable row level security;
alter table models enable row level security;
alter table profiles enable row level security;

create policy "auth read job_orders" on job_orders for select using (auth.role() = 'authenticated');
create policy "auth insert job_orders" on job_orders for insert with check (auth.role() = 'authenticated');
create policy "auth update job_orders" on job_orders for update using (auth.role() = 'authenticated');
create policy "auth delete job_orders" on job_orders for delete using (auth.role() = 'authenticated');

create policy "auth read branches" on branches for select using (auth.role() = 'authenticated');
create policy "auth insert branches" on branches for insert with check (auth.role() = 'authenticated');
create policy "auth delete branches" on branches for delete using (auth.role() = 'authenticated');

create policy "auth read salespersons" on salespersons for select using (auth.role() = 'authenticated');
create policy "auth insert salespersons" on salespersons for insert with check (auth.role() = 'authenticated');
create policy "auth delete salespersons" on salespersons for delete using (auth.role() = 'authenticated');

create policy "auth read models" on models for select using (auth.role() = 'authenticated');
create policy "auth insert models" on models for insert with check (auth.role() = 'authenticated');
create policy "auth delete models" on models for delete using (auth.role() = 'authenticated');

create policy "auth read profiles" on profiles for select using (auth.role() = 'authenticated');

-- Seed starter data (edit names/branches as you like)
insert into branches (name) values ('Al Waab'), ('Downtown'), ('Pearl');
insert into models (model_no, possible_cuts, main_fabric_code, inner_fabric_code, other_fabric, size_range, requirements, side_finishing, sleeve_open_finishing, arm_hole_finishing, bottom_finishing)
values ('RMD2501', 'Flare Cut, A-Line Cut', 'MCW0051', 'MCW0053 - Green, MCW0053 - Blue, MCW0053 - Black', 'MCW0053, MCW0053, MCW0053', 'Small, Medium, Large', 'Side pocket, side slit etc.', 'Single Overlock', 'Dori', 'Overlock', 'Dori');

-- After running this, also create a Storage bucket named "attachments"
-- (Dashboard > Storage > New bucket > name it "attachments", make it Public)
-- and create your first user accounts under Dashboard > Authentication > Users.
-- For each user you add there, run this once (swap in their real user id + details):
-- insert into profiles (id, name, role, branch) values ('paste-user-id-here', 'Jennifer', 'sales', 'Al Waab');
