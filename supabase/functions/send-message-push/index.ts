import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const admin = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", { auth: { persistSession: false, autoRefreshToken: false } });

type FirebaseServiceAccount = { project_id: string; client_email: string; private_key: string };

function base64Url(value: Uint8Array | string): string {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(new RegExp("=+$"), "");
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const base64 = pem.replaceAll("-----BEGIN PRIVATE KEY-----", "").replaceAll("-----END PRIVATE KEY-----", "").replace(new RegExp(String.fromCharCode(92) + "s", "g"), "");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

async function getFirebaseAccessToken(account: FirebaseServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64Url(JSON.stringify({ iss: account.client_email, scope: "https://www.googleapis.com/auth/firebase.messaging", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }));
  const unsigned = header + "." + claim;
  const key = await crypto.subtle.importKey("pkcs8", pemToArrayBuffer(account.private_key), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned)));
  const assertion = unsigned + "." + base64Url(signature);
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=" + encodeURIComponent(assertion) });
  if (!tokenResponse.ok) throw new Error("Firebase OAuth failed: " + tokenResponse.status);
  const token = await tokenResponse.json() as { access_token?: string };
  if (!token.access_token) throw new Error("Firebase OAuth did not return an access token");
  return token.access_token;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  try {
    const authToken = req.headers.get("Authorization")?.replace(new RegExp("^Bearer" + String.fromCharCode(92) + "s+", "i"), "");
    if (!authToken) return new Response(JSON.stringify({ error: "Authentication required" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const { data: { user }, error: authError } = await admin.auth.getUser(authToken);
    if (authError || !user) return new Response(JSON.stringify({ error: "Authentication required" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const input = await req.json() as { messageId?: string; recipientId?: string };
    if (!input.messageId || !input.recipientId) throw new Error("messageId and recipientId are required");
    const { data: message } = await admin.from("messages").select("id, sender_id, receiver_id, content, media_type").eq("id", input.messageId).maybeSingle();
    if (!message || message.sender_id !== user.id || message.receiver_id !== input.recipientId) throw new Error("Message not found");
    const { data: sender } = await admin.from("profiles").select("username").eq("id", user.id).maybeSingle();
    const { data: tokens } = await admin.from("push_tokens").select("token").eq("user_id", input.recipientId);
    const accountJson = Deno.env.get("FIREBASE_SERVICE_ACCOUNT_JSON");
    if (!accountJson || !tokens?.length) return new Response(JSON.stringify({ delivered: false, reason: !accountJson ? "FIREBASE_SERVICE_ACCOUNT_JSON is not configured" : "No registered devices" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const account = JSON.parse(accountJson) as FirebaseServiceAccount;
    const accessToken = await getFirebaseAccessToken(account);
    const text = message.content || (message.media_type === "audio" ? "🎤 Voice message" : message.media_type === "image" ? "📷 Photo" : "📎 Attachment");
    const senderUsername = sender?.username || "";
    const data = {
      chat_id: message.sender_id,
      message_id: message.id,
      sender_username: senderUsername,
      body: text,
      url: senderUsername ? "/messages/" + encodeURIComponent(senderUsername) : "/messages",
    };
    const results = await Promise.all(tokens.map(async item => {
      const response = await fetch("https://fcm.googleapis.com/v1/projects/" + account.project_id + "/messages:send", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + accessToken }, body: JSON.stringify({ message: { token: item.token, data, android: { priority: "HIGH", ttl: "2419200s" } } }) });
      return response.ok;
    }));
    return new Response(JSON.stringify({ delivered: results.some(Boolean), devices: results.length, successful: results.filter(Boolean).length }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Push failed" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
