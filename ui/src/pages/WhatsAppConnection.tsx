import { useEffect, useState, useCallback } from "react";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useCompany } from "../context/CompanyContext";
import {
  MessageCircle,
  CheckCircle2,
  XCircle,
  Loader2,
  RefreshCw,
  LogOut,
  Smartphone,
  Save,
  Phone,
} from "lucide-react";
import { Button } from "@/components/ui/button";

interface WhatsAppStatus {
  status: "disconnected" | "connecting" | "qr_pending" | "connected";
  connected: boolean;
  phone: string | null;
  name: string | null;
  qrCode: string | null;
  plugin: string;
}

interface PluginConfig {
  chairmanPhoneNumber?: string | number;
  authDataDir?: string;
}

const PLUGIN_KEY = "paperclip.whatsapp-gateway";

async function fetchWhatsAppStatus(): Promise<WhatsAppStatus> {
  const res = await fetch(`/api/plugins/${PLUGIN_KEY}/bridge/data`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key: "whatsapp-status" }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || err.error || `HTTP ${res.status}`);
  }
  const json = await res.json();
  return json.data as WhatsAppStatus;
}

async function fetchPluginConfig(): Promise<PluginConfig> {
  const res = await fetch(`/api/plugins/${PLUGIN_KEY}/config`);
  if (!res.ok) return {};
  const json = await res.json();
  return (json.config ?? json.configJson ?? json) as PluginConfig;
}

async function savePluginConfig(config: PluginConfig): Promise<void> {
  const res = await fetch(`/api/plugins/${PLUGIN_KEY}/config`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || err.error || `Failed to save (HTTP ${res.status})`);
  }
}

