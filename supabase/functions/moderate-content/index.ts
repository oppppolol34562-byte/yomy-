import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const MAX_SAFETY_CHECK_MS = 15000;
const MAX_MEDIA_BYTES = 20 * 1024 * 1024;
const GEMINI_MODEL = Deno.env.get("GEMINI_MODEL") || "gemini-2.5-flash";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

type ModerationStatus = "safe" | "review" | "rejected" | "timeout" | "error" | "duplicate";
type ModerationResult = {
  status: ModerationStatus;
  safe: boolean;
  score: number;
  categories: Record<string, number>;
  reason?: string;
  checked_at: string;
  provider: string;
  duration_ms: number;
  error_code?: string;
};
type ModerationRequest = {
  mediaUrl: string;
  mediaType?: "image" | "video";
  postId: string;
  storagePath?: string;
  contentText?: string;
};
type PreparedMedia = { base64: string; mimeType: string; hash: string };

const admin = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  { auth: { persistSession: false, autoRefreshToken: false } },
);

function resultBase(startedAt: number, provider: string) {
  return { checked_at: new Date().toISOString(), provider, duration_ms: Math.max(0, Date.now() - startedAt) };
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  return btoa(binary);
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function prepareMedia(mediaUrl: string, mediaType: "image" | "video"): Promise<PreparedMedia> {
  const response = await fetch(mediaUrl);
  if (!response.ok) throw new Error("MEDIA_FETCH_FAILED");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.byteLength) throw new Error("EMPTY_MEDIA");
  if (bytes.byteLength > MAX_MEDIA_BYTES) throw new Error("MEDIA_TOO_LARGE");
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return {
    base64: bytesToBase64(bytes),
    mimeType: response.headers.get("content-type")?.split(";")[0] || (mediaType === "video" ? "video/mp4" : "image/jpeg"),
    hash: bytesToHex(new Uint8Array(digest)),
  };
}

function duplicateResult(startedAt: number): ModerationResult {
  return { status: "duplicate", safe: false, score: 0, categories: {}, reason: "This media has already been uploaded.", ...resultBase(startedAt, "yomy-deduplication"), error_code: "DUPLICATE_MEDIA" };
}

async function stampAndCheckDuplicate(postId: string, userId: string, mediaHash: string, mediaType: "image" | "video"): Promise<boolean> {
  const { data: fingerprint, error: lookupError } = await admin
    .from("media_fingerprints")
    .select("media_hash, first_post_id")
    .eq("media_hash", mediaHash)
    .maybeSingle();
  if (lookupError) throw lookupError;
  if (fingerprint && fingerprint.first_post_id !== postId) return true;

  if (!fingerprint) {
    const { error: fingerprintError } = await admin.from("media_fingerprints").insert({
      media_hash: mediaHash,
      first_post_id: postId,
      media_type: mediaType,
      decision: "pending",
    });
    if (fingerprintError) {
      if (fingerprintError.code === "23505") return true;
      throw fingerprintError;
    }
  }

  const { error: stampError } = await admin.from("posts").update({ media_hash: mediaHash }).eq("id", postId).eq("user_id", userId);
  if (stampError) throw stampError;
  return false;
}

async function analyzeMedia(prepared: PreparedMedia, mediaType: "image" | "video", contentText: string): Promise<ModerationResult> {
  const startedAt = Date.now();
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) throw new Error("GEMINI_API_KEY_NOT_CONFIGURED");
  const prompt = [
    "You are YOMY's strict internal safety moderator.",
    "Analyze the attached image or video and the optional text.",
    "Return ONLY valid JSON with this exact shape:",
    '{"decision":"Safe"|"Unsafe","reason":"short reason","categories":{"violence":true|false,"hate":true|false,"nudity":true|false,"murder_incitement":true|false}}',
    "Return Unsafe if the media or text contains violence, graphic violence, hate or hateful symbols, nudity or sexual content, or encouragement/incitement to kill or murder.",
    "If any listed prohibited category is clearly present, choose Unsafe.",
    "Media type: " + mediaType,
    "Optional text: " + (contentText.trim() || "(none)"),
  ].join("\n");
  const response = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/" + GEMINI_MODEL + ":generateContent?key=" + encodeURIComponent(apiKey),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: prepared.mimeType, data: prepared.base64 } }] }],
        generationConfig: { temperature: 0, responseMimeType: "application/json" },
      }),
      signal: AbortSignal.timeout(MAX_SAFETY_CHECK_MS),
    },
  );
  if (!response.ok) throw new Error("GEMINI_API_ERROR_" + response.status);
  const payload = await response.json();
  const rawText = payload.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text || "").join("").trim();
  if (!rawText) throw new Error("GEMINI_EMPTY_RESPONSE");
  const fence = String.fromCharCode(96).repeat(3);
  const parsed = JSON.parse(rawText.replace(new RegExp("^" + fence + "json\\s*", "i"), "").replace(new RegExp("\\s*" + fence + "$"), ""));
  const decision = String(parsed.decision || "").toLowerCase();
  if (decision !== "safe" && decision !== "unsafe") throw new Error("GEMINI_INVALID_DECISION");
  const categories = Object.fromEntries(Object.entries(parsed.categories || {}).map(([key, value]) => [key, value === true ? 1 : value === false ? 0 : Number(value) || 0]));
  const isSafe = decision === "safe";
  return {
    status: isSafe ? "safe" : "rejected",
    safe: isSafe,
    score: Math.max(0, ...Object.values(categories)),
    categories,
    reason: String(parsed.reason || (isSafe ? "No prohibited content detected." : "Prohibited content detected.")),
    ...resultBase(startedAt, "gemini-" + GEMINI_MODEL),
  };
}

