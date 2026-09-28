# WhatsApp AI

Standalone WhatsApp AI dashboard.

Architecture: Next.js/Vercel frontend + Supabase Auth/Postgres/RLS/Edge Functions + WAHA on a persistent VPS.

This project is separate from AshMediaBoost.

## Environment

Copy .env.example to .env.local and add the Supabase anon key. Never commit secrets.

## Current foundation

- Personal and Business modes
- Personal relationship controls: Lover, Crush, Family, Friend
- All-chat or selected-contact scope
- 10-second human-reply window concept
- Supabase project reserved for this app only
- WAHA planned as the persistent WhatsApp session layer

The backend schema and Edge Functions are being built separately in Supabase.