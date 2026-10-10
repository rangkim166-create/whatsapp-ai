import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://gdmaahsxtmosuvzazdae.supabase.co";
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_-iuOOsmsQGxDcj-UjOu6cQ_1HKUZt6G";
const db = createClient(supabaseUrl, supabaseKey);
const engineUrl = process.env.ENGINE_URL || "https://whatapp-ai-egine.onrender.com";
const engineSecret = process.env.ENGINE_SECRET || "";

function authToken(req: NextRequest) {
  const header = req.headers.get("authorization") || "";
  return header.startsWith("Bearer ") ? header.slice(7) : "";
}
async function currentUser(req: NextRequest) {
  const token = authToken(req);
  if (!token) return null;
  const { data, error } = await db.auth.getUser(token);
  return error ? null : data.user;
}
function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}
export async function POST(req: NextRequest) {
  const user = await currentUser(req);
  if (!user) return json({ error: "Sign in first, then connect WhatsApp." }, 401);
  if (!engineSecret) return json({ error: "WhatsApp connection is not configured yet. The site administrator must add ENGINE_SECRET in Vercel." }, 503);
  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Invalid request." }, 400); }
  const phone = String(body?.phone || "").replace(/[^0-9]/g, "");
  if (!/^\d{8,15}$/.test(phone)) return json({ error: "Enter the WhatsApp number with country code, numbers only. Example: 2567XXXXXXXX." }, 400);

  const sessionName = "wa-" + user.id.replace(/-/g, "").slice(0, 18);
  const headers = { "content-type": "application/json", "x-engine-secret": engineSecret };
  try {
    const start = await fetch(engineUrl.replace(/\/$/, "") + "/connect", {
      method: "POST", headers, body: JSON.stringify({ sessionId: sessionName, phone }), cache: "no-store"
    });
    const result = await start.json().catch(() => ({}));
    if (!start.ok || !result?.ok) return json({ error: result?.error || "The WhatsApp engine could not start the connection." }, start.status || 502);

    const existing = await db.from("whatsapp_connections").select("id").eq("user_id", user.id).eq("session_name", sessionName).maybeSingle();
    if (existing.error) return json({ error: "Could not check your saved WhatsApp connection: " + existing.error.message }, 500);
    const values = { user_id: user.id, session_name: sessionName, phone_number: phone, status: result.status || "connecting", updated_at: new Date().toISOString() };
    const saved = existing.data
      ? await db.from("whatsapp_connections").update(values).eq("id", existing.data.id)
      : await db.from("whatsapp_connections").insert({ ...values, ai_takeover: false, scope: "all" });
    if (saved.error) {
      await fetch(engineUrl.replace(/\/$/, "") + "/disconnect", { method: "POST", headers, body: JSON.stringify({ sessionId: sessionName }), cache: "no-store" }).catch(() => null);
      return json({ error: "WhatsApp started, but the connection could not be saved: " + saved.error.message }, 500);
    }
    return json({ ok: true, sessionId: sessionName, phone, status: result.status || "connecting", pairingCode: result.pairingCode || null });
  } catch {
    return json({ error: "Could not reach the WhatsApp engine. It may be waking up; wait a moment and retry." }, 502);
  }
}
export async function GET(req: NextRequest) {
  const user = await currentUser(req);
  if (!user) return json({ error: "Sign in first." }, 401);
  if (!engineSecret) return json({ error: "WhatsApp connection is not configured yet." }, 503);
  const { data: row, error } = await db.from("whatsapp_connections")
    .select("id,session_name,phone_number,status,ai_takeover,scope")
    .eq("user_id", user.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) return json({ error: error.message }, 500);
  if (!row) return json({ connected: false });
  try {
    const r = await fetch(engineUrl.replace(/\/$/, "") + "/status/" + encodeURIComponent(row.session_name), {
      headers: { "x-engine-secret": engineSecret }, cache: "no-store"
    });
    const state = await r.json().catch(() => ({}));
    if (r.ok && state?.status) {
      await db.from("whatsapp_connections").update({ status: state.status, updated_at: new Date().toISOString() }).eq("id", row.id);
      return json({ connected: true, ...row, status: state.status, pairingCode: state.pairingCode || null, lastError: state.lastError || null });
    }
    return json({ connected: true, ...row, lastError: state?.error || null });
  } catch {
    return json({ connected: true, ...row, lastError: "Engine is temporarily unreachable." });
  }
}
