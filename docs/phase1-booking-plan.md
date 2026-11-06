# GameOn Phase 1: Audit and Implementation Plan

Status: **draft, waiting for approval of the schema changes in section 3.**
Audit date: 2026-11-05.

## 1. Audit findings

### Environment and database
- Next.js loads `.env.local` ahead of `.env`, so the app uses **local Postgres 17 (`localhost:5432`)**.
  `.env` points to **Neon** (AWS us-east-1). Running the Prisma CLI without `dotenv -e .env.local` would hit Neon.
  This work will only use `pnpm db:*` scripts (which load `.env.local`) and will never touch Neon.
- The schema is managed with `prisma db push`. There is **no `prisma/migrations` folder**.
- Local data: 1 venue (Chandler, AZ, US), 2 sports (Badminton, Pickleball), 2 courts, 3 pricing rules,
  842 bookings from `prisma/seed-bookings.ts`, 0 walk-ins, 1 venue member, 2 users.
- Of the 842 bookings, **0 non-cancelled pairs overlap**, so a DB overlap constraint can be added without touching data.
- The `btree_gist` extension is available but not installed.
- `Booking.startTime` and `endTime` are `timestamp(3) without time zone`. Prisma stores them as UTC instants.

### Models already in place
| Model | Notes |
|---|---|
| `Booking` | venueId, courtId, customer, phone, `sport` (free text, not linked to `Sport`), start/end, `amountUsd`, `payment` (PENDING/PAID/REFUNDED), `status` (PENDING/CONFIRMED/CHECKED_IN/COMPLETED/CANCELLED), notes. **Missing:** source, email, sport link, payment method, payment history, cancel info, created-by. |
| `WalkInBooking` | A separate table with no status or payment fields, 0 rows, and no code uses it. |
| `PricingRule` | Sport-level (or court-level) rules: `days` stored as `"Monday,Tuesday"`, times stored as `"6:00 AM"` strings, `priceUsd` (taken to be **per hour**). |
| `OperatingHours` | Per sport and day, stored as `"8:00 AM"` strings, with `isClosed`. |
| `Court` | `isActive` and `isAvailable` fields, linked to a sport. |
| `Venue` | **Has no timezone field.** |

### APIs
- `GET/POST /api/bookings` and `GET/POST /api/courts` check that the user owns the venue or is an active member.
  They **ignore the role permissions**: a member with `bookings: none` can still read and create bookings.
  There's no input validation and no overlap check, and `?date=` filters by server-local midnight.
- Venue settings routes (`/api/venues/[id]/*`) are limited to the owner and save by "delete all, recreate".
- **Existing bug:** `POST /api/venues/[id]/courts` deletes every court before recreating it. `Booking.courtId` uses the
  default `Restrict` delete rule, so with bookings present, **saving courts on `/venue/courts` fails**, and it would orphan court IDs anyway.
  This has to be fixed (upsert by ID, deactivate removed courts), or bookings and venue editing can't coexist.

### Auth and permissions
- JWT sessions carry `venueId` and `venuePermissions` (`bookings`, `venue`, `reports`, `billing`, `team`, each `none`/`view`/`edit`),
  refreshed from the DB every 60 seconds (`auth.ts`).
- `usePermissions()` treats `role === 'VENUE_OWNER'` as owner. `/api/auth/register` gives **every** self-registered user that role,
  so an invited staff member who signed up independently looks like an owner in the UI. Server-side checks will
  work out ownership from `Venue.ownerId` and never trust the role.
- `middleware.ts` skips `/api/*`, so each route must check auth itself (as they already do).

### Frontend
- `components/ui/*` (48 shadcn components) is **unused**. Screens use hand-written Tailwind, inline green gradients and `lucide-react`.
  The new UI will follow that hand-written style and won't adopt the unused kit.
- `calendar-screen.tsx` uses hardcoded courts, in-memory bookings and decorative Day/Week/Month buttons.
- `bookings-screen.tsx` has an empty array, filters that do nothing, and an Export button with no handler.
- `dashboard-screen.tsx` shows hardcoded `$0` and `0` values and empty charts.
- There's no test framework, no toast setup in use (`sonner` is installed), and no shared fetch or validation helper.

## 2. What gets reused vs changed
- **Reuse:** the `Booking` table (extended, not replaced), `PricingRule`, `OperatingHours`, `Court`, `Sport`, the auth/JWT setup,
  `lib/permissions.ts` (`can()`), the existing screens' layout and styles, Recharts, and `sonner` for toasts (already a dependency).
- **New shared server code:** `lib/booking/` with pure, unit-tested modules:
  - `time.ts`: venue-timezone conversion using `Intl` (no new dependency)
  - `pricing.ts`: rule matching and pro-rated price per hour
  - `availability.ts`: overlap rules
  - `validation.ts`: input validation
  - `access.ts`: venue access and permission checks from the DB
- **Modify:** `/api/bookings` (validation, permissions, filters, overlap checking), `/api/venues/[id]/courts` (upsert fix),
  the three screens.

## 3. Proposed schema changes (all additive, nothing dropped)
1. **`Venue.timezone String @default("UTC")`**, with the existing venue backfilled to `America/Phoenix` (from its city).
   *Why:* the calendar, "today" and operating hours have to be measured in venue-local time, and nothing stores the zone today.