function timeoutResult(): ModerationResult {
  return { status: "timeout", safe: false, score: 0, categories: {}, reason: "Safety check is still running.", checked_at: new Date().toISOString(), provider: "yomy-safety-pipeline", duration_ms: MAX_SAFETY_CHECK_MS, error_code: "SAFETY_CHECK_TIMEOUT" };
}

function errorResult(startedAt: number, errorCode: string): ModerationResult {
  return { status: "error", safe: false, score: 0, categories: {}, ...resultBase(startedAt, "yomy-safety-pipeline"), error_code: errorCode };
}

function storagePathFromUrl(mediaUrl: string): string | null {
  const marker = "/storage/v1/object/public/posts/";
  const index = mediaUrl.indexOf(marker);
  return index >= 0 ? decodeURIComponent(mediaUrl.slice(index + marker.length).split("?")[0]) : null;
}

async function deletePostAndMedia(postId: string, userId: string, mediaUrl: string, storagePath?: string) {
  const objectPath = storagePath || storagePathFromUrl(mediaUrl);
  if (objectPath) {
    const { error } = await admin.storage.from("posts").remove([objectPath]);
    if (error) console.error("Rejected media cleanup failed:", error.message);
  }
  const { error } = await admin.from("posts").delete().eq("id", postId).eq("user_id", userId);
  if (error) throw error;
}

async function persistResult(postId: string, userId: string, result: ModerationResult, storagePath?: string) {
  const { data: post, error: readError } = await admin.from("posts").select("id, user_id, media_url, media_hash, publish_requested").eq("id", postId).eq("user_id", userId).maybeSingle();
  if (readError) throw readError;
  if (!post) return;
  if (post.media_hash && result.status !== "duplicate") {
    await admin.from("media_fingerprints").update({ decision: result.status }).eq("media_hash", post.media_hash);
  }
  if (result.status === "rejected" || result.status === "duplicate") {
    await deletePostAndMedia(postId, userId, post.media_url, storagePath);
    return;
  }
  const isSafe = result.status === "safe";
  const { error: updateError } = await admin.from("posts").update({
    moderation_status: isSafe ? "safe" : result.status === "review" ? "review" : "pending",
    moderation_result: result,
    moderated_at: result.status === "timeout" || result.status === "error" ? null : result.checked_at,
    status: isSafe ? (post.publish_requested ? "published" : "ready") : "moderation",
    published_at: isSafe && post.publish_requested ? new Date().toISOString() : null,
  }).eq("id", postId).eq("user_id", userId);
  if (updateError) throw updateError;
}

async function processModeration(request: ModerationRequest, userId: string): Promise<ModerationResult> {
  const startedAt = Date.now();
  const mediaType = request.mediaType === "video" ? "video" : "image";
  const prepared = await prepareMedia(request.mediaUrl, mediaType);
  if (await stampAndCheckDuplicate(request.postId, userId, prepared.hash, mediaType)) return duplicateResult(startedAt);
  return analyzeMedia(prepared, mediaType, request.contentText || "");
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  let moderationPostId = '';
  let moderationUserId = '';
  let moderationStoragePath: string | undefined;
  try {
    const accessToken = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
    if (!accessToken) return json({ error: "Authentication required" }, 401);
    const { data: { user }, error: authError } = await admin.auth.getUser(accessToken);
    if (authError || !user) return json({ error: "Authentication required" }, 401);
    moderationUserId = user.id;
    const input = await req.json() as Partial<ModerationRequest>;
    if (!input.postId || !input.mediaUrl) return json({ error: "postId and mediaUrl are required" }, 400);
    const request: ModerationRequest = { postId: input.postId, mediaUrl: input.mediaUrl, mediaType: input.mediaType === "video" ? "video" : "image", storagePath: input.storagePath, contentText: input.contentText || "" };
    moderationPostId = request.postId;
    moderationStoragePath = request.storagePath;
    const analysisPromise = processModeration(request, user.id);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<ModerationResult>((resolve) => { timer = setTimeout(() => resolve(timeoutResult()), MAX_SAFETY_CHECK_MS); });
    const result = await Promise.race([analysisPromise, timeout]);
    if (timer) clearTimeout(timer);
    if (result.status === "timeout") {
      const runtime = globalThis as typeof globalThis & { EdgeRuntime?: { waitUntil: (promise: Promise<unknown>) => void } };
      runtime.EdgeRuntime?.waitUntil(analysisPromise.then((lateResult) => persistResult(request.postId, user.id, lateResult, request.storagePath)).catch((error) => console.error("Late moderation failed:", error)));
      await persistResult(request.postId, user.id, result, request.storagePath);
      return json(result);
    }
    await persistResult(request.postId, user.id, result, request.storagePath);
    return json(result);
  } catch (error) {
    // Service failures remain pending so Gemini outages cannot masquerade as a rejection.
    const result = errorResult(Date.now(), error instanceof Error ? error.message : "MODERATION_FAILED");
    if (moderationPostId && moderationUserId) {
      try {
        await persistResult(moderationPostId, moderationUserId, result, moderationStoragePath);
      } catch (persistError) {
        console.error("Failed to persist moderation fallback:", persistError);
      }
    }
    return json(result);
  }
});
