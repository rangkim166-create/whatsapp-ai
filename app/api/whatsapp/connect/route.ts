import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
export const dynamic = "force-dynamic";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://gdmaahsxtmosuvzazdae.supabase.co";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "";
const engineUrl = (process.env.ENGINE_URL || "https://whatapp-ai-egine.onrender.com").replace(/\/$/, "");
const engineSecret = process.env.ENGINE_SECRET || "";
async function authUser(req: Request) {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token || !anonKey) return null;
  const client = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.getUser(token);
  return error ? null : data.user;
}
export async function POST(req: Request) {
  const user = await authUser(req);
  if (!user) return NextResponse.json({ error: "Please sign in again before connecting WhatsApp." }, { status: 401 });
  if (!engineSecret) return NextResponse.json({ error: "Engine connection is not configured yet." }, { status: 503 });
  try {
    const { phone, sessionId } = await req.json();
    const cleanPhone = String(phone || "").replace(/[^0-9]/g, "");
    const sid = String(sessionId || "").trim();
    if (!/^\d{8,15}$/.test(cleanPhone) || !/^[a-zA-Z0-9_-]{8,80}$/.test(sid))
      return NextResponse.json({ error: "Enter the WhatsApp number with country code and try again." }, { status: 400 });
    const upstream = await fetch(engineUrl + "/connect", { method: "POST", headers: { "content-type": "application/json", "x-engine-secret": engineSecret }, body: JSON.stringify({ phone: cleanPhone, sessionId: sid }), cache: "no-store", signal: AbortSignal.timeout(20000) });
    const result = await upstream.json().catch(() => ({}));
    if (!upstream.ok) return NextResponse.json({ error: result.error || "WhatsApp engine could not start the connection." }, { status: upstream.status });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Connection request failed." }, { status: 502 }); }
}
export async function GET(req: Request) {
  const user = await authUser(req);
  if (!user) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  if (!engineSecret) return NextResponse.json({ error: "Engine connection is not configured yet." }, { status: 503 });
  const sid = new URL(req.url).searchParams.get("sessionId") || "";
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(sid)) return NextResponse.json({ error: "Invalid session ID." }, { status: 400 });
  try {
    const upstream = await fetch(engineUrl + "/status/" + encodeURIComponent(sid), { headers: { "x-engine-secret": engineSecret }, cache: "no-store", signal: AbortSignal.timeout(10000) });
    return NextResponse.json(await upstream.json().catch(() => ({})), { status: upstream.status });
  } catch { return NextResponse.json({ error: "Could not check WhatsApp connection status." }, { status: 502 }); }
}