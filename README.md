# GameOn

Multi-tenant management platform for sports venues (pickleball, badminton, tennis and similar).
Venue owners set up their facility, sports, courts, operating hours and pricing, take bookings from every channel
(walk-in, phone, WhatsApp, GameOn, Playo, District), track payments, and invite staff with role-based permissions.

## Features

- **Accounts:** email and password sign-up with email verification, password reset by code, and staff invitations
- **Venue onboarding:** a guided setup (facility → sports → hours → courts → pricing → review), editable later under Venue Settings
- **Bookings:**
  - create, edit, reschedule, cancel or reinstate, check in, complete
  - prices calculated from your pricing rules (or set by hand)
  - search, filters and CSV export
- **Double-booking protection:** a per-court lock inside a transaction on the server, plus a PostgreSQL exclusion constraint
- **Walk-ins and payments:** cash, UPI, card or other methods; partial payments and refunds; payment history on each booking
- **Booking calendar:** Day, Week and Month views; courts loaded from the database; maintenance blocks; closed hours shaded; times in the venue's time zone
- **Dashboard:**
  - collected revenue (from payment records) kept separate from gross booked value
  - occupancy, pending payments, cancellations
  - online vs offline split, revenue by sport and by court, trends
  - date ranges: today, this week, this month or custom
- **Memberships:** monthly or yearly plans (optionally for one sport) sold at the front desk, with full or partial payment. Members play free: staff pick "Member" when booking a walk-in or phone call, and the court time is covered as long as the membership is valid on that date.
- **Classes:** coaching or group classes with a coach, courts, days, times and a term. Every session reserves its courts automatically, using the same no-overlap protection as bookings. Clashes with existing bookings are listed before anything is saved. Includes enrolment with capacity limits and per-month or per-term fees.
- **Team and permissions:** three levels, enforced on the server:
  | | Owner | Manager | Employee |
  |---|---|---|---|
  | Calendar and bookings (create, check in, take payments) | ✓ | ✓ | ✓ |
  | Dashboard, revenue and reports | ✓ | ✓ | – |
  | Refunds | ✓ | ✓ | – |
  | Venue settings (facility, sports, courts, hours, pricing) | ✓ | ✓ | – |
  | Invite and remove employees | ✓ | ✓ | – |
  | Add or remove managers, create custom roles | ✓ | – | – |
  | Change past bookings (cancel, reschedule, edit, refund) | Any date | Up to 7 days back | Today onwards only |

  Check-in is only possible on the day of the booking. Recording a payment that's still owed is allowed on any booking.

  Manager and Employee are built-in roles on every venue. Owners can also create custom roles with `none`, `view` or `edit` on bookings, venue, reports, billing and team.

## Tech stack

| Area | Choice |
|---|---|
| Framework | Next.js 15 (App Router), React 19, TypeScript |
| Styling | Tailwind CSS 4, lucide-react icons, sonner toasts |
| Data | PostgreSQL, Prisma 6 (migrations) |
| Auth | NextAuth v5 (credentials, JWT sessions) |
| Charts | Recharts |
| Media / email | Cloudinary (images), Nodemailer over Gmail (emails) |
| Tests | Vitest (unit and database integration tests) |

## Project structure

```
app/
  (auth)/            login, signup, verify-email, forgot-password, join (invite)
  (onboarding)/      venue setup wizard
  (app)/             signed-in app: dashboard, calendar, bookings, venue settings, settings
  api/               route handlers (bookings, court-blocks, dashboard, venues, auth, onboarding, ...)
components/
  bookings/          bookings screen, booking form, details panel, shared client helpers
  calendar/          booking calendar (day / week / month)
  dashboard/         dashboard screen
  members/           members and membership plans
  classes/           coaching classes and enrolments
  club/              player picker shared by members, classes and bookings
  settings/          account, team and roles settings
  brand/             logo
hooks/               client hooks (use-permissions)
lib/
  team/              built-in roles (Manager, Employee) and team rules
  club/              memberships, classes, enrolments, schedules
  booking/           booking engine: time zones, pricing, availability, validation,
                     access control, service (transactions), queries, dashboard metrics
  db.ts, mail.ts, cloudinary.ts, permissions.ts, slug.ts
prisma/
  schema.prisma      data model
  migrations/        SQL migrations (incl. no-overlap exclusion constraints)
scripts/
  demo-seed.mjs      adds/resets a demo venue in your local database
tests/
  unit/              pure logic (pricing, time zones, validation, metrics)
  integration/       booking engine + API routes against a real Postgres test database
auth.ts, auth.config.ts, middleware.ts   NextAuth setup and route protection
```

