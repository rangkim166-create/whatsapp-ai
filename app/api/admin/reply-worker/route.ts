import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const admins = (process.env.WORKER_DASHBOARD_ADMIN_EMAILS || "")
    .split(",").map((v) => v.trim().toLowerCase()).filter(Boolean);

  const missingConfiguration = [
    !url && "NEXT_PUBLIC_SUPABASE_URL",
    !publishableKey && "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    !serviceKey && "SUPABASE_SERVICE_ROLE_KEY",
    admins.length === 0 && "WORKER_DASHBOARD_ADMIN_EMAILS",
  ].filter(Boolean);

  if (missingConfiguration.length > 0) {
    // Report names only; never expose secret values.
    return NextResponse.json({
      error: "Server configuration incomplete",
      missingConfiguration,
    }, { status: 503 });
  }

  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ error: "Sign in required" }, { status: 401 });

  try {
    const auth = await fetch(url + "/auth/v1/user", {
      headers: { apikey: publishableKey, Authorization: "Bearer " + token },
      cache: "no-store",
    });
    if (!auth.ok) return NextResponse.json({ error: "Invalid session" }, { status: 401 });

    const user = await auth.json();
    const email = String(user.email || "").toLowerCase();
    if (!admins.includes(email)) return NextResponse.json({ error: "Admin access denied" }, { status: 403 });

    const queue = await fetch(
      url + "/rest/v1/pending_replies?select=id,status,due_at,created_at&status=eq.pending&due_at=lte." +
      encodeURIComponent(new Date().toISOString()) + "&order=due_at.asc,created_at.asc&limit=1",
      { headers: { apikey: serviceKey, Authorization: "Bearer " + serviceKey }, cache: "no-store" }
    );
    if (!queue.ok) return NextResponse.json({ error: "Queue safety check failed" }, { status: 502 });
    const rows = await queue.json();
    const targetId = "2658784e-f356-4738-aff6-551e8d99c94f";
    if (!Array.isArray(rows) || rows[0]?.id !== targetId) {
      return NextResponse.json({ error: "Safety stop: approved test reply is not the oldest due item", oldestDue: rows?.[0] ?? null }, { status: 409 });
    }

    const worker = await fetch(url + "/functions/v1/reply-worker-v2", {
      method: "POST",
      headers: { apikey: serviceKey, Authorization: "Bearer " + serviceKey, "Content-Type": "application/json" },
      body: JSON.stringify({ requestedBy: email, targetReplyId: targetId }),
      cache: "no-store",
    });
    const raw = await worker.text();
    let result: unknown = raw;
    try { result = JSON.parse(raw); } catch {}
    return NextResponse.json({ workerStatus: worker.status, result }, { status: worker.ok ? 200 : 502 });
  } catch {
    return NextResponse.json({ error: "Worker invocation failed" }, { status: 500 });
  }
}
