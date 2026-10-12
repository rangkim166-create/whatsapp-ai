import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
export const dynamic = "force-dynamic";
const engineUrl = (process.env.ENGINE_URL || "https://whatapp-ai-egine.onrender.com").replace(/\/$/, "");
const engineSecret = process.env.ENGINE_SECRET || "";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://gdmaahsxtmosuvzazdae.supabase.co";
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "";
const attempts = new Map<string, { count: number; resetAt: number }>();
function sameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  try { return new URL(origin).host === new URL(req.url).host; } catch { return false; }
}
function limited(key: string, max: number, windowMs: number) {
  const now = Date.now(); const old = attempts.get(key);
  if (!old || old.resetAt <= now) { attempts.set(key, { count: 1, resetAt: now + windowMs }); return false; }
  old.count += 1; return old.count > max;
}
async function authenticate(req: Request) {
  const authorization = req.headers.get("authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token || !supabaseKey) return null;
  const client = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } }
  });
  const { data: { user }, error } = await client.auth.getUser(token);
  return error || !user ? null : { client, user };
}
function fail(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}
export async function POST(req: Request) {
  if (!sameOrigin(req)) return fail("Invalid request origin.", 403);
  if (!engineSecret) return fail("Engine connection is not configured.", 503);
  const auth = await authenticate(req);
  if (!auth) return fail("Please sign in before connecting WhatsApp.", 401);
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (limited("connect:" + auth.user.id + ":" + ip, 5, 10 * 60 * 1000)) return fail("Too many connection attempts. Please wait 10 minutes.", 429);
  try {
    const length = Number(req.headers.get("content-length") || "0");
    if (length > 2048) return fail("Request is too large.", 413);
    const { phone, sessionId } = await req.json();
    const cleanPhone = String(phone || "").replace(/[^0-9]/g, "");
    const sid = String(sessionId || "").trim();
    if (!/^\d{8,15}$/.test(cleanPhone) || !/^[a-zA-Z0-9_-]{8,80}$/.test(sid))
      return fail("Enter your WhatsApp number with country code and try again.", 400);
    const { data: owned, error: lookupError } = await auth.client.from("whatsapp_connections").select("id,phone_number,status").eq("user_id", auth.user.id).eq("session_name", sid).maybeSingle();
    if (lookupError || !owned) return fail("This WhatsApp session does not belong to your signed-in account. Start a new connection from your workspace.", 403);
    if (owned.phone_number && String(owned.phone_number).replace(/[^0-9]/g, "") !== cleanPhone) return fail("The number does not match the saved connection.", 403);
    const upstream = await fetch(engineUrl + "/connect", { method: "POST", headers: { "content-type": "application/json", "x-engine-secret": engineSecret }, body: JSON.stringify({ phone: cleanPhone, sessionId: sid }), cache: "no-store", signal: AbortSignal.timeout(20000) });
    const result = await upstream.json().catch(() => ({}));
    if (!upstream.ok) return fail(result.error || "WhatsApp engine could not start the connection.", upstream.status);
    return NextResponse.json({ ok: true, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return fail(error instanceof Error && error.name === "SyntaxError" ? "Invalid request body." : "Connection request failed.", 502); }
}
export async function GET(req: Request) {
  if (!sameOrigin(req)) return fail("Invalid request origin.", 403);
  if (!engineSecret) return fail("Engine connection is not configured.", 503);
  const auth = await authenticate(req);
  if (!auth) return fail("Please sign in to check your WhatsApp connection.", 401);
  const sid = new URL(req.url).searchParams.get("sessionId") || "";
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(sid)) return fail("Invalid session ID.", 400);
  const { data: owned, error } = await auth.client.from("whatsapp_connections").select("id").eq("user_id", auth.user.id).eq("session_name", sid).maybeSingle();
  if (error || !owned) return fail("This session does not belong to your account.", 403);
  try {
    const upstream = await fetch(engineUrl + "/status/" + encodeURIComponent(sid), { headers: { "x-engine-secret": engineSecret }, cache: "no-store", signal: AbortSignal.timeout(10000) });
    return NextResponse.json(await upstream.json().catch(() => ({})), { status: upstream.status, headers: { "Cache-Control": "no-store" } });
  } catch { return fail("Could not check the WhatsApp engine.", 502); }
}