export function WhatsAppConnection() {
  const { setBreadcrumbs } = useBreadcrumbs();
  const { selectedCompany } = useCompany();

  const [status, setStatus] = useState<WhatsAppStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Phone number config
  const [phoneNumber, setPhoneNumber] = useState("");
  const [savedPhone, setSavedPhone] = useState("");
  const [phoneSaving, setPhoneSaving] = useState(false);
  const [phoneSaved, setPhoneSaved] = useState(false);
  const [phoneError, setPhoneError] = useState<string | null>(null);

  useEffect(() => {
    setBreadcrumbs([
      { label: selectedCompany?.name ?? "Company" },
      { label: "Settings" },
      { label: "WhatsApp" },
    ]);
  }, [setBreadcrumbs, selectedCompany]);

  const poll = useCallback(async () => {
    try {
      const data = await fetchWhatsAppStatus();
      setStatus(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  // Load config on mount
  useEffect(() => {
    fetchPluginConfig().then((cfg) => {
      const num = cfg.chairmanPhoneNumber == null ? "" : String(cfg.chairmanPhoneNumber);
      setPhoneNumber(num);
      setSavedPhone(num);
    });
  }, []);

  useEffect(() => {
    poll();
    const interval = setInterval(poll, 3000);
    return () => clearInterval(interval);
  }, [poll]);

  const handleLogout = async () => {
    try {
      await fetch(`/api/plugins/${PLUGIN_KEY}/bridge/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "logout" }),
      });
      await poll();
    } catch {
      // ignore
    }
  };

  const handleSavePhone = async () => {
    const cleaned = phoneNumber.replace(/[\s\-()]/g, "");
    if (!cleaned) {
      setPhoneError("Phone number is required");
      return;
    }
    setPhoneSaving(true);
    setPhoneError(null);
    setPhoneSaved(false);
    try {
      await savePluginConfig({ chairmanPhoneNumber: cleaned });
      setSavedPhone(cleaned);
      setPhoneNumber(cleaned);
      setPhoneSaved(true);
      setTimeout(() => setPhoneSaved(false), 3000);
    } catch (err) {
      setPhoneError(err instanceof Error ? err.message : String(err));
    } finally {
      setPhoneSaving(false);
    }
  };

  const phoneChanged = phoneNumber.replace(/[\s\-()]/g, "") !== savedPhone;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="max-w-2xl mx-auto py-10 px-6">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center">
            <MessageCircle className="h-5 w-5 text-emerald-500" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">WhatsApp Connection</h1>
            <p className="text-sm text-muted-foreground">
              Connect your WhatsApp to receive reports and approve agent actions
            </p>
          </div>
        </div>

        {/* Phone number config */}
        <div className="rounded-xl border border-border bg-card p-5 mb-4">
          <div className="flex items-center gap-2 mb-3">
            <Phone className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold text-foreground">Recipient Phone Number</h3>
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            The phone number where agents will send reports, approvals, and notifications. Include country code (e.g. 972541234567).
          </p>
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">+</span>
              <input
                type="tel"
                value={phoneNumber}
                onChange={(e) => {
                  setPhoneNumber(e.target.value);
                  setPhoneSaved(false);
                  setPhoneError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && phoneChanged) handleSavePhone();
                }}
                placeholder="972541234567"
                className="w-full rounded-md border border-border bg-background px-3 py-2 pl-7 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <Button
              size="sm"
              onClick={handleSavePhone}
              disabled={!phoneChanged || phoneSaving}
            >
              {phoneSaving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : phoneSaved ? (
                <CheckCircle2 className="h-3.5 w-3.5" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
              <span className="ml-1.5">{phoneSaved ? "Saved" : "Save"}</span>
            </Button>
          </div>
          {phoneError && (
            <p className="text-xs text-destructive mt-2">{phoneError}</p>
          )}
          {phoneSaved && (
            <p className="text-xs text-emerald-600 mt-2">Phone number saved successfully</p>
          )}
        </div>

        {/* Status card */}
        <div className="rounded-xl border border-border bg-card p-6">
          {loading && !status ? (
            <div className="flex flex-col items-center gap-3 py-10">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Connecting to WhatsApp Gateway...</p>
            </div>
          ) : error && !status ? (
            <div className="flex flex-col items-center gap-3 py-10">
              <XCircle className="h-8 w-8 text-destructive" />
              <p className="text-sm text-destructive font-medium">Failed to connect</p>
              <p className="text-xs text-muted-foreground max-w-md text-center">{error}</p>
              <Button variant="outline" size="sm" onClick={poll} className="mt-2">
                <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                Retry
              </Button>
            </div>
          ) : status?.connected ? (
            /* Connected state */
            <div className="flex flex-col items-center gap-4 py-6">
              <div className="w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center">
                <CheckCircle2 className="h-8 w-8 text-emerald-500" />
              </div>
              <div className="text-center">
                <h2 className="text-lg font-semibold text-foreground">WhatsApp Connected</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  {status.name && <span className="font-medium text-foreground">{status.name}</span>}
                  {status.name && status.phone && " \u00b7 "}
                  {status.phone && <span>+{status.phone}</span>}
                </p>
              </div>

              <div className="rounded-lg bg-emerald-500/5 border border-emerald-500/20 p-4 w-full max-w-sm">
                <p className="text-xs text-emerald-700 dark:text-emerald-400 text-center">
                  Your agents can now send WhatsApp messages, request approvals, and deliver daily reports.
                </p>
              </div>

              <Button variant="outline" size="sm" className="text-destructive" onClick={handleLogout}>
                <LogOut className="h-3.5 w-3.5 mr-1.5" />
                Disconnect
              </Button>
            </div>
          ) : status?.status === "qr_pending" && status.qrCode ? (
            /* QR code state */
            <div className="flex flex-col items-center gap-5 py-4">
              <div className="text-center">
                <h2 className="text-lg font-semibold text-foreground">Scan QR Code</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Open WhatsApp on your phone and scan this code
                </p>
              </div>

              <div className="rounded-xl border-2 border-border bg-white p-3 shadow-sm">
                <img
                  src={status.qrCode}
                  alt="WhatsApp QR Code"
                  className="w-[280px] h-[280px]"
                />
              </div>

              <div className="flex items-start gap-3 rounded-lg bg-muted/50 p-4 max-w-sm">
                <Smartphone className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
                <div className="text-xs text-muted-foreground space-y-1.5">
                  <p><strong className="text-foreground">Step 1:</strong> Open WhatsApp on your phone</p>
                  <p><strong className="text-foreground">Step 2:</strong> Tap <strong>Menu</strong> or <strong>Settings</strong> &rarr; <strong>Linked Devices</strong></p>
                  <p><strong className="text-foreground">Step 3:</strong> Tap <strong>Link a Device</strong></p>
                  <p><strong className="text-foreground">Step 4:</strong> Point your phone camera at this QR code</p>
                </div>
              </div>

              <p className="text-xs text-muted-foreground animate-pulse">
                Waiting for scan... QR refreshes automatically
              </p>
            </div>
          ) : (
            /* Connecting / waiting state */
            <div className="flex flex-col items-center gap-3 py-10">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                {status?.status === "connecting" ? "Connecting to WhatsApp..." : "Waiting for QR code..."}
              </p>
              <Button variant="outline" size="sm" onClick={poll} className="mt-2">
                <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                Refresh
              </Button>
            </div>
          )}
        </div>

        {/* Info section */}
        <div className="mt-6 rounded-lg border border-border bg-card p-5">
          <h3 className="text-sm font-semibold text-foreground mb-3">What can agents do via WhatsApp?</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[
              { title: "Daily Reports", desc: "Receive daily summaries of all agent activity" },
              { title: "Approval Requests", desc: "Approve or reject agent actions on the go" },
              { title: "KPI Dashboards", desc: "Get formatted metric dashboards in chat" },
              { title: "Notifications", desc: "Real-time alerts for important events" },
            ].map((item) => (
              <div key={item.title} className="rounded-md bg-muted/30 p-3">
                <p className="text-xs font-medium text-foreground">{item.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
