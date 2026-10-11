import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";
const engineUrl = (process.env.ENGINE_URL || "https://whatapp-ai-egine.onrender.com").replace(/\/$/, "");
const engineSecret = process.env.ENGINE_SECRET || "";
// The engine secret stays server-side. Only this fixed engine is called; phone and
// session IDs are validated before forwarding, so this route is not a general proxy.
function sameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  try { return new URL(origin).host === new URL(req.url).host; } catch { return false; }
}
export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
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
  if (!sameOrigin(req)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  if (!engineSecret) return NextResponse.json({ error: "Engine connection is not configured yet." }, { status: 503 });
  const sid = new URL(req.url).searchParams.get("sessionId") || "";
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(sid)) return NextResponse.json({ error: "Invalid session ID." }, { status: 400 });
  try {
    const upstream = await fetch(engineUrl + "/status/" + encodeURIComponent(sid), { headers: { "x-engine-secret": engineSecret }, cache: "no-store", signal: AbortSignal.timeout(10000) });
    return NextResponse.json(await upstream.json().catch(() => ({})), { status: upstream.status });
  } catch { return NextResponse.json({ error: "Could not check WhatsApp connection status." }, { status: 502 }); }
}