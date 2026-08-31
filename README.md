# Moonlight Concept — Job Order System

A Sales / Production / Admin job order tracker, backed by Supabase (database +
auth + file storage) and deployable for free on Vercel.

## 1. Create a Supabase project
1. Go to https://supabase.com → sign up → "New project".
2. Once it's created, open **SQL Editor → New query**, paste the contents of
   `sql/schema.sql`, and click **Run**. This creates all the tables and seeds
   a starter branch list + one model.
3. Go to **Storage → New bucket**, name it exactly `attachments`, and make it
   **Public** (so photo/video reference links work in the app).
4. Go to **Project Settings → API**. Copy the **Project URL** and the
   **anon public** key — you'll need both next.

## 2. Create your first user accounts
1. Go to **Authentication → Users → Add user** (email + password) for each
   person who needs access (yourself as Admin first).
2. Go back to **SQL Editor** and run one insert per person, using the user id
   shown in the Authentication table:
   ```sql
   insert into profiles (id, name, role, branch)
   values ('paste-the-user-id-here', 'Jennifer', 'sales', 'Al Waab');
   ```
   `role` must be one of: `sales`, `production`, `admin`.

## 3. Run it locally (optional, to test first)
```bash
npm install
cp .env.example .env
# edit .env and paste in your Project URL + anon key
npm run dev
```
Open the local URL it prints and log in with the email/password you created.

## 4. Deploy for your team
1. Push this folder to a new GitHub repository.
2. Go to https://vercel.com → sign up (free) → **Add New Project** → import
   that GitHub repo.
3. In the import screen, add two **Environment Variables**:
   - `VITE_SUPABASE_URL` = your Project URL
   - `VITE_SUPABASE_ANON_KEY` = your anon public key
4. Click **Deploy**. Vercel gives you a live `https://...vercel.app` URL —
   share that with your team.

## Adding more users later
Repeat step 2 any time you hire someone or open a new branch: add them in
Supabase Authentication, then add their matching row in `profiles`.

## Notes / limitations
- There's no in-app "Add Users" screen — accounts are created directly in
  Supabase, which is the standard secure way to do this without exposing
  admin keys in the browser.
- Row-level security currently allows any signed-in user to read/write all
  tables; role rules (who can edit/transition what) are enforced in the app
  itself, same as the original prototype. Tightened database-level policies
  can be added later if you want a stricter guarantee.
