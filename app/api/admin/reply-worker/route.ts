import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

function jsonError(message: string, status: number) {
  return NextResponse.json(
    { error: message },
    { status, headers: NO_STORE_HEADERS }
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export async function POST(req: NextRequest) {
  const supabaseUrlRaw = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const allowedAdmins = (process.env.WORKER_DASHBOARD_ADMIN_EMAILS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  const missingConfiguration = [
    !supabaseUrlRaw && "NEXT_PUBLIC_SUPABASE_URL",
    !publishableKey && "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    !serviceRoleKey && "SUPABASE_SERVICE_ROLE_KEY",
    allowedAdmins.length === 0 && "WORKER_DASHBOARD_ADMIN_EMAILS",
  ].filter((value): value is string => Boolean(value));

  if (missingConfiguration.length > 0) {
    return NextResponse.json(
      {
        error: "Server configuration incomplete",
        missingConfiguration,
      },
      { status: 503, headers: NO_STORE_HEADERS }
    );
  }

  let supabaseOrigin: string;
  try {
    const parsedUrl = new URL(supabaseUrlRaw!);
    if (parsedUrl.protocol !== "https:" && parsedUrl.hostname !== "localhost") {
      return jsonError("Invalid Supabase URL configuration", 500);
    }
    supabaseOrigin = parsedUrl.origin;
  } catch {
    return jsonError("Invalid Supabase URL configuration", 500);
  }

  const authorization = req.headers.get("authorization");
  const tokenMatch = authorization?.match(/^Bearer\s+(.+)$/i);
  const accessToken = tokenMatch?.[1]?.trim();

  if (!accessToken) {
    return jsonError("Sign in required", 401);
  }

  try {
    // Verify the actual signed-in user with Supabase Auth; never trust an email
    // supplied in the request body or a hardcoded dashboard identity.
    const authResponse = await fetch(`${supabaseOrigin}/auth/v1/user`, {
      method: "GET",
      headers: {
        apikey: publishableKey!,
        Authorization: `Bearer ${accessToken}`,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });

    if (!authResponse.ok) {
      return jsonError("Invalid session", 401);
    }

    const authPayload: unknown = await authResponse.json();
    if (!isRecord(authPayload) || typeof authPayload.email !== "string") {
      return jsonError("Verified administrator email required", 403);
    }

    const email = authPayload.email.trim().toLowerCase();
    if (!email || !allowedAdmins.includes(email)) {
      return jsonError("Admin access denied", 403);
    }

    // The worker must claim the oldest eligible queue rows atomically through
    // claim_due_pending_replies. Do not pin the run to a hardcoded test UUID or
    // pre-check the queue with a race-prone REST query.
    const workerResponse = await fetch(
      `${supabaseOrigin}/functions/v1/reply-worker-v2`,
      {
        method: "POST",
        headers: {
          apikey: serviceRoleKey!,
          Authorization: `Bearer ${serviceRoleKey!}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ requestedBy: email }),
        cache: "no-store",
        signal: AbortSignal.timeout(30000),
      }
    );

    const responseText = await workerResponse.text();
    let result: unknown = {};
    if (responseText) {
      try {
        result = JSON.parse(responseText) as unknown;
      } catch {
        result = { error: "Worker returned a non-JSON response" };
      }
    }

    if (!workerResponse.ok) {
      return NextResponse.json(
        {
          error: "Reply worker invocation failed",
          workerStatus: workerResponse.status,
          result,
        },
        { status: 502, headers: NO_STORE_HEADERS }
      );
    }

    return NextResponse.json(
      { ok: true, requestedBy: email, result },
      { status: 200, headers: NO_STORE_HEADERS }
    );
  } catch (error: unknown) {
    if (error instanceof Error && error.name === "TimeoutError") {
      return jsonError("Reply worker request timed out", 504);
    }

    console.error(
      "Reply worker route invocation failed:",
      error instanceof Error ? error.message : "Unknown error"
    );
    return jsonError("Internal server route invocation failure", 500);
  }
}