## Getting started

### Prerequisites
- Node.js 20+
- pnpm 9 (`npm i -g pnpm`)
- PostgreSQL 15+ running locally (it must provide the `btree_gist` extension, which standard installs include)

### 1. Install
```bash
pnpm install
```

### Databases at a glance

| Database | Used by | Notes |
|---|---|---|
| `gameon` (local) | `pnpm dev`, `pnpm demo:seed`, your manual testing | Persistent. Accounts you sign up with locally live here. |
| `gameon_test` (local) | `pnpm test` only | **Wiped on every test run.** Don't sign in to it by hand. |
| Neon (hosted) | Production deployment only | Credentials live in the hosting provider's env vars, never in this folder. |

### Environment files

| File | Committed? | Purpose |
|---|---|---|
| `.env.local.example` | Yes | Template listing every variable, with placeholder values |
| `.env.local` | **No** (git-ignored) | Your local settings and secrets (local `gameon` database). Next.js and the `db:*` scripts read it. |
| `.env` | **No** (git-ignored) | Neon (production) database URL and credentials |

`.env.local` takes priority over `.env`, so `pnpm dev` always uses your local database.
**Careful:** a bare `npx prisma ...` command reads `.env` and would therefore run against **Neon production**.
Use the `pnpm db:*` scripts for local work.

### 2. Configure the environment
```bash
cp .env.local.example .env.local
```
Fill in `.env.local`:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string, e.g. `postgresql://USER:PASSWORD@localhost:5432/gameon` |
| `NEXTAUTH_SECRET` | Random secret, generate with `openssl rand -base64 32` |
| `NEXTAUTH_URL` | App URL, `http://localhost:3000` in development |
| `CLOUDINARY_*`, `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME` | Image uploads (logos, covers, court photos) |
| `EMAIL_USER`, `EMAIL_PASS` | Gmail address and app password for verification and invite emails |

Never commit `.env` or `.env.local`; both are git-ignored.

### 3. Create the database and apply migrations
```bash
createdb gameon
```
```bash
pnpm db:migrate:deploy
```

### 4. Run
```bash
pnpm dev
```
Open http://localhost:3000, sign up, and complete the venue setup.

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Start the dev server (port 3000) |
| `pnpm build` / `pnpm start` | Production build and serve |
| `pnpm test` | All tests (unit and integration) |
| `pnpm test:unit` | Unit tests only (no database needed) |
| `pnpm db:migrate:deploy` | Apply pending migrations to the database in `.env.local` |
| `pnpm db:migrate` | Create a new migration during development (`prisma migrate dev`) |
| `pnpm db:studio` | Open Prisma Studio |
| `pnpm demo:seed` | Add or reset the demo venue in your local database |

The `db:*` scripts load `.env.local` explicitly. Always use them rather than a bare `npx prisma ...`.

## Testing

Automated tests use a **separate** local database, `gameon_test`. Its URL comes from your `.env.local`
(same credentials, database name swapped), and the tests refuse to run against any other database or a
non-local host. They truncate tables on every run, so never keep data you care about there.

One-time setup (replace `USER:PASSWORD` with the credentials from your `.env.local`):
```bash
createdb gameon_test
```
```bash
DATABASE_URL="postgresql://USER:PASSWORD@localhost:5432/gameon_test" npx prisma migrate deploy
```
Then:
```bash
pnpm test
```

## Demo data

```bash
pnpm demo:seed
```
This adds a ready-made demo venue (3 courts, sample bookings and a maintenance block, in Phoenix time) to your **local** `gameon`
database. Then run `pnpm dev` and sign in with the demo logins listed at the top of `scripts/demo-seed.mjs`: one owner, one manager and one employee, so you can compare what each role sees.
Re-running it resets only the demo venue and demo accounts; your other data is untouched. It refuses to run against a non-local database.

## Deployment notes

- The schema is managed with **Prisma migrations** (`prisma/migrations`). The `1_phase1_booking_engine` migration adds raw-SQL exclusion
  constraints that `prisma db push` can't express, so always deploy with `prisma migrate deploy`.
- For a database that was originally created with `db push` (before migrations existed):
  1. Check that it matches the baseline: `prisma migrate diff --from-url "$DATABASE_URL" --to-migrations prisma/migrations` (it should show only migration 1's changes).
  2. Mark the baseline as applied: `prisma migrate resolve --applied 0_init`.
  3. Run `prisma migrate deploy`.
- Set each venue's time zone and currency under **Venue Settings → Facility**. All booking times and dashboard figures use them.
