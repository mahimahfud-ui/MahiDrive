import { createClient } from "npm:@supabase/supabase-js@2.119.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const secretKeys = (() => {
  try { return JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}"); }
  catch { return {}; }
})();
const SUPABASE_SECRET = secretKeys.default ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/drive.file",
];
const TOKEN_CACHE = new Map<string, { token: string; expiresAt: number }>();
const encoder = new TextEncoder();

class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function json(data: unknown, status = 200, origin = "*") {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-mahidrive-account-id, x-mahidrive-upload-session, content-range",
      "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
      "Vary": "Origin",
    },
  });
}

function adminClient() {
  if (!SUPABASE_URL || !SUPABASE_SECRET) {
    throw new ApiError(500, "supabase_function_config_missing", "Supabase server configuration is incomplete.");
  }
  return createClient(SUPABASE_URL, SUPABASE_SECRET, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

function db(client: ReturnType<typeof adminClient>) {
  return client.schema("mahidrive");
}

function getBearer(req: Request) {
  const value = req.headers.get("authorization") ?? "";
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? "";
}

async function requireOwner(req: Request) {
  const jwt = getBearer(req);
  if (!jwt) throw new ApiError(401, "missing_session", "Sign in with the MahiDrive owner account.");
  const client = adminClient();
  const { data: userData, error: authError } = await client.auth.getUser(jwt);
  const user = userData?.user;
  if (authError || !user || !user.email || !user.email_confirmed_at) {
    throw new ApiError(401, "invalid_session", "Your session is invalid or expired. Sign in again.");
  }
  const { data: owner, error: ownerError } = await db(client)
    .from("owner_settings")
    .select("owner_user_id, owner_email")
    .eq("singleton", true)
    .maybeSingle();
  if (ownerError) throw new ApiError(503, "owner_record_unavailable", "MahiDrive owner configuration could not be checked.");
  if (!owner || owner.owner_user_id !== user.id ||
      owner.owner_email?.toLowerCase() !== user.email.toLowerCase()) {
    throw new ApiError(403, "owner_only", "This account is not authorized to use MahiDrive.");
  }
  return { client, user };
}

async function audit(client: ReturnType<typeof adminClient>, actor: string | null, action: string, objectType = "", objectId = "", outcome = "success", details: Record<string, unknown> = {}) {
  await db(client).from("audit_events").insert({
    actor_user_id: actor,
    action,
    object_type: objectType || null,
    object_id: objectId || null,
    outcome,
    details,
  });
}

function b64url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
function fromB64url(value: string) {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - value.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
async function signState(payload: Record<string, unknown>) {
  const secret = Deno.env.get("MAHIDRIVE_OAUTH_STATE_SECRET") ?? "";
  if (secret.length < 32) throw new ApiError(503, "oauth_state_secret_missing", "Configure MAHIDRIVE_OAUTH_STATE_SECRET before connecting Google Drive.");
  const body = b64url(encoder.encode(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(body)));
  return body + "." + b64url(signature);
}
async function verifyState(value: string) {
  const parts = value.split(".");
  if (parts.length !== 2) throw new ApiError(400, "invalid_oauth_state", "OAuth state is invalid.");
  const secret = Deno.env.get("MAHIDRIVE_OAUTH_STATE_SECRET") ?? "";
  if (secret.length < 32) throw new ApiError(503, "oauth_state_secret_missing", "OAuth state verification is not configured.");
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const valid = await crypto.subtle.verify("HMAC", key, fromB64url(parts[1]), encoder.encode(parts[0]));
  if (!valid) throw new ApiError(400, "invalid_oauth_state", "OAuth state signature is invalid.");
  const payload = JSON.parse(new TextDecoder().decode(fromB64url(parts[0])));
  if (!payload.exp || Date.now() > Number(payload.exp) || !payload.userId || !payload.slot || !payload.returnTo) {
    throw new ApiError(400, "expired_oauth_state", "OAuth state expired. Start the connection again.");
  }
  return payload as { userId: string; slot: number; returnTo: string; exp: number; nonce: string };
}
function tokenKeyBytes() {
  const raw = Deno.env.get("MAHIDRIVE_TOKEN_ENCRYPTION_KEY") ?? "";
  if (!raw) throw new ApiError(503, "token_encryption_key_missing", "Configure MAHIDRIVE_TOKEN_ENCRYPTION_KEY before connecting Google Drive.");
  try {
    const bytes = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
    if (bytes.length !== 32) throw new Error("Expected 32 bytes");
    return bytes;
  } catch {
    throw new ApiError(503, "token_encryption_key_invalid", "MAHIDRIVE_TOKEN_ENCRYPTION_KEY must be base64 for exactly 32 random bytes.");
  }
}
function toHex(bytes: Uint8Array) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
function fromHex(value: string) {
  const hex = value.replace(/^\\x/i, "");
  if (!hex || hex.length % 2) throw new ApiError(500, "encrypted_token_invalid", "Stored Google token is unreadable.");
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}
async function encryptToken(value: string) {
  const key = await crypto.subtle.importKey("raw", tokenKeyBytes(), "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(value)));
  return { ciphertext: "\\x" + toHex(ciphertext), nonce: "\\x" + toHex(iv), keyVersion: 1 };
}
async function decryptToken(ciphertext: string, nonce: string) {
  const key = await crypto.subtle.importKey("raw", tokenKeyBytes(), "AES-GCM", false, ["decrypt"]);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromHex(nonce) }, key, fromHex(ciphertext));
  return new TextDecoder().decode(plain);
}

function googleConfig() {
  const clientId = Deno.env.get("GOOGLE_CLIENT_ID") ?? "";
  const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET") ?? "";
  const redirectUri = Deno.env.get("GOOGLE_REDIRECT_URI") ??
    (SUPABASE_URL ? SUPABASE_URL + "/functions/v1/mahidrive-api/oauth/callback" : "");
  if (!clientId || !clientSecret || !redirectUri) {
    throw new ApiError(503, "google_oauth_not_configured", "Add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REDIRECT_URI in Supabase Edge Function secrets.");
  }
  return { clientId, clientSecret, redirectUri };
}

async function oauthStart(req: Request, client: ReturnType<typeof adminClient>, user: { id: string }) {
  const { clientId, redirectUri } = googleConfig();
  const body = await req.json().catch(() => ({}));
  const slot = Number(body.slot);
  if (!Number.isInteger(slot) || slot < 1 || slot > 5) throw new ApiError(400, "invalid_slot", "Choose one of the five Google Drive slots.");
  const origin = req.headers.get("origin") ?? "";
  const referer = req.headers.get("referer") ?? "";
  if (!origin.startsWith("https://") && !origin.startsWith("http://localhost")) {
    throw new ApiError(400, "invalid_app_origin", "Open MahiDrive from its HTTPS website before connecting Google.");
  }
  let returnTo = origin + "/";
  try {
    const ref = new URL(referer);
    if (ref.origin === origin) {
      returnTo = ref.origin + ref.pathname;
    }
  } catch { /* use the validated origin fallback */ }
  const { data: account, error } = await db(client)
    .from("google_accounts").select("id,slot,status").eq("slot", slot).single();
  if (error || !account) throw new ApiError(404, "slot_not_found", "The selected Google Drive slot is unavailable.");
  const state = await signState({
    userId: user.id,
    slot,
    returnTo,
    exp: Date.now() + 10 * 60 * 1000,
    nonce: crypto.randomUUID(),
  });
  await db(client).from("google_accounts").update({ status: "pending", last_error_code: null }).eq("slot", slot);
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_SCOPES.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", state);
  await audit(client, user.id, "google_oauth_started", "google_account", String(slot));
  return { authorizationUrl: url.toString(), slot };
}

async function oauthCallback(req: Request) {
  const url = new URL(req.url);
  const stateValue = url.searchParams.get("state") ?? "";
  const state = await verifyState(stateValue);
  const client = adminClient();
  const { data: owner } = await db(client).from("owner_settings")
    .select("owner_user_id,owner_email").eq("singleton", true).maybeSingle();
  if (!owner || owner.owner_user_id !== state.userId) throw new ApiError(403, "owner_changed", "MahiDrive owner identity changed. Restart the connection.");
  const errorCode = url.searchParams.get("error");
  if (errorCode) {
    await db(client).from("google_accounts").update({ status: "error", last_error_code: "google_" + errorCode, last_error_at: new Date().toISOString() }).eq("slot", state.slot);
    return callbackRedirect(state.returnTo, "error", state.slot);
  }
  const code = url.searchParams.get("code") ?? "";
  if (!code) throw new ApiError(400, "missing_code", "Google did not return an authorization code.");
  const config = googleConfig();
  const exchange = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: "authorization_code",
    }),
  });
  const tokenData = await exchange.json().catch(() => ({}));
  if (!exchange.ok || !tokenData.access_token) {
    throw new ApiError(502, "google_token_exchange_failed", "Google could not complete the account connection. Check the OAuth client and redirect URI.");
  }
  const profileResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: "Bearer " + tokenData.access_token },
  });
  const profile = await profileResponse.json().catch(() => ({}));
  if (!profileResponse.ok || !profile.sub || !profile.email || profile.email_verified !== true) {
    throw new ApiError(502, "google_profile_failed", "Google did not return a verified account identity.");
  }
  const { data: existing, error: existingError } = await db(client)
    .from("google_accounts").select("id,refresh_token_ciphertext,refresh_token_nonce,encryption_key_version")
    .eq("slot", state.slot).single();
  if (existingError || !existing) throw new ApiError(404, "slot_not_found", "Google Drive slot was not found.");
  const refreshToken = tokenData.refresh_token ||
    (existing.refresh_token_ciphertext && existing.refresh_token_nonce
      ? await decryptToken(existing.refresh_token_ciphertext, existing.refresh_token_nonce)
      : "");
  if (!refreshToken) throw new ApiError(502, "google_refresh_token_missing", "Google did not issue offline access. Retry the connection and approve the consent screen.");
  const encrypted = await encryptToken(refreshToken);
  const aboutRes = await fetch("https://www.googleapis.com/drive/v3/about?fields=user(displayName,emailAddress),storageQuota(limit,usage)", {
    headers: { Authorization: "Bearer " + tokenData.access_token },
  });
  const about = aboutRes.ok ? await aboutRes.json() : {};
  const { error: saveError } = await db(client).from("google_accounts").update({
    label: "Google Drive " + state.slot,
    google_subject_id: profile.sub,
    account_email: profile.email.toLowerCase(),
    status: "connected",
    scopes: GOOGLE_SCOPES,
    refresh_token_ciphertext: encrypted.ciphertext,
    refresh_token_nonce: encrypted.nonce,
    encryption_key_version: encrypted.keyVersion,
    quota_limit_bytes: about.storageQuota?.limit ? Number(about.storageQuota.limit) : null,
    quota_used_bytes: about.storageQuota?.usage ? Number(about.storageQuota.usage) : 0,
    quota_checked_at: new Date().toISOString(),
    connected_at: new Date().toISOString(),
    last_error_code: null,
    last_error_at: null,
    updated_at: new Date().toISOString(),
  }).eq("slot", state.slot);
  if (saveError) throw new ApiError(409, "google_account_save_failed", "This Google account may already occupy another slot, or the account record could not be saved.");
  TOKEN_CACHE.delete(existing.id);
  await audit(client, state.userId, "google_account_connected", "google_account", String(state.slot), "success", { accountEmail: profile.email.toLowerCase() });
  return callbackRedirect(state.returnTo, "connected", state.slot);
}

