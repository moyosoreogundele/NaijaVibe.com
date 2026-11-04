import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { RtcRole, RtcTokenBuilder } from "npm:agora-access-token@2.0.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function respond(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return respond(405, { error: "Method not allowed." });

  const authorization = request.headers.get("Authorization");
  const appId = Deno.env.get("AGORA_APP_ID");
  const appCertificate = Deno.env.get("AGORA_APP_CERTIFICATE");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!authorization || !appId || !appCertificate || !supabaseUrl || !supabaseAnonKey) {
    return respond(503, { error: "Live video token service is not configured." });
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return respond(401, { error: "Sign in to join a live stream." });

  let body: { channelName?: unknown; role?: unknown; uid?: unknown };
  try {
    body = await request.json();
  } catch {
    return respond(400, { error: "A valid JSON request is required." });
  }
  const { channelName, role, uid } = body;
  if (
    typeof channelName !== "string" ||
    !/^naija-[a-f0-9]{24}$/.test(channelName) ||
    (role !== "publisher" && role !== "subscriber") ||
    !Number.isSafeInteger(uid) ||
    (uid as number) < 1 ||
    (uid as number) > 2_147_483_647
  ) {
    return respond(400, { error: "Invalid channel, role, or participant ID." });
  }

  const { data: stream, error: streamError } = await supabase
    .from("live_streams")
    .select("owner_id")
    .eq("channel_name", channelName)
    .eq("status", "live")
    .maybeSingle();
  if (streamError) return respond(500, { error: "Could not verify the live room." });
  if (!stream) return respond(404, { error: "This live room has ended." });
  if (role === "publisher" && stream.owner_id !== user.id) {
    return respond(403, { error: "Only the room owner can broadcast." });
  }

  const agoraRole = role === "publisher" ? RtcRole.PUBLISHER : RtcRole.SUBSCRIBER;
  const expiresInSeconds = 60 * 60;
  const expiresAt = Math.floor(Date.now() / 1000) + expiresInSeconds;
  const token = RtcTokenBuilder.buildTokenWithUid(
    appId,
    appCertificate,
    channelName,
    uid as number,
    agoraRole,
    expiresAt,
  );
  return respond(200, { token, uid, expiresInSeconds });
});