2. **`Booking` new columns:** `source BookingSource` (WALK_IN, PHONE, WHATSAPP, GAMEON, PLAYO, DISTRICT, OTHER;
   existing rows → OTHER), `email String?`, `sportId String?` (FK to `Sport`, keeping the `sport` text for old rows),
   `cancelledAt`, `cancelReason`, `createdById`.
   *Why:* the brief needs the booking source, and sport filtering needs a real foreign key.
3. **New `Payment` table:** bookingId, amount, `method` (CASH, UPI, CARD, BANK_TRANSFER, ONLINE, OTHER),
   `kind` (PAYMENT or REFUND), receivedAt, recordedById, note.
   *Why:* "collected revenue must use actual payment records". `Booking.payment` stays as the summary status,
   updated from the payment rows. Gross = booked value of non-cancelled bookings. Collected = payments − refunds.
   Existing seeded `PAID`/`REFUNDED` rows get one matching backfilled payment row (method OTHER) so the history stays consistent.
4. **New `CourtBlock` table:** courtId, start, end, reason, createdById. Used for maintenance or unavailable slots.
5. **Walk-ins live in `Booking` with `source = WALK_IN`** instead of the separate `WalkInBooking` table.
   *Why:* a single table is what lets PostgreSQL enforce no-overlap across *all* bookings. `WalkInBooking` has 0 rows
   and no code uses it. It will be left in place (not dropped) and marked deprecated, to be dropped later only with your approval.
6. **Integrity constraints (raw SQL in a migration):**
   - `CREATE EXTENSION btree_gist`
   - `CHECK ("endTime" > "startTime")` on Booking and CourtBlock
   - `EXCLUDE USING gist ("courtId" WITH =, tsrange("startTime","endTime",'[)') WITH &&) WHERE (status <> 'CANCELLED')` on Booking
   - The same exclusion on CourtBlock

### Moving from `db push` to migrations
Prisma can't express the exclusion constraints, and `db push` wouldn't apply or keep them.
Plan: generate a **baseline** migration from the current schema, mark it as already applied on the local DB
(`prisma migrate resolve --applied`, which changes no data), then add one additive migration with the changes above.
**Neon is not touched.** Deploying there later means running `migrate resolve` (baseline) and then `migrate deploy`, which is documented and left to you.

## 4. Preventing double bookings (server-side)
Every create, reschedule and reactivate runs in one transaction that:
1. Takes `pg_advisory_xact_lock` on the court, so concurrent writes for the same court run one after another.
2. Checks for overlapping non-cancelled bookings and `CourtBlock`s, plus operating hours and court `isActive`/`isAvailable`.
   Any conflict returns **409** with the clashing booking's time and court (no customer details).
3. Inserts or updates the row.

The exclusion constraint is a backstop: if anything skips the lock, Postgres rejects the write (SQLSTATE 23P01),
and the API maps that to the same 409. Cancelling just changes the status, which frees the slot immediately because of the `WHERE` clause.

## 5. Permissions (server-side, worked out from the DB)
| Action | Required |
|---|---|
| List or view bookings, calendar | owner, or `bookings: view` |
| Create, edit, reschedule, cancel, check in, record payment, block a court | owner, or `bookings: edit` |
| Record a refund | owner, or `billing: edit` |
| Dashboard revenue figures | owner, or `reports: view` (occupancy and counts need `bookings: view`) |

Customer phone and email are left out of list and calendar responses for viewers without `bookings: edit`,
and are never included in dashboard responses.

## 6. Endpoints
- `GET /api/bookings`: filters (from/to date, courtId, sportId, source, status, payment, q), pagination
- `POST /api/bookings`: create, with the price worked out on the server unless overridden (recorded as an override)
- `GET/PATCH /api/bookings/[id]`: details, edit, reschedule, status changes (cancel, check in, complete)
- `POST /api/bookings/[id]/payments`: record a payment or refund
- `GET /api/bookings/quote`: price and availability preview for a slot
- `GET/POST/DELETE /api/court-blocks`: maintenance and unavailable blocks
- `GET /api/dashboard`: metrics for today, this week, this month or a custom range, in venue time

## 7. UI
- **Calendar:** Day/Week/Month views, court columns loaded from the DB, sport and court filters, booking blocks coloured by status,
  maintenance blocks, closed hours shaded, click a slot to create, and a details drawer with edit, reschedule, cancel and payment.
- **Bookings:** server-side search and filters, pagination, details, edit, cancel and CSV export of the current filter.
- **Dashboard:** real metrics, a date-range picker, gross vs collected revenue, a trend chart, revenue by sport and by court,
  online vs offline split, cancellations, upcoming and recent bookings.
- One shared `BookingForm` modal is used for new bookings, walk-ins (which pre-fill now and source = Walk-in, with a payment method) and edits.

## 8. Tests
- Vitest (one dev dependency) for the pure modules: pricing, time zones, overlap and validation.
- Integration tests against a **separate local database `gameon_test`**:
  - concurrent creates for the same slot (exactly one succeeds)
  - cancel frees the slot
  - reschedule into a conflict
  - venue isolation
  - staff permission checks
  - revenue totals

## 9. Not in this phase
- A booking flow for players
- Real payment gateways
- Aggregator API sync (Playo and District bookings are entered by hand with the source tag)
- Sending notifications
- Recurring bookings