function callbackRedirect(returnTo: string, status: string, slot: number) {
  const target = new URL(returnTo);
  target.searchParams.set("mahidrive_oauth", status);
  target.searchParams.set("slot", String(slot));
  return new Response(null, { status: 303, headers: { Location: target.toString(), "Cache-Control": "no-store" } });
}

async function getAccount(client: ReturnType<typeof adminClient>, accountId: string) {
  const { data, error } = await db(client).from("google_accounts")
    .select("id,slot,label,account_email,status,scopes,refresh_token_ciphertext,refresh_token_nonce,encryption_key_version,quota_limit_bytes,quota_used_bytes")
    .eq("id", accountId).single();
  if (error || !data) throw new ApiError(404, "account_not_found", "Google Drive account was not found.");
  if (data.status !== "connected" || !data.refresh_token_ciphertext || !data.refresh_token_nonce) {
    throw new ApiError(409, "account_not_connected", "Connect this Google Drive account first.");
  }
  return data;
}

async function googleAccessToken(account: any) {
  const cached = TOKEN_CACHE.get(account.id);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  const config = googleConfig();
  const refreshToken = await decryptToken(account.refresh_token_ciphertext, account.refresh_token_nonce);
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.access_token) {
    if (body.error === "invalid_grant") {
      TOKEN_CACHE.delete(account.id);
      const client = adminClient();
      await db(client).from("google_accounts").update({
        status: "reauthorization_required",
        last_error_code: "invalid_grant",
        last_error_at: new Date().toISOString(),
      }).eq("id", account.id);
    }
    throw new ApiError(409, "google_reauthorization_required", "Google authorization expired or was revoked. Reconnect this account.");
  }
  TOKEN_CACHE.set(account.id, { token: body.access_token, expiresAt: Date.now() + Number(body.expires_in ?? 3600) * 1000 });
  return body.access_token as string;
}

