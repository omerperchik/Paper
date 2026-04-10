// Provider drivers — thin HTTP clients for each integration.
//
// Each driver takes decrypted credentials + metadata + tool args, makes
// a real HTTP call, and returns a { ok, data | error } result. The
// agent-tools route handlers wrap each driver in a toolResponse envelope.
//
// No SDK dependencies. All calls use global `fetch`. This keeps the
// surface small and the failure modes predictable.
//
// Error handling convention:
// - Network/HTTP failure → { ok: false, error: "<short reason>" }
// - 4xx from provider → { ok: false, error: "<provider message>" }
// - Success → { ok: true, data: <unknown> }

type Creds = Record<string, unknown>;
type Meta = Record<string, unknown>;

export interface DriverResult {
  ok: boolean;
  data?: unknown;
  error?: string;
  status?: number;
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function requireStr(obj: Record<string, unknown>, key: string): string {
  const v = obj[key];
  if (typeof v !== "string" || !v) {
    throw new Error(`Missing required field: ${key}`);
  }
  return v;
}

async function fetchJson(
  method: string,
  url: string,
  headers: Record<string, string>,
  body?: unknown,
): Promise<DriverResult> {
  try {
    const res = await fetch(url, {
      method,
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        ...headers,
      },
      body: body != null ? JSON.stringify(body) : undefined,
    });
    const ct = res.headers.get("content-type") ?? "";
    const parsed: unknown = ct.includes("application/json") ? await res.json() : await res.text();
    if (!res.ok) {
      const msg =
        typeof parsed === "object" && parsed !== null
          ? JSON.stringify(parsed).slice(0, 500)
          : String(parsed).slice(0, 500);
      return { ok: false, error: `${res.status}: ${msg}`, status: res.status };
    }
    return { ok: true, data: parsed, status: res.status };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function fetchForm(
  method: string,
  url: string,
  headers: Record<string, string>,
  form: Record<string, string>,
): Promise<DriverResult> {
  try {
    const body = new URLSearchParams(form).toString();
    const res = await fetch(url, {
      method,
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
        ...headers,
      },
      body,
    });
    const ct = res.headers.get("content-type") ?? "";
    const parsed: unknown = ct.includes("application/json") ? await res.json() : await res.text();
    if (!res.ok) {
      const msg =
        typeof parsed === "object" && parsed !== null
          ? JSON.stringify(parsed).slice(0, 500)
          : String(parsed).slice(0, 500);
      return { ok: false, error: `${res.status}: ${msg}`, status: res.status };
    }
    return { ok: true, data: parsed, status: res.status };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ============================================================
// Google Ads
// ============================================================
// The Google Ads REST API is versioned (e.g. v18). We use the search
// endpoint for reporting and the mutate endpoint for campaign creation.
// Access tokens are minted on-demand from the refresh token.

async function googleAdsAccessToken(creds: Creds): Promise<string> {
  const clientId = requireStr(creds, "oauthClientId");
  const clientSecret = requireStr(creds, "oauthClientSecret");
  const refreshToken = requireStr(creds, "refreshToken");
  const res = await fetchForm("POST", "https://oauth2.googleapis.com/token", {}, {
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  if (!res.ok) throw new Error(`Google OAuth token refresh failed: ${res.error}`);
  const data = res.data as { access_token?: string };
  if (!data.access_token) throw new Error("Google OAuth returned no access_token");
  return data.access_token;
}

export async function googleAdsCreateCampaign(
  creds: Creds,
  meta: Meta,
  args: { name: string; budgetMicros: number; advertisingChannelType?: string },
): Promise<DriverResult> {
  try {
    const accessToken = await googleAdsAccessToken(creds);
    const developerToken = requireStr(creds, "developerToken");
    const customerId = requireStr(meta, "customerId").replace(/-/g, "");
    const loginCustomerId = str(meta.loginCustomerId).replace(/-/g, "");
    const headers: Record<string, string> = {
      authorization: `Bearer ${accessToken}`,
      "developer-token": developerToken,
    };
    if (loginCustomerId) headers["login-customer-id"] = loginCustomerId;

    // Campaigns in the Google Ads API require a budget resource first.
    const budgetRes = await fetchJson(
      "POST",
      `https://googleads.googleapis.com/v18/customers/${customerId}/campaignBudgets:mutate`,
      headers,
      {
        operations: [
          {
            create: {
              name: `${args.name} Budget`,
              amountMicros: args.budgetMicros,
              deliveryMethod: "STANDARD",
            },
          },
        ],
      },
    );
    if (!budgetRes.ok) return budgetRes;
    const budgetResource =
      (budgetRes.data as { results?: Array<{ resourceName?: string }> }).results?.[0]
        ?.resourceName ?? null;
    if (!budgetResource) return { ok: false, error: "budget creation returned no resource name" };

    const campaignRes = await fetchJson(
      "POST",
      `https://googleads.googleapis.com/v18/customers/${customerId}/campaigns:mutate`,
      headers,
      {
        operations: [
          {
            create: {
              name: args.name,
              status: "PAUSED",
              advertisingChannelType: args.advertisingChannelType ?? "SEARCH",
              campaignBudget: budgetResource,
            },
          },
        ],
      },
    );
    return campaignRes;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function googleAdsGetPerformance(
  creds: Creds,
  meta: Meta,
  args: { days?: number },
): Promise<DriverResult> {
  try {
    const accessToken = await googleAdsAccessToken(creds);
    const developerToken = requireStr(creds, "developerToken");
    const customerId = requireStr(meta, "customerId").replace(/-/g, "");
    const loginCustomerId = str(meta.loginCustomerId).replace(/-/g, "");
    const headers: Record<string, string> = {
      authorization: `Bearer ${accessToken}`,
      "developer-token": developerToken,
    };
    if (loginCustomerId) headers["login-customer-id"] = loginCustomerId;

    const days = Math.max(1, Math.min(90, args.days ?? 7));
    const gaql = `
      SELECT
        campaign.name,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions
      FROM campaign
      WHERE segments.date DURING LAST_${days === 7 ? "7_DAYS" : days === 14 ? "14_DAYS" : "30_DAYS"}
    `.trim();

    return fetchJson(
      "POST",
      `https://googleads.googleapis.com/v18/customers/${customerId}/googleAds:search`,
      headers,
      { query: gaql },
    );
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ============================================================
// Facebook Ads (Meta Marketing API)
// ============================================================

export async function facebookAdsCreateCampaign(
  creds: Creds,
  meta: Meta,
  args: { name: string; objective: string; dailyBudgetCents: number },
): Promise<DriverResult> {
  try {
    const accessToken = requireStr(creds, "accessToken");
    const adAccountId = requireStr(meta, "adAccountId");
    const apiVersion = str(meta.apiVersion, "v21.0");
    return fetchJson(
      "POST",
      `https://graph.facebook.com/${apiVersion}/${adAccountId}/campaigns`,
      { authorization: `Bearer ${accessToken}` },
      {
        name: args.name,
        objective: args.objective,
        status: "PAUSED",
        special_ad_categories: [],
        daily_budget: args.dailyBudgetCents,
      },
    );
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function facebookAdsGetInsights(
  creds: Creds,
  meta: Meta,
  args: { datePreset?: string },
): Promise<DriverResult> {
  try {
    const accessToken = requireStr(creds, "accessToken");
    const adAccountId = requireStr(meta, "adAccountId");
    const apiVersion = str(meta.apiVersion, "v21.0");
    const preset = args.datePreset ?? "last_7d";
    const url = `https://graph.facebook.com/${apiVersion}/${adAccountId}/insights?date_preset=${encodeURIComponent(preset)}&fields=campaign_name,spend,impressions,clicks,ctr,cpc,actions`;
    return fetchJson("GET", url, { authorization: `Bearer ${accessToken}` });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ============================================================
// X (Twitter) — OAuth 1.0a signed request for posting
// ============================================================
// Posting to X requires OAuth 1.0a HMAC-SHA1 signing. We implement it
// inline rather than pull in a dependency.

async function hmacSha1(key: string, message: string): Promise<string> {
  const { createHmac } = await import("node:crypto");
  return createHmac("sha1", key).update(message).digest("base64");
}

function rfc3986(str: string): string {
  return encodeURIComponent(str).replace(
    /[!*'()]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

async function oauth1Header(
  method: string,
  url: string,
  params: Record<string, string>,
  creds: { apiKey: string; apiSecret: string; accessToken: string; accessSecret: string },
): Promise<string> {
  const oauth: Record<string, string> = {
    oauth_consumer_key: creds.apiKey,
    oauth_nonce: Math.random().toString(36).slice(2) + Date.now().toString(36),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: creds.accessToken,
    oauth_version: "1.0",
  };
  const all = { ...params, ...oauth };
  const paramString = Object.keys(all)
    .sort()
    .map((k) => `${rfc3986(k)}=${rfc3986(all[k])}`)
    .join("&");
  const base = `${method.toUpperCase()}&${rfc3986(url)}&${rfc3986(paramString)}`;
  const signingKey = `${rfc3986(creds.apiSecret)}&${rfc3986(creds.accessSecret)}`;
  const signature = await hmacSha1(signingKey, base);
  oauth.oauth_signature = signature;
  const header =
    "OAuth " +
    Object.keys(oauth)
      .sort()
      .map((k) => `${rfc3986(k)}="${rfc3986(oauth[k])}"`)
      .join(", ");
  return header;
}

export async function xPost(
  creds: Creds,
  _meta: Meta,
  args: { text: string },
): Promise<DriverResult> {
  try {
    const c = {
      apiKey: requireStr(creds, "apiKey"),
      apiSecret: requireStr(creds, "apiSecret"),
      accessToken: requireStr(creds, "accessToken"),
      accessSecret: requireStr(creds, "accessSecret"),
    };
    const url = "https://api.x.com/2/tweets";
    const authHeader = await oauth1Header("POST", url, {}, c);
    const res = await fetch(url, {
      method: "POST",
      headers: {
        authorization: authHeader,
        "content-type": "application/json",
      },
      body: JSON.stringify({ text: args.text }),
    });
    const data: unknown = await res.json();
    if (!res.ok) {
      return { ok: false, error: `${res.status}: ${JSON.stringify(data).slice(0, 500)}`, status: res.status };
    }
    return { ok: true, data, status: res.status };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function xSearch(
  creds: Creds,
  _meta: Meta,
  args: { query: string; maxResults?: number },
): Promise<DriverResult> {
  try {
    const c = {
      apiKey: requireStr(creds, "apiKey"),
      apiSecret: requireStr(creds, "apiSecret"),
      accessToken: requireStr(creds, "accessToken"),
      accessSecret: requireStr(creds, "accessSecret"),
    };
    const max = Math.max(10, Math.min(100, args.maxResults ?? 10));
    const params = { query: args.query, max_results: String(max) };
    const url = "https://api.x.com/2/tweets/search/recent";
    const authHeader = await oauth1Header("GET", url, params, c);
    const qs = new URLSearchParams(params).toString();
    const res = await fetch(`${url}?${qs}`, {
      method: "GET",
      headers: { authorization: authHeader },
    });
    const data: unknown = await res.json();
    if (!res.ok) {
      return { ok: false, error: `${res.status}: ${JSON.stringify(data).slice(0, 500)}`, status: res.status };
    }
    return { ok: true, data, status: res.status };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ============================================================
// Reddit — script-type OAuth (password grant)
// ============================================================

async function redditAccessToken(creds: Creds, meta: Meta): Promise<{ token: string; userAgent: string }> {
  const clientId = requireStr(creds, "clientId");
  const clientSecret = requireStr(creds, "clientSecret");
  const username = requireStr(creds, "username");
  const password = requireStr(creds, "password");
  const userAgent = str(meta.userAgent, `paperclip-bot/1.0 by u/${username}`);

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      authorization: `Basic ${basic}`,
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": userAgent,
    },
    body: new URLSearchParams({
      grant_type: "password",
      username,
      password,
    }).toString(),
  });
  const data = (await res.json()) as { access_token?: string; error?: string };
  if (!res.ok || !data.access_token) {
    throw new Error(`Reddit auth failed: ${data.error ?? res.status}`);
  }
  return { token: data.access_token, userAgent };
}

export async function redditPost(
  creds: Creds,
  meta: Meta,
  args: { subreddit: string; title: string; text?: string; url?: string; kind?: "self" | "link" },
): Promise<DriverResult> {
  try {
    const { token, userAgent } = await redditAccessToken(creds, meta);
    const kind = args.kind ?? (args.url ? "link" : "self");
    const form: Record<string, string> = {
      sr: args.subreddit,
      title: args.title,
      kind,
      api_type: "json",
    };
    if (kind === "self") form.text = args.text ?? "";
    else form.url = args.url ?? "";
    return fetchForm(
      "POST",
      "https://oauth.reddit.com/api/submit",
      {
        authorization: `Bearer ${token}`,
        "user-agent": userAgent,
      },
      form,
    );
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ============================================================
// TikTok Ads
// ============================================================

export async function tiktokAdsCreateCampaign(
  creds: Creds,
  meta: Meta,
  args: { name: string; objective: string; dailyBudgetUsd: number },
): Promise<DriverResult> {
  try {
    const accessToken = requireStr(creds, "accessToken");
    const advertiserId = requireStr(meta, "advertiserId");
    return fetchJson(
      "POST",
      "https://business-api.tiktok.com/open_api/v1.3/campaign/create/",
      { "Access-Token": accessToken },
      {
        advertiser_id: advertiserId,
        campaign_name: args.name,
        objective_type: args.objective,
        budget_mode: "BUDGET_MODE_DAY",
        budget: args.dailyBudgetUsd,
        operation_status: "DISABLE",
      },
    );
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function tiktokAdsGetReport(
  creds: Creds,
  meta: Meta,
  args: { days?: number },
): Promise<DriverResult> {
  try {
    const accessToken = requireStr(creds, "accessToken");
    const advertiserId = requireStr(meta, "advertiserId");
    const days = Math.max(1, Math.min(90, args.days ?? 7));
    const end = new Date();
    const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const url = `https://business-api.tiktok.com/open_api/v1.3/report/integrated/get/?advertiser_id=${advertiserId}&report_type=BASIC&data_level=AUDIENCE_ADVERTISER&dimensions=%5B%22advertiser_id%22%5D&metrics=%5B%22spend%22%2C%22impressions%22%2C%22clicks%22%2C%22ctr%22%2C%22conversion%22%5D&start_date=${iso(start)}&end_date=${iso(end)}`;
    return fetchJson("GET", url, { "Access-Token": accessToken });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ============================================================
// GitHub
// ============================================================

export async function githubOpenPr(
  creds: Creds,
  meta: Meta,
  args: {
    owner?: string;
    repo?: string;
    title: string;
    head: string;
    base: string;
    body?: string;
    draft?: boolean;
  },
): Promise<DriverResult> {
  try {
    const token = requireStr(creds, "token");
    const owner = args.owner ?? str(meta.defaultOwner);
    const repo = args.repo ?? str(meta.defaultRepo);
    if (!owner || !repo) return { ok: false, error: "owner and repo are required" };
    return fetchJson(
      "POST",
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls`,
      {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
      },
      {
        title: args.title,
        head: args.head,
        base: args.base,
        body: args.body ?? "",
        draft: args.draft ?? false,
      },
    );
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function githubListIssues(
  creds: Creds,
  meta: Meta,
  args: { owner?: string; repo?: string; state?: "open" | "closed" | "all"; labels?: string },
): Promise<DriverResult> {
  try {
    const token = requireStr(creds, "token");
    const owner = args.owner ?? str(meta.defaultOwner);
    const repo = args.repo ?? str(meta.defaultRepo);
    if (!owner || !repo) return { ok: false, error: "owner and repo are required" };
    const qs = new URLSearchParams();
    qs.set("state", args.state ?? "open");
    if (args.labels) qs.set("labels", args.labels);
    return fetchJson(
      "GET",
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues?${qs}`,
      {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
      },
    );
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ============================================================
// WordPress
// ============================================================

export async function wordpressPublish(
  creds: Creds,
  meta: Meta,
  args: {
    title: string;
    content: string;
    status?: "draft" | "publish" | "pending";
    categories?: number[];
    tags?: number[];
  },
): Promise<DriverResult> {
  try {
    const username = requireStr(creds, "username");
    const appPassword = requireStr(creds, "applicationPassword").replace(/\s+/g, "");
    const siteUrl = requireStr(meta, "siteUrl").replace(/\/$/, "");
    const basic = Buffer.from(`${username}:${appPassword}`).toString("base64");
    return fetchJson(
      "POST",
      `${siteUrl}/wp-json/wp/v2/posts`,
      { authorization: `Basic ${basic}` },
      {
        title: args.title,
        content: args.content,
        status: args.status ?? "draft",
        categories: args.categories,
        tags: args.tags,
      },
    );
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ============================================================
// MakeUGC
// ============================================================

export async function makeUgcGenerate(
  creds: Creds,
  meta: Meta,
  args: { script: string; avatarId?: string; voiceId?: string },
): Promise<DriverResult> {
  try {
    const apiKey = requireStr(creds, "apiKey");
    const avatarId = args.avatarId ?? str(meta.defaultAvatarId);
    return fetchJson(
      "POST",
      "https://api.makeugc.com/v1/videos",
      { authorization: `Bearer ${apiKey}` },
      {
        script: args.script,
        avatar_id: avatarId || undefined,
        voice_id: args.voiceId,
      },
    );
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ============================================================
// Salesforce Marketing Cloud (triggered send)
// ============================================================

async function sfmcAccessToken(creds: Creds, meta: Meta): Promise<{ token: string; restBase: string }> {
  const clientId = requireStr(creds, "clientId");
  const clientSecret = requireStr(creds, "clientSecret");
  const authSubdomain = requireStr(meta, "authSubdomain");
  const restSubdomain = requireStr(meta, "restSubdomain");
  const accountId = str(meta.accountId);
  const body: Record<string, string> = {
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
  };
  if (accountId) body.account_id = accountId;
  const res = await fetch(`https://${authSubdomain}/v2/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as { access_token?: string; error_description?: string };
  if (!res.ok || !data.access_token) {
    throw new Error(`SFMC auth failed: ${data.error_description ?? res.status}`);
  }
  return { token: data.access_token, restBase: `https://${restSubdomain}` };
}

export async function sfmcSendEmail(
  creds: Creds,
  meta: Meta,
  args: {
    triggeredSendKey?: string;
    toAddress: string;
    subscriberKey?: string;
    attributes?: Record<string, unknown>;
  },
): Promise<DriverResult> {
  try {
    const { token, restBase } = await sfmcAccessToken(creds, meta);
    const key = args.triggeredSendKey ?? str(meta.defaultTriggeredSendKey);
    if (!key) return { ok: false, error: "triggeredSendKey is required (or set default in metadata)" };
    return fetchJson(
      "POST",
      `${restBase}/messaging/v1/messageDefinitionSends/key:${encodeURIComponent(key)}/send`,
      { authorization: `Bearer ${token}` },
      {
        To: {
          Address: args.toAddress,
          SubscriberKey: args.subscriberKey ?? args.toAddress,
          ContactAttributes: { SubscriberAttributes: args.attributes ?? {} },
        },
      },
    );
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ============================================================
// Firebase Cloud Messaging (HTTP v1)
// ============================================================
// FCM v1 requires an OAuth2 access token minted from the service
// account. We sign a JWT and exchange it for a token.

async function firebaseAccessToken(creds: Creds): Promise<string> {
  const raw = requireStr(creds, "serviceAccountJson");
  let sa: { client_email?: string; private_key?: string };
  try {
    sa = JSON.parse(raw) as typeof sa;
  } catch {
    throw new Error("serviceAccountJson is not valid JSON");
  }
  if (!sa.client_email || !sa.private_key) {
    throw new Error("service account JSON missing client_email or private_key");
  }
  const { createSign } = await import("node:crypto");
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(
    JSON.stringify({ alg: "RS256", typ: "JWT" }),
  ).toString("base64url");
  const claims = Buffer.from(
    JSON.stringify({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  ).toString("base64url");
  const unsigned = `${header}.${claims}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  const sig = signer.sign(sa.private_key).toString("base64url");
  const jwt = `${unsigned}.${sig}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }).toString(),
  });
  const data = (await res.json()) as { access_token?: string; error_description?: string };
  if (!res.ok || !data.access_token) {
    throw new Error(`Firebase auth failed: ${data.error_description ?? res.status}`);
  }
  return data.access_token;
}

export async function firebasePush(
  creds: Creds,
  meta: Meta,
  args: {
    token?: string;
    topic?: string;
    title: string;
    body: string;
    data?: Record<string, string>;
  },
): Promise<DriverResult> {
  try {
    const accessToken = await firebaseAccessToken(creds);
    const projectId = requireStr(meta, "projectId");
    if (!args.token && !args.topic) {
      return { ok: false, error: "either token or topic is required" };
    }
    const message: Record<string, unknown> = {
      notification: { title: args.title, body: args.body },
    };
    if (args.token) message.token = args.token;
    if (args.topic) message.topic = args.topic;
    if (args.data) message.data = args.data;
    return fetchJson(
      "POST",
      `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`,
      { authorization: `Bearer ${accessToken}` },
      { message },
    );
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
