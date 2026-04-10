// Provider catalog — describes each integration so the Settings UI can
// render a dynamic "paste your tokens" form. Shipped to the client as
// the response of GET /companies/:companyId/integrations/providers.
//
// Each credential field maps 1:1 to a JSON key in the credentials blob.
// Each metadata field is non-secret and gets stored in metadataJson.
//
// `authHint` is free-form help text pointing the operator at where to
// obtain each credential — this is the single biggest UX delta that
// separates "integrations work" from "integrations are a puzzle".

export type FieldKind = "text" | "password" | "url" | "textarea" | "select";

export interface ProviderField {
  key: string;
  label: string;
  kind: FieldKind;
  required: boolean;
  placeholder?: string;
  help?: string;
  options?: Array<{ value: string; label: string }>;
}

export interface ProviderDescriptor {
  provider: string;
  name: string;
  category: "ads" | "social" | "dev" | "cms" | "content" | "email" | "messaging";
  description: string;
  authHint: string;
  docsUrl: string;
  defaultRoles: string[]; // agent role names that get auto-bound on create
  credentialFields: ProviderField[];
  metadataFields: ProviderField[];
  tools: string[];
}

export const PROVIDER_CATALOG: ProviderDescriptor[] = [
  {
    provider: "google_ads",
    name: "Google Ads",
    category: "ads",
    description: "Create campaigns, ad groups, and pull performance reports from Google Ads.",
    authHint:
      "You need 3 things: (1) a Google Ads developer token (apply at ads.google.com/aw/apicenter), (2) an OAuth2 refresh token for an authorized user, (3) the customer ID of the account to manage.",
    docsUrl: "https://developers.google.com/google-ads/api/docs/oauth/overview",
    defaultRoles: ["marketer", "marketing", "growth", "performance", "ads", "ppc", "demand", "acquisition", "paid", "cmo"],
    credentialFields: [
      { key: "developerToken", label: "Developer Token", kind: "password", required: true, help: "From ads.google.com/aw/apicenter" },
      { key: "oauthClientId", label: "OAuth Client ID", kind: "text", required: true },
      { key: "oauthClientSecret", label: "OAuth Client Secret", kind: "password", required: true },
      { key: "refreshToken", label: "Refresh Token", kind: "password", required: true, help: "Generated once via the OAuth2 consent flow" },
    ],
    metadataFields: [
      { key: "customerId", label: "Customer ID", kind: "text", required: true, placeholder: "123-456-7890", help: "The ad account to manage. No dashes." },
      { key: "loginCustomerId", label: "Login Customer ID (manager)", kind: "text", required: false, help: "Only if accessing via an MCC" },
    ],
    tools: [
      "paperclipGoogleAdsCreateCampaign",
      "paperclipGoogleAdsGetPerformance",
      "paperclipGoogleAdsListCampaigns",
      "paperclipGoogleAdsUpdateCampaignStatus",
      "paperclipGoogleAdsUpdateCampaignBudget",
      "paperclipGoogleAdsGetSearchTerms",
    ],
  },
  {
    provider: "facebook_ads",
    name: "Facebook Ads (Meta)",
    category: "ads",
    description: "Create campaigns, ad sets, ads, and pull insights from Meta Ads Manager.",
    authHint:
      "Create a System User at business.facebook.com → Business Settings → System Users. Generate a long-lived access token with ads_management + ads_read + business_management scopes. Find your Ad Account ID at adsmanager.facebook.com (prefix with 'act_').",
    docsUrl: "https://developers.facebook.com/docs/marketing-api/overview/authentication",
    defaultRoles: ["marketer", "marketing", "growth", "performance", "ads", "social", "paid", "acquisition", "demand", "cmo", "brand"],
    credentialFields: [
      { key: "accessToken", label: "System User Access Token", kind: "password", required: true },
    ],
    metadataFields: [
      { key: "adAccountId", label: "Ad Account ID", kind: "text", required: true, placeholder: "act_1234567890" },
      { key: "apiVersion", label: "API Version", kind: "text", required: false, placeholder: "v21.0" },
    ],
    tools: [
      "paperclipFacebookAdsCreateCampaign",
      "paperclipFacebookAdsGetInsights",
      "paperclipFacebookAdsListCampaigns",
      "paperclipFacebookAdsUpdateCampaignStatus",
      "paperclipFacebookAdsCreateAdSet",
    ],
  },
  {
    provider: "x",
    name: "X (Twitter)",
    category: "social",
    description: "Post tweets and search the public timeline.",
    authHint:
      "Create a Project + App at developer.x.com/en/portal/dashboard. Generate OAuth 1.0a consumer keys + user access tokens with write permission. Bearer token alone is NOT enough for posting.",
    docsUrl: "https://developer.x.com/en/docs/authentication/oauth-1-0a",
    defaultRoles: ["marketer", "marketing", "content", "growth", "social", "brand", "community", "pr", "copywriter", "evangelist", "cmo"],
    credentialFields: [
      { key: "apiKey", label: "API Key (Consumer Key)", kind: "password", required: true },
      { key: "apiSecret", label: "API Key Secret", kind: "password", required: true },
      { key: "accessToken", label: "Access Token", kind: "password", required: true },
      { key: "accessSecret", label: "Access Token Secret", kind: "password", required: true },
    ],
    metadataFields: [
      { key: "handle", label: "Posting Handle", kind: "text", required: false, placeholder: "@yourhandle" },
    ],
    tools: ["paperclipXPost", "paperclipXSearch", "paperclipXGetTweetMetrics"],
  },
  {
    provider: "reddit",
    name: "Reddit",
    category: "social",
    description: "Submit posts and comments to subreddits.",
    authHint:
      "Create an app at reddit.com/prefs/apps (type: 'script'). Use the client id + secret + your username + password to authenticate. Posting requires the account to have enough karma in the target subreddit.",
    docsUrl: "https://github.com/reddit-archive/reddit/wiki/OAuth2",
    defaultRoles: ["marketer", "marketing", "content", "growth", "community", "brand", "social", "pr"],
    credentialFields: [
      { key: "clientId", label: "Client ID", kind: "password", required: true },
      { key: "clientSecret", label: "Client Secret", kind: "password", required: true },
      { key: "username", label: "Username", kind: "text", required: true },
      { key: "password", label: "Password", kind: "password", required: true },
    ],
    metadataFields: [
      { key: "userAgent", label: "User Agent", kind: "text", required: false, placeholder: "paperclip-bot/1.0 by u/yourname" },
    ],
    tools: ["paperclipRedditPost", "paperclipRedditComment", "paperclipRedditSearch"],
  },
  {
    provider: "tiktok_ads",
    name: "TikTok Ads",
    category: "ads",
    description: "Create campaigns and pull reports from TikTok Ads Manager.",
    authHint:
      "Create a developer app at business-api.tiktok.com/portal. Run the OAuth flow to get a long-lived access_token for your advertiser. The advertiser_id identifies which ad account the token can act on.",
    docsUrl: "https://business-api.tiktok.com/portal/docs?id=1738373141733378",
    defaultRoles: ["marketer", "marketing", "growth", "performance", "ads", "social", "paid", "acquisition", "demand", "cmo"],
    credentialFields: [
      { key: "accessToken", label: "Access Token", kind: "password", required: true },
    ],
    metadataFields: [
      { key: "advertiserId", label: "Advertiser ID", kind: "text", required: true },
    ],
    tools: [
      "paperclipTikTokAdsCreateCampaign",
      "paperclipTikTokAdsGetReport",
      "paperclipTikTokAdsListCampaigns",
      "paperclipTikTokAdsUpdateCampaignStatus",
    ],
  },
  {
    provider: "github",
    name: "GitHub",
    category: "dev",
    description: "Open pull requests, list issues, and push commits to repositories.",
    authHint:
      "Create a fine-grained Personal Access Token at github.com/settings/personal-access-tokens/new. Grant Contents (read/write), Pull Requests (read/write), and Issues (read/write) permissions on the target repos.",
    docsUrl: "https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens",
    defaultRoles: ["engineer", "developer", "cto"],
    credentialFields: [
      { key: "token", label: "Personal Access Token", kind: "password", required: true, placeholder: "github_pat_..." },
    ],
    metadataFields: [
      { key: "defaultOwner", label: "Default Owner", kind: "text", required: false, help: "Used when tools omit the owner" },
      { key: "defaultRepo", label: "Default Repo", kind: "text", required: false },
    ],
    tools: ["paperclipGithubOpenPr", "paperclipGithubListIssues"],
  },
  {
    provider: "wordpress",
    name: "WordPress",
    category: "cms",
    description: "Publish posts, pages, and update content on a WordPress site.",
    authHint:
      "Go to Users → Profile → Application Passwords on your WordPress site. Create an application password and paste it below with the username. Requires WordPress 5.6+ with REST API enabled.",
    docsUrl: "https://developer.wordpress.org/rest-api/reference/",
    defaultRoles: ["content", "marketer", "marketing", "writer", "blogger", "seo", "editor", "cmo", "brand"],
    credentialFields: [
      { key: "username", label: "Username", kind: "text", required: true },
      { key: "applicationPassword", label: "Application Password", kind: "password", required: true, placeholder: "xxxx xxxx xxxx xxxx xxxx xxxx" },
    ],
    metadataFields: [
      { key: "siteUrl", label: "Site URL", kind: "url", required: true, placeholder: "https://example.com" },
    ],
    tools: [
      "paperclipWordpressPublish",
      "paperclipWordpressUpdatePost",
      "paperclipWordpressListPosts",
      "paperclipWordpressUploadMedia",
    ],
  },
  {
    provider: "make_ugc",
    name: "MakeUGC",
    category: "content",
    description: "Generate AI-powered UGC-style videos from scripts.",
    authHint:
      "Get an API key from your MakeUGC dashboard → Settings → API. The API uses bearer authentication.",
    docsUrl: "https://makeugc.com",
    defaultRoles: ["marketer", "marketing", "content", "creative", "brand", "growth", "performance", "ads", "social", "cmo"],
    credentialFields: [
      { key: "apiKey", label: "API Key", kind: "password", required: true },
    ],
    metadataFields: [
      { key: "defaultAvatarId", label: "Default Avatar ID", kind: "text", required: false },
    ],
    tools: ["paperclipMakeUgcGenerate", "paperclipMakeUgcGetStatus"],
  },
  {
    provider: "sfmc",
    name: "Salesforce Marketing Cloud",
    category: "email",
    description: "Trigger transactional and marketing emails via SFMC.",
    authHint:
      "In Setup → Platform Tools → Apps → Installed Packages, create a server-to-server package with Email + Journey scopes. You will get a client id, client secret, and an auth tenant subdomain. The triggered-send definition key identifies which email template to send.",
    docsUrl: "https://developer.salesforce.com/docs/marketing/marketing-cloud/guide/access-token-s2s.html",
    defaultRoles: ["marketer", "marketing", "growth", "crm", "email", "lifecycle", "retention", "cmo"],
    credentialFields: [
      { key: "clientId", label: "Client ID", kind: "password", required: true },
      { key: "clientSecret", label: "Client Secret", kind: "password", required: true },
    ],
    metadataFields: [
      { key: "authSubdomain", label: "Auth Subdomain", kind: "text", required: true, placeholder: "mc123456789.auth.marketingcloudapis.com" },
      { key: "restSubdomain", label: "REST Subdomain", kind: "text", required: true, placeholder: "mc123456789.rest.marketingcloudapis.com" },
      { key: "accountId", label: "Account ID (MID)", kind: "text", required: false },
      { key: "defaultTriggeredSendKey", label: "Default Triggered Send Key", kind: "text", required: false },
    ],
    tools: ["paperclipSfmcSendEmail"],
  },
  {
    provider: "firebase",
    name: "Firebase (FCM)",
    category: "messaging",
    description: "Send push notifications and in-app messages via Firebase Cloud Messaging.",
    authHint:
      "Create a service account at console.firebase.google.com → Project Settings → Service accounts → Generate new private key. Paste the entire JSON file into the Service Account JSON field.",
    docsUrl: "https://firebase.google.com/docs/cloud-messaging/migrate-v1",
    defaultRoles: ["growth", "pm", "engineer", "marketer", "marketing", "lifecycle", "retention", "crm", "mobile", "cmo"],
    credentialFields: [
      { key: "serviceAccountJson", label: "Service Account JSON", kind: "textarea", required: true, help: "The full JSON file downloaded from Firebase" },
    ],
    metadataFields: [
      { key: "projectId", label: "Project ID", kind: "text", required: true, placeholder: "my-project-id" },
    ],
    tools: ["paperclipFirebasePush", "paperclipFirebaseSubscribeTopic"],
  },
];

export function getProviderDescriptor(provider: string): ProviderDescriptor | null {
  return PROVIDER_CATALOG.find((p) => p.provider === provider) ?? null;
}

// Role → default providers mapping, derived from the catalog. Used
// when a new agent is created.
export function defaultProvidersForRole(role: string | null | undefined): string[] {
  if (!role) return [];
  const needle = role.toLowerCase();
  const providers: string[] = [];
  for (const p of PROVIDER_CATALOG) {
    if (p.defaultRoles.some((r) => needle.includes(r))) {
      providers.push(p.provider);
    }
  }
  return providers;
}