async function driveJson(account: any, path: string, init: RequestInit = {}) {
  const token = await googleAccessToken(account);
  const response = await fetch("https://www.googleapis.com/drive/v3/" + path, {
    ...init,
    headers: { Authorization: "Bearer " + token, ...(init.headers ?? {}) },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(response.status === 401 ? 409 : 502, "google_drive_api_error", payload.error?.message ?? "Google Drive operation failed.");
  }
  return payload;
}

function safeFileFields(file: any) {
  return {
    drive_file_id: String(file.id),
    name: String(file.name ?? "Untitled"),
    mime_type: file.mimeType ?? "application/octet-stream",
    size_bytes: file.size ? Number(file.size) : 0,
    md5_checksum: file.md5Checksum ?? null,
    parent_drive_file_id: file.parents?.[0] ?? null,
    modified_at: file.modifiedTime ?? new Date().toISOString(),
    is_trashed: Boolean(file.trashed),
    is_starred: false,
    updated_at: new Date().toISOString(),
  };
}
async function storeDriveFile(client: ReturnType<typeof adminClient>, accountId: string, file: any) {
  const { data: previous } = await db(client).from("drive_files").select("is_starred")
    .eq("google_account_id", accountId).eq("drive_file_id", String(file.id)).maybeSingle();
  const record = { ...safeFileFields(file), is_starred: Boolean(previous?.is_starred) };
  const { data, error } = await db(client).from("drive_files")
    .upsert({ google_account_id: accountId, ...record }, { onConflict: "google_account_id,drive_file_id" })
    .select("id,google_account_id,drive_file_id,name,mime_type,size_bytes,md5_checksum,parent_drive_file_id,modified_at,is_trashed,is_starred")
    .single();
  if (error) throw new ApiError(500, "file_index_failed", "The Google file was saved but its MahiDrive index could not be updated.");
  return data;
}
async function listDrive(client: ReturnType<typeof adminClient>) {
  const { data: accounts, error } = await db(client).from("google_accounts")
    .select("id,slot,label,account_email,status,quota_limit_bytes,quota_used_bytes,quota_checked_at")
    .order("slot");
  if (error) throw new ApiError(500, "accounts_load_failed", "Could not load Google account connections.");
  const connected = (accounts ?? []).filter((a: any) => a.status === "connected");
  const results = await Promise.all(connected.map(async (account: any) => {
    try {
      const fullAccount = await getAccount(client, account.id);
      const accessToken = await googleAccessToken(fullAccount);
      const aboutResponse = await fetch("https://www.googleapis.com/drive/v3/about?fields=user(displayName,emailAddress),storageQuota(limit,usage)", {
        headers: { Authorization: "Bearer " + accessToken },
      });
      const about = aboutResponse.ok ? await aboutResponse.json() : {};
      const driveFiles: any[] = [];
      let nextPageToken: string | undefined;
      let pageCount = 0;
      do {
        const params = new URLSearchParams({
          pageSize: "1000",
          orderBy: "folder,name",
          fields: "nextPageToken,files(id,name,mimeType,size,md5Checksum,modifiedTime,parents,trashed,webViewLink)",
        });
        if (nextPageToken) params.set("pageToken", nextPageToken);
        const filesResponse = await fetch("https://www.googleapis.com/drive/v3/files?" + params.toString(), {
          headers: { Authorization: "Bearer " + accessToken },
        });
        const filesBody = await filesResponse.json().catch(() => ({}));
        if (!filesResponse.ok) throw new Error(filesBody.error?.message ?? "Google Drive file list failed.");
        driveFiles.push(...(filesBody.files ?? []));
        nextPageToken = filesBody.nextPageToken;
        pageCount++;
      } while (nextPageToken && pageCount < 100);
      if (about.storageQuota) {
        await db(client).from("google_accounts").update({
          quota_limit_bytes: about.storageQuota.limit ? Number(about.storageQuota.limit) : null,
          quota_used_bytes: about.storageQuota.usage ? Number(about.storageQuota.usage) : 0,
          quota_checked_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq("id", account.id);
      }
      const stored = [];
      for (const file of driveFiles) stored.push(await storeDriveFile(client, account.id, file));
      return { accountId: account.id, slot: account.slot, files: stored, error: null };
    } catch (error) {
      return { accountId: account.id, slot: account.slot, files: [], error: error instanceof Error ? error.message : "Google Drive sync failed." };
    }
  }));
  const allFiles = results.flatMap((r: any) => r.files.map((f: any) => ({ ...f, account_slot: r.slot })));
  const { data: refreshedAccounts } = await db(client).from("google_accounts")
    .select("id,slot,label,account_email,status,quota_limit_bytes,quota_used_bytes,quota_checked_at,last_error_code")
    .order("slot");
  return { accounts: refreshedAccounts ?? accounts ?? [], files: allFiles, accountErrors: results.filter((r: any) => r.error).map((r: any) => ({ slot: r.slot, message: r.error })) };
}

async function refreshQuota(client: ReturnType<typeof adminClient>, account: any) {
  const token = await googleAccessToken(account);
  const response = await fetch("https://www.googleapis.com/drive/v3/about?fields=user(displayName,emailAddress),storageQuota(limit,usage)", {
    headers: { Authorization: "Bearer " + token },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(502, "quota_refresh_failed", "Google Drive quota could not be refreshed.");
  await db(client).from("google_accounts").update({
    quota_limit_bytes: body.storageQuota?.limit ? Number(body.storageQuota.limit) : null,
    quota_used_bytes: body.storageQuota?.usage ? Number(body.storageQuota.usage) : 0,
    quota_checked_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", account.id);
  return body;
}

async function routeRequest(req: Request, route: string, origin: string) {
  const { client, user } = await requireOwner(req);
  const url = new URL(req.url);
  if (route === "health" && req.method === "GET") {
    const { data: owner } = await db(client).from("owner_settings").select("owner_email").eq("singleton", true).single();
    return json({ ok: true, product: "MahiDrive", owner: owner?.owner_email, backend: "connected" }, 200, origin);
  }
  if (route === "accounts" && req.method === "GET") {
    const { data, error } = await db(client).from("google_accounts")
      .select("id,slot,label,account_email,status,quota_limit_bytes,quota_used_bytes,quota_checked_at,last_error_code")
      .order("slot");
    if (error) throw new ApiError(500, "accounts_load_failed", "Could not load account slots.");
    return json({ accounts: data ?? [] }, 200, origin);
  }
  if (route === "oauth/start" && req.method === "POST") {
    return json(await oauthStart(req, client, user), 200, origin);
  }
  if (route === "accounts/refresh" && req.method === "POST") {
    const { data } = await db(client).from("google_accounts").select("id,slot").eq("status", "connected");
    for (const item of data ?? []) {
      try { await refreshQuota(client, await getAccount(client, item.id)); } catch { /* account status is reported separately */ }
    }
    const { data: updated } = await db(client).from("google_accounts")
      .select("id,slot,label,account_email,status,quota_limit_bytes,quota_used_bytes,quota_checked_at,last_error_code").order("slot");
    return json({ accounts: updated ?? [] }, 200, origin);
  }
  if (route === "accounts/disconnect" && req.method === "POST") {
    const body = await req.json();
    const slot = Number(body.slot);
    const { data: account, error } = await db(client).from("google_accounts")
      .select("id,slot,refresh_token_ciphertext,refresh_token_nonce").eq("slot", slot).single();
    if (error || !account) throw new ApiError(404, "slot_not_found", "Google account slot was not found.");
    if (account.refresh_token_ciphertext && account.refresh_token_nonce) {
      try {
        const refreshToken = await decryptToken(account.refresh_token_ciphertext, account.refresh_token_nonce);
        await fetch("https://oauth2.googleapis.com/revoke", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ token: refreshToken }),
        });
      } catch { /* revoke best-effort; local token is still removed */ }
    }
    TOKEN_CACHE.delete(account.id);
    await db(client).from("google_accounts").update({
      google_subject_id: null, account_email: null, status: "disconnected", scopes: [],
      refresh_token_ciphertext: null, refresh_token_nonce: null, encryption_key_version: null,
      quota_limit_bytes: null, quota_used_bytes: null, quota_checked_at: null,
      connected_at: null, last_error_code: null, last_error_at: null, updated_at: new Date().toISOString(),
    }).eq("id", account.id);
    await audit(client, user.id, "google_account_disconnected", "google_account", String(slot));
    return json({ ok: true, slot }, 200, origin);
  }
  if (route === "files/list" && req.method === "GET") {
    return json(await listDrive(client), 200, origin);
  }
  if (route === "files/create-folder" && req.method === "POST") {
    const body = await req.json();
    const account = await getAccount(client, String(body.accountId ?? ""));
    const name = String(body.name ?? "").trim();
    if (!name || name.length > 255) throw new ApiError(400, "invalid_folder_name", "Folder name must be 1–255 characters.");
    const metadata: Record<string, unknown> = { name, mimeType: "application/vnd.google-apps.folder" };
    if (body.parentId) metadata.parents = [String(body.parentId)];
    const created = await driveJson(account, "files?fields=id,name,mimeType,modifiedTime,parents,trashed", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(metadata),
    });
    const stored = await storeDriveFile(client, account.id, created);
    await audit(client, user.id, "folder_created", "drive_file", created.id, "success", { accountSlot: account.slot });
    return json({ file: stored, accountSlot: account.slot }, 201, origin);
  }
  if (route === "files/upload-session" && req.method === "POST") {
    const body = await req.json();
    const account = await getAccount(client, String(body.accountId ?? ""));
    const name = String(body.name ?? "").trim();
    const size = Number(body.size);
    if (!name || name.length > 255 || !Number.isSafeInteger(size) || size < 0) {
      throw new ApiError(400, "invalid_upload", "Upload name or size is invalid.");
    }
    const metadata: Record<string, unknown> = { name };
    if (body.parentId) metadata.parents = [String(body.parentId)];
    const token = await googleAccessToken(account);
    const response = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,mimeType,size,md5Checksum,modifiedTime,parents,trashed", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": String(body.mimeType || "application/octet-stream"),
        "X-Upload-Content-Length": String(size),
      },
      body: JSON.stringify(metadata),
    });
    if (!response.ok || !response.headers.get("Location")) {
      throw new ApiError(502, "upload_session_failed", "Google Drive could not start the upload session.");
    }
    return json({ sessionUrl: response.headers.get("Location"), accountId: account.id, accountSlot: account.slot }, 200, origin);
  }
  if (route === "files/upload-chunk" && req.method === "POST") {
    const accountId = req.headers.get("x-mahidrive-account-id") ?? "";
    await getAccount(client, accountId);
    const sessionUrl = req.headers.get("x-mahidrive-upload-session") ?? "";
    let target: URL;
    try { target = new URL(sessionUrl); } catch { throw new ApiError(400, "invalid_upload_session", "Upload session URL is invalid."); }
    if (target.protocol !== "https:" || target.hostname !== "www.googleapis.com" ||
        !target.pathname.startsWith("/upload/drive/v3/files")) {
      throw new ApiError(400, "invalid_upload_session", "Upload session host is not an approved Google Drive upload endpoint.");
    }
    const range = req.headers.get("content-range") ?? "";
    if (!/^bytes (?:\d+-\d+\/\d+|\*\/0)$/.test(range)) {
      throw new ApiError(400, "invalid_content_range", "Upload chunk Content-Range is invalid.");
    }
    const chunk = await req.arrayBuffer();
    if (chunk.byteLength > 8 * 1024 * 1024) {
      throw new ApiError(413, "upload_chunk_too_large", "Upload chunks must not exceed 8 MiB.");
    }
    const uploadResponse = await fetch(target.toString(), {
      method: "PUT",
      headers: {
        "Content-Range": range,
        "Content-Type": req.headers.get("content-type") ?? "application/octet-stream",
      },
      body: chunk,
    });
    const raw = await uploadResponse.text();
    let uploadedFile: unknown = null;
    try { uploadedFile = JSON.parse(raw); } catch { /* Google returns an empty body while a resumable upload continues. */ }
    if (uploadResponse.status !== 308 && !uploadResponse.ok) {
      throw new ApiError(502, "google_chunk_upload_failed", "Google Drive rejected an upload chunk.");
    }
    return json({
      uploadStatus: uploadResponse.status,
      range: uploadResponse.headers.get("Range"),
      file: uploadedFile,
    }, 200, origin);
  }

  if (route === "files/register" && req.method === "POST") {
    const body = await req.json();
    const account = await getAccount(client, String(body.accountId ?? ""));
    const fileId = String(body.fileId ?? "");
    if (!fileId) throw new ApiError(400, "missing_file_id", "Google Drive file ID is required.");
    const file = await driveJson(account, "files/" + encodeURIComponent(fileId) + "?fields=id,name,mimeType,size,md5Checksum,modifiedTime,parents,trashed,webViewLink");
    const stored = await storeDriveFile(client, account.id, file);
    await audit(client, user.id, "file_uploaded", "drive_file", fileId, "success", { accountSlot: account.slot, fileName: file.name });
    return json({ file: stored, accountSlot: account.slot }, 200, origin);
  }
  if (route === "files/rename" && req.method === "POST") {
    const body = await req.json();
    const account = await getAccount(client, String(body.accountId ?? ""));
    const fileId = String(body.fileId ?? "");
    const name = String(body.name ?? "").trim();
    if (!fileId || !name || name.length > 255) throw new ApiError(400, "invalid_rename", "File ID and a valid name are required.");
    const file = await driveJson(account, "files/" + encodeURIComponent(fileId) + "?fields=id,name,mimeType,size,md5Checksum,modifiedTime,parents,trashed", {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }),
    });
    const stored = await storeDriveFile(client, account.id, file);
    await audit(client, user.id, "file_renamed", "drive_file", fileId);
    return json({ file: stored }, 200, origin);
  }
  if (route === "files/move" && req.method === "POST") {
    const body = await req.json();
    const account = await getAccount(client, String(body.accountId ?? ""));
    const fileId = String(body.fileId ?? "");
    const file = await driveJson(account, "files/" + encodeURIComponent(fileId) + "?fields=id,parents");
    const params = new URLSearchParams({ fields: "id,name,mimeType,size,md5Checksum,modifiedTime,parents,trashed" });
    if (file.parents?.length) params.set("removeParents", file.parents.join(","));
    if (body.parentId) params.set("addParents", String(body.parentId));
    const updated = await driveJson(account, "files/" + encodeURIComponent(fileId) + "?" + params.toString(), { method: "PATCH" });
    const stored = await storeDriveFile(client, account.id, updated);
    await audit(client, user.id, "file_moved", "drive_file", fileId);
    return json({ file: stored }, 200, origin);
  }
  if (route === "files/copy" && req.method === "POST") {
    const body = await req.json();
    const account = await getAccount(client, String(body.accountId ?? ""));
    const fileId = String(body.fileId ?? "");
    const copied = await driveJson(account, "files/" + encodeURIComponent(fileId) + "/copy?fields=id,name,mimeType,size,md5Checksum,modifiedTime,parents,trashed", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body.name ? { name: String(body.name) } : {}),
    });
    const stored = await storeDriveFile(client, account.id, copied);
    await audit(client, user.id, "file_copied", "drive_file", fileId);
    return json({ file: stored }, 201, origin);
  }
  if (route === "files/trash" && req.method === "POST") {
    const body = await req.json();
    const account = await getAccount(client, String(body.accountId ?? ""));
    const fileId = String(body.fileId ?? "");
    const file = await driveJson(account, "files/" + encodeURIComponent(fileId) + "?fields=id,name,mimeType,size,md5Checksum,modifiedTime,parents,trashed", {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trashed: true }),
    });
    const stored = await storeDriveFile(client, account.id, file);
    await audit(client, user.id, "file_trashed", "drive_file", fileId);
    return json({ file: stored }, 200, origin);
  }
  if (route === "files/restore" && req.method === "POST") {
    const body = await req.json();
    const account = await getAccount(client, String(body.accountId ?? ""));
    const fileId = String(body.fileId ?? "");
    const file = await driveJson(account, "files/" + encodeURIComponent(fileId) + "?fields=id,name,mimeType,size,md5Checksum,modifiedTime,parents,trashed", {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trashed: false }),
    });
    const stored = await storeDriveFile(client, account.id, file);
    await audit(client, user.id, "file_restored", "drive_file", fileId);
    return json({ file: stored }, 200, origin);
  }
  if (route === "files/delete" && req.method === "POST") {
    const body = await req.json();
    const account = await getAccount(client, String(body.accountId ?? ""));
    const fileId = String(body.fileId ?? "");
    await driveJson(account, "files/" + encodeURIComponent(fileId), { method: "DELETE" });
    await db(client).from("drive_files").delete().eq("google_account_id", account.id).eq("drive_file_id", fileId);
    await audit(client, user.id, "file_deleted_permanently", "drive_file", fileId, "success", { accountSlot: account.slot });
    return json({ ok: true }, 200, origin);
  }
  if (route === "files/star" && req.method === "POST") {
    const body = await req.json();
    const account = await getAccount(client, String(body.accountId ?? ""));
    const fileId = String(body.fileId ?? "");
    const starred = Boolean(body.starred);
    const { error } = await db(client).from("drive_files").update({ is_starred: starred, updated_at: new Date().toISOString() })
      .eq("google_account_id", account.id).eq("drive_file_id", fileId);
    if (error) throw new ApiError(500, "star_update_failed", "Could not save the MahiDrive star state.");
    await audit(client, user.id, starred ? "file_starred" : "file_unstarred", "drive_file", fileId);
    return json({ ok: true, starred }, 200, origin);
  }
  if (route === "files/download" && req.method === "GET") {
    const account = await getAccount(client, String(url.searchParams.get("accountId") ?? ""));
    const fileId = String(url.searchParams.get("fileId") ?? "");
    const { data: file } = await db(client).from("drive_files").select("name,mime_type")
      .eq("google_account_id", account.id).eq("drive_file_id", fileId).maybeSingle();
    if (!fileId || !file) throw new ApiError(404, "file_not_found", "File was not found in the MahiDrive index.");
    const token = await googleAccessToken(account);
    const response = await fetch("https://www.googleapis.com/drive/v3/files/" + encodeURIComponent(fileId) + "?alt=media", {
      headers: { Authorization: "Bearer " + token },
    });
    if (!response.ok || !response.body) throw new ApiError(502, "download_failed", "Google Drive could not provide this file.");
    const safeName = String(file.name).replace(/[\r\n"]/g, "_");
    return new Response(response.body, {
      status: 200,
      headers: {
        "Content-Type": file.mime_type || "application/octet-stream",
        "Content-Disposition": "attachment; filename=\"" + safeName + "\"",
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-mahidrive-account-id, x-mahidrive-upload-session, content-range",
        "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
        "Vary": "Origin",
      },
    });
  }
  if (route === "activity" && req.method === "GET") {
    const { data, error } = await db(client).from("audit_events")
      .select("id,action,object_type,object_id,outcome,details,created_at")
      .order("created_at", { ascending: false }).limit(100);
    if (error) throw new ApiError(500, "activity_load_failed", "Could not load activity history.");
    return json({ events: data ?? [] }, 200, origin);
  }
  throw new ApiError(404, "route_not_found", "MahiDrive API route was not found.");
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin") ?? "*";
  if (req.method === "OPTIONS") return json({}, 204, origin);
  const url = new URL(req.url);
  const parts = url.pathname.split("/").filter(Boolean);
  const index = parts.indexOf("mahidrive-api");
  const route = parts.slice(index >= 0 ? index + 1 : 0).join("/");
  try {
    if (route === "oauth/callback" && req.method === "GET") {
      return await oauthCallback(req);
    }
    return await routeRequest(req, route, origin);
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 500;
    const code = error instanceof ApiError ? error.code : "internal_error";
    const message = error instanceof ApiError ? error.message : "MahiDrive could not complete this request.";
    return json({ error: { code, message } }, status, origin);
  }
});
