# Aterra Financial Control Room

Private financial operations application for Treso ONO / Aterra.

## Runtime

- Next.js on Vercel
- Clerk invitation-only authentication
- Supabase PostgreSQL and private evidence storage
- Server-enforced roles for owners, architects and accountants

## Authorized users

- Reinout — owner
- Thijs — owner
- Hidde — read-only architect

Access is enforced by both Clerk authentication and the server-side email-to-role allowlist in `lib/auth.ts`.

## Local setup

1. Copy `.env.example` to `.env.local`.
2. Add the Clerk and Supabase environment values.
3. Run `npm install`.
4. Run `npm run dev`.

Database schema changes are stored in `supabase/migrations` and must pass Supabase security and performance advisors before production use.
