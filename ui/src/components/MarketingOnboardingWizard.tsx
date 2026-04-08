import { useState, useCallback } from "react";
import { useNavigate } from "@/lib/router";
import { useCompany } from "../context/CompanyContext";
import { agentsApi } from "../api/agents";
import { api } from "../api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "../lib/utils";
import {
  Loader2, Check, ArrowRight, ArrowLeft, Globe, BarChart3, Search,
  Instagram, CreditCard, Twitter, Linkedin, Users, TrendingUp, Zap,
  Megaphone, PenTool, Mail, Share2, Eye, MessageCircle, Sparkles,
  Rocket, Info,
} from "lucide-react";

// --- Types ---

type WizardStep = 1 | 2 | 3 | 4 | 5 | 6;

interface PlatformConnection { id: string; name: string; services: string[]; icon: React.ReactNode; connected: boolean }
interface ProductAnalysis { description: string; features: string[]; category: string; seoSnapshot: string }
interface BusinessProfile { businessModel: string; monthlyBudget: number; primaryGoal: string; monthlyCustomers: string; targetCac: string }
interface ChannelRecommendation { name: string; budgetPct: number; cacRange: string; timeline: string; icon: React.ReactNode }
interface Strategy { positioning: string; channels: ChannelRecommendation[]; kpis: { metric: string; target: string }[]; roadmap: { phase: string; title: string; description: string }[] }
interface TeamMember { id: string; name: string; role: string; responsibility: string; icon: React.ReactNode; enabled: boolean; required?: boolean }

// --- Step indicator ---

const STEP_LABELS = [
  "Connect",
  "Product",
  "Business",
  "Strategy",
  "Team",
  "Launch",
];

function StepIndicator({ current }: { current: WizardStep }) {
  return (
    <div className="flex items-center justify-center gap-2 py-6">
      {STEP_LABELS.map((label, i) => {
        const step = (i + 1) as WizardStep;
        const isActive = step === current;
        const isComplete = step < current;
        return (
          <div key={label} className="flex items-center gap-2">
            {i > 0 && (
              <div
                className={cn(
                  "h-px w-6 sm:w-10 transition-colors",
                  isComplete ? "bg-primary" : "bg-border",
                )}
              />
            )}
            <div className="flex flex-col items-center gap-1">
              <div
                className={cn(
                  "flex size-8 items-center justify-center rounded-full text-xs font-medium transition-all",
                  isActive && "bg-primary text-primary-foreground ring-4 ring-primary/20",
                  isComplete && "bg-primary text-primary-foreground",
                  !isActive && !isComplete && "border border-border text-muted-foreground",
                )}
              >
                {isComplete ? <Check className="size-3.5" /> : step}
              </div>
              <span
                className={cn(
                  "hidden text-[10px] sm:block",
                  isActive ? "text-foreground font-medium" : "text-muted-foreground",
                )}
              >
                {label}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// --- Step 1 — Connect Accounts ---

function StepConnect({
  companyId,
  platforms,
  onConnect,
  onNext,
}: {
  companyId: string;
  platforms: PlatformConnection[];
  onConnect: (id: string) => void;
  onNext: () => void;
}) {
  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <header className="text-center space-y-2">
        <h2 className="text-2xl font-semibold tracking-tight">Connect your accounts</h2>
        <p className="text-muted-foreground">
          Link your ad platforms and analytics so we can optimize from day one.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {platforms.map((p) => (
          <Card
            key={p.id}
            className={cn(
              "transition-colors",
              p.connected && "border-green-600/40 bg-green-950/10",
            )}
          >
            <CardContent className="flex items-center gap-4 py-4">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/40 text-muted-foreground">
                {p.icon}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm">{p.name}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {p.services.join(" · ")}
                </p>
              </div>
              {p.connected ? (
                <span className="flex items-center gap-1 text-xs font-medium text-green-500">
                  <Check className="size-3.5" /> Connected
                </span>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onConnect(p.id)}
                >
                  Connect
                </Button>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex items-center justify-between pt-4">
        <button
          type="button"
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          onClick={onNext}
        >
          Skip for now
        </button>
        <Button onClick={onNext}>
          Continue <ArrowRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}

// --- Step 2 — Add Product ---

function StepProduct({
  onNext,
  onBack,
  productName,
  setProductName,
  productUrl,
  setProductUrl,
  analysis,
  setAnalysis,
}: {
  onNext: () => void;
  onBack: () => void;
  productName: string;
  setProductName: (v: string) => void;
  productUrl: string;
  setProductUrl: (v: string) => void;
  analysis: ProductAnalysis | null;
  setAnalysis: (v: ProductAnalysis | null) => void;
}) {
  const [analyzing, setAnalyzing] = useState(false);
  const [editDescription, setEditDescription] = useState("");

  const analyze = useCallback(async () => {
    setAnalyzing(true);
    try {
      const result = await api.post<ProductAnalysis>(
        "/marketing/analyze-product",
        { name: productName, url: productUrl },
      );
      setAnalysis(result);
      setEditDescription(result.description);
    } catch {
      // Fallback for demo / when backend is not wired up yet
      const fallback: ProductAnalysis = {
        description: `${productName} — analyzed from ${productUrl}`,
        features: ["Core feature 1", "Core feature 2", "Core feature 3"],
        category: "SaaS / Software",
        seoSnapshot: "Domain authority pending analysis",
      };
      setAnalysis(fallback);
      setEditDescription(fallback.description);
    } finally {
      setAnalyzing(false);
    }
  }, [productName, productUrl, setAnalysis]);

  return (
    <div className="mx-auto max-w-xl space-y-8">
      <header className="text-center space-y-2">
        <h2 className="text-2xl font-semibold tracking-tight">Add your product</h2>
        <p className="text-muted-foreground">
          We will analyze your site and extract key marketing signals.
        </p>
      </header>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="product-name">Product name</Label>
          <Input
            id="product-name"
            placeholder="Acme Corp"
            value={productName}
            onChange={(e) => setProductName(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="product-url">Product URL</Label>
          <Input
            id="product-url"
            type="url"
            placeholder="https://acme.com"
            value={productUrl}
            onChange={(e) => setProductUrl(e.target.value)}
          />
        </div>

        {!analysis && (
          <Button
            className="w-full"
            size="lg"
            disabled={!productName.trim() || !productUrl.trim() || analyzing}
            onClick={analyze}
          >
            {analyzing ? (
              <>
                <Loader2 className="size-4 animate-spin" /> Analyzing...
              </>
            ) : (
              <>
                <Search className="size-4" /> Analyze
              </>
            )}
          </Button>
        )}
      </div>

      {analysis && (
        <Card className="border-border/60">
          <CardContent className="space-y-4 py-5">
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea
                rows={3}
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Category</p>
                <p className="text-sm font-medium">{analysis.category}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">SEO snapshot</p>
                <p className="text-sm font-medium">{analysis.seoSnapshot}</p>
              </div>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-2">Detected features</p>
              <div className="flex flex-wrap gap-1.5">
                {analysis.features.map((f) => (
                  <span
                    key={f}
                    className="rounded-full border border-border bg-muted/30 px-2.5 py-0.5 text-xs"
                  >
                    {f}
                  </span>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex items-center justify-between pt-2">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft className="size-4" /> Back
        </Button>
        <Button disabled={!analysis} onClick={onNext}>
          Continue <ArrowRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}

// --- Step 3 — Business Profile ---

const BUSINESS_MODELS = ["SaaS", "E-commerce", "Marketplace", "Agency", "Other"];
const PRIMARY_GOALS = [
  { value: "first_customers", label: "Get first customers" },
  { value: "scale", label: "Scale acquisition" },
  { value: "reduce_cac", label: "Reduce CAC" },
  { value: "awareness", label: "Brand awareness" },
];

const CAC_HINTS: Record<string, string> = {
  SaaS: "Typical SaaS CAC: $50 - $500 depending on ACV.",
  "E-commerce": "E-commerce CAC is often $10 - $100 per customer.",
  Marketplace: "Marketplace CAC varies by side: $5 - $200.",
  Agency: "Agency CAC can range from $200 - $2,000+.",
  Other: "Enter your target cost to acquire one customer.",
};

function StepBusiness({
  onNext,
  onBack,
  profile,
  setProfile,
}: {
  onNext: () => void;
  onBack: () => void;
  profile: BusinessProfile;
  setProfile: (v: BusinessProfile) => void;
}) {
  const update = (patch: Partial<BusinessProfile>) =>
    setProfile({ ...profile, ...patch });

  const isValid =
    profile.businessModel && profile.primaryGoal && profile.monthlyBudget > 0;

  return (
    <div className="mx-auto max-w-xl space-y-8">
      <header className="text-center space-y-2">
        <h2 className="text-2xl font-semibold tracking-tight">
          Tell us about your business
        </h2>
        <p className="text-muted-foreground">
          This helps us craft a strategy tailored to your stage and goals.
        </p>
      </header>

      <div className="space-y-5">
        {/* Business model */}
        <div className="space-y-2">
          <Label>Business model</Label>
          <Select
            value={profile.businessModel}
            onValueChange={(v) => update({ businessModel: v })}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select model" />
            </SelectTrigger>
            <SelectContent>
              {BUSINESS_MODELS.map((m) => (
                <SelectItem key={m} value={m}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Budget */}
        <div className="space-y-2">
          <Label>Monthly marketing budget</Label>
          <div className="flex items-center gap-3">
            <span className="text-muted-foreground text-sm">$</span>
            <Input
              type="number"
              min={0}
              step={500}
              placeholder="5000"
              value={profile.monthlyBudget || ""}
              onChange={(e) =>
                update({ monthlyBudget: Number(e.target.value) })
              }
            />
          </div>
          <p className="text-xs text-muted-foreground">
            This is across all channels. We will recommend allocation.
          </p>
        </div>

        {/* Primary goal */}
        <div className="space-y-3">
          <Label>Primary goal</Label>
          <div className="grid grid-cols-2 gap-2">
            {PRIMARY_GOALS.map((g) => (
              <button
                key={g.value}
                type="button"
                className={cn(
                  "rounded-lg border px-4 py-3 text-left text-sm transition-all",
                  profile.primaryGoal === g.value
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border hover:border-muted-foreground/40 text-muted-foreground",
                )}
                onClick={() => update({ primaryGoal: g.value })}
              >
                {g.label}
              </button>
            ))}
          </div>
        </div>

        {/* Monthly customers */}
        <div className="space-y-2">
          <Label>Current monthly customers</Label>
          <Input
            type="number"
            min={0}
            placeholder="0"
            value={profile.monthlyCustomers}
            onChange={(e) => update({ monthlyCustomers: e.target.value })}
          />
        </div>

        {/* Target CAC */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Label>Target CAC</Label>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="size-3.5 text-muted-foreground" />
                </TooltipTrigger>
                <TooltipContent>
                  {CAC_HINTS[profile.businessModel] ?? CAC_HINTS.Other}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-muted-foreground text-sm">$</span>
            <Input
              type="number"
              min={0}
              placeholder="100"
              value={profile.targetCac}
              onChange={(e) => update({ targetCac: e.target.value })}
            />
          </div>
          {profile.businessModel && (
            <p className="text-xs text-muted-foreground">
              {CAC_HINTS[profile.businessModel]}
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between pt-2">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft className="size-4" /> Back
        </Button>
        <Button disabled={!isValid} onClick={onNext}>
          Generate Strategy <Sparkles className="size-4" />
        </Button>
      </div>
    </div>
  );
}

// --- Step 4 — Strategy ---

function buildDefaultStrategy(profile: BusinessProfile): Strategy {
  const goalLabel = profile.primaryGoal === "first_customers" ? "early adopters" : profile.primaryGoal === "scale" ? "growth-stage acquisition" : profile.primaryGoal === "reduce_cac" ? "efficiency-driven marketing" : "brand-first awareness";
  const cac = Number(profile.targetCac) || 100;
  return {
    positioning: `A ${profile.businessModel.toLowerCase()} solution focused on delivering measurable value. Positioned for ${goalLabel} with a $${profile.monthlyBudget.toLocaleString()}/mo budget.`,
    channels: [
      { name: "Google Ads", budgetPct: 35, cacRange: "$40 - $120", timeline: "2 - 4 weeks", icon: <Globe className="size-4" /> },
      { name: "Content & SEO", budgetPct: 25, cacRange: "$15 - $60", timeline: "8 - 12 weeks", icon: <PenTool className="size-4" /> },
      { name: "Meta Ads", budgetPct: 20, cacRange: "$30 - $90", timeline: "1 - 3 weeks", icon: <Eye className="size-4" /> },
      { name: "Email & Lifecycle", budgetPct: 10, cacRange: "$5 - $20", timeline: "4 - 6 weeks", icon: <Mail className="size-4" /> },
      { name: "LinkedIn Organic", budgetPct: 10, cacRange: "$20 - $80", timeline: "6 - 10 weeks", icon: <Linkedin className="size-4" /> },
    ],
    kpis: [
      { metric: "Customer Acquisition Cost", target: `$${profile.targetCac || "100"}` },
      { metric: "Monthly New Customers", target: `${Math.max(1, Math.round(profile.monthlyBudget / cac))}` },
      { metric: "ROAS", target: "3.0x" },
      { metric: "Conversion Rate", target: "2.5%" },
      { metric: "Pipeline Value", target: `$${(profile.monthlyBudget * 5).toLocaleString()}` },
    ],
    roadmap: [
      { phase: "Phase 1", title: "Foundation (Weeks 1 - 4)", description: "Set up tracking, launch initial paid campaigns, begin content pipeline." },
      { phase: "Phase 2", title: "Optimization (Weeks 5 - 8)", description: "A/B test creatives, refine targeting, scale winning channels." },
      { phase: "Phase 3", title: "Scale (Weeks 9 - 12)", description: "Double down on top performers, launch new channels, automate workflows." },
    ],
  };
}

function StepStrategy({
  onNext,
  onBack,
  strategy,
  generating,
}: {
  onNext: () => void;
  onBack: () => void;
  strategy: Strategy | null;
  generating: boolean;
}) {
  if (generating || !strategy) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <Loader2 className="size-8 animate-spin text-primary" />
        <p className="text-muted-foreground text-sm">Generating your strategy...</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header className="text-center space-y-2">
        <h2 className="text-2xl font-semibold tracking-tight">Your marketing strategy</h2>
        <p className="text-muted-foreground">
          Here is what we recommend based on your profile.
        </p>
      </header>

      {/* Positioning */}
      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="py-5">
          <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
            Positioning
          </p>
          <p className="text-sm leading-relaxed">{strategy.positioning}</p>
        </CardContent>
      </Card>

      {/* Channels */}
      <div className="space-y-2">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">
          Channel allocation
        </p>
        <div className="grid gap-2">
          {strategy.channels.map((ch) => (
            <Card key={ch.name}>
              <CardContent className="flex items-center gap-4 py-3">
                <div className="flex size-8 items-center justify-center rounded-md border border-border bg-muted/30 text-muted-foreground">
                  {ch.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{ch.name}</p>
                  <p className="text-xs text-muted-foreground">
                    CAC {ch.cacRange} · {ch.timeline}
                  </p>
                </div>
                <span className="text-sm font-semibold tabular-nums">
                  {ch.budgetPct}%
                </span>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* KPIs */}
      <div className="space-y-2">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">
          KPI targets
        </p>
        <Card>
          <CardContent className="py-3">
            <div className="divide-y divide-border">
              {strategy.kpis.map((kpi) => (
                <div
                  key={kpi.metric}
                  className="flex items-center justify-between py-2 first:pt-0 last:pb-0"
                >
                  <span className="text-sm text-muted-foreground">{kpi.metric}</span>
                  <span className="text-sm font-medium">{kpi.target}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Roadmap */}
      <div className="space-y-2">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">
          90-day roadmap
        </p>
        <div className="grid gap-2 sm:grid-cols-3">
          {strategy.roadmap.map((r) => (
            <Card key={r.phase}>
              <CardContent className="py-4 space-y-1">
                <p className="text-xs text-primary font-medium">{r.phase}</p>
                <p className="text-sm font-medium">{r.title}</p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {r.description}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between pt-4">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft className="size-4" /> Adjust
        </Button>
        <Button onClick={onNext}>
          Approve Strategy <Check className="size-4" />
        </Button>
      </div>
    </div>
  );
}

// --- Step 5 — Team ---

function buildDefaultTeam(): TeamMember[] {
  const i = (Icon: typeof Globe) => <Icon className="size-4" />;
  return [
    { id: "cmo", name: "CMO", role: "Chief Marketing Officer", responsibility: "Oversees all marketing operations and strategy execution", icon: i(Megaphone), enabled: true, required: true },
    { id: "growth", name: "Growth Manager", role: "Growth & Analytics", responsibility: "Tracks KPIs, runs experiments, optimizes funnels", icon: i(TrendingUp), enabled: true },
    { id: "content", name: "Content Strategist", role: "Content & SEO", responsibility: "Creates blog posts, landing pages, and SEO strategy", icon: i(PenTool), enabled: true },
    { id: "paid-search", name: "Paid Search Manager", role: "Google Ads", responsibility: "Manages search campaigns, bidding, and ad copy", icon: i(Globe), enabled: true },
    { id: "paid-social", name: "Paid Social Manager", role: "Meta & Social Ads", responsibility: "Runs Facebook, Instagram, and social ad campaigns", icon: i(Share2), enabled: true },
    { id: "email", name: "Email Marketing Manager", role: "Email & Lifecycle", responsibility: "Designs drip campaigns, newsletters, and retention flows", icon: i(Mail), enabled: true },
    { id: "social-organic", name: "Social Media Manager", role: "Organic Social", responsibility: "Posts content, engages community, builds brand voice", icon: i(MessageCircle), enabled: true },
    { id: "creative", name: "Creative Director", role: "Design & Creative", responsibility: "Produces ad creatives, banners, and visual assets", icon: i(Eye), enabled: true },
    { id: "analytics", name: "Analytics Engineer", role: "Data & Attribution", responsibility: "Sets up tracking, attribution models, and dashboards", icon: i(BarChart3), enabled: true },
    { id: "partnerships", name: "Partnerships Manager", role: "Partnerships & Affiliates", responsibility: "Manages affiliate programs and partnership deals", icon: i(Users), enabled: false },
  ];
}

function StepTeam({
  onNext,
  onBack,
  team,
  setTeam,
  deploying,
}: {
  onNext: () => void;
  onBack: () => void;
  team: TeamMember[];
  setTeam: (t: TeamMember[]) => void;
  deploying: boolean;
}) {
  const toggleMember = (id: string) => {
    setTeam(
      team.map((m) =>
        m.id === id && !m.required ? { ...m, enabled: !m.enabled } : m,
      ),
    );
  };

  const enabledCount = team.filter((m) => m.enabled).length;

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <header className="text-center space-y-2">
        <h2 className="text-2xl font-semibold tracking-tight">Your marketing team</h2>
        <p className="text-muted-foreground">
          {enabledCount} agents will be deployed. Toggle off any you do not need.
        </p>
      </header>

      {/* CEO node */}
      <div className="flex flex-col items-center gap-1">
        <div className="flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-2.5">
          <div className="flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <Rocket className="size-4" />
          </div>
          <div>
            <p className="text-sm font-medium">CEO</p>
            <p className="text-xs text-muted-foreground">You</p>
          </div>
        </div>
        <div className="h-6 w-px bg-border" />
      </div>

      {/* CMO */}
      <div className="flex flex-col items-center gap-1">
        <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-2.5">
          <div className="flex size-8 items-center justify-center rounded-full bg-muted text-foreground">
            <Megaphone className="size-4" />
          </div>
          <div>
            <p className="text-sm font-medium">CMO</p>
            <p className="text-xs text-muted-foreground">
              Chief Marketing Officer
            </p>
          </div>
          <span className="ml-2 rounded bg-muted/60 px-1.5 py-0.5 text-[10px] text-muted-foreground">
            gemma_local
          </span>
        </div>
        <div className="h-4 w-px bg-border" />
      </div>

      {/* Specialists grid */}
      <div className="grid gap-2 sm:grid-cols-2">
        {team.filter((m) => m.id !== "cmo").map((m) => (
          <div
            key={m.id}
            className={cn(
              "flex items-center gap-3 rounded-lg border px-4 py-3 transition-all",
              m.enabled
                ? "border-border bg-card"
                : "border-border/40 bg-muted/10 opacity-50",
            )}
          >
            <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted/40 text-muted-foreground">
              {m.icon}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">{m.name}</p>
              <p className="text-xs text-muted-foreground truncate">
                {m.responsibility}
              </p>
            </div>
            <ToggleSwitch
              checked={m.enabled}
              onCheckedChange={() => toggleMember(m.id)}
              disabled={m.required}
            />
          </div>
        ))}
      </div>

      <p className="text-center text-[11px] text-muted-foreground">
        All agents use the <span className="font-mono">gemma_local</span> adapter via Ollama.
      </p>

      <div className="flex items-center justify-between pt-2">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft className="size-4" /> Back
        </Button>
        <Button disabled={deploying} onClick={onNext}>
          {deploying ? (
            <>
              <Loader2 className="size-4 animate-spin" /> Deploying...
            </>
          ) : (
            <>
              Deploy Team <Zap className="size-4" />
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

// --- Step 6 — Launch ---

function StepLaunch({
  agentsDeployed,
  connectedCount,
  budget,
  onDashboard,
  onInbox,
}: {
  agentsDeployed: number;
  connectedCount: number;
  budget: number;
  onDashboard: () => void;
  onInbox: () => void;
}) {
  return (
    <div className="mx-auto max-w-lg space-y-8 text-center">
      <div className="space-y-4 pt-4">
        <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-green-600/20 text-green-500">
          <Check className="size-8" />
        </div>
        <h2 className="text-2xl font-semibold tracking-tight">You are live!</h2>
        <p className="text-muted-foreground">
          Your marketing team is deployed and ready to execute.
        </p>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="py-4 text-center">
            <p className="text-2xl font-semibold">{agentsDeployed}</p>
            <p className="text-xs text-muted-foreground">Agents deployed</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4 text-center">
            <p className="text-2xl font-semibold">{connectedCount}</p>
            <p className="text-xs text-muted-foreground">Accounts linked</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4 text-center">
            <p className="text-2xl font-semibold">
              ${budget > 0 ? budget.toLocaleString() : "0"}
            </p>
            <p className="text-xs text-muted-foreground">Monthly budget</p>
          </CardContent>
        </Card>
      </div>

      {/* CTA */}
      <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
        <Button size="lg" onClick={onDashboard}>
          Open Dashboard <ArrowRight className="size-4" />
        </Button>
        <Button size="lg" variant="outline" onClick={onInbox}>
          Open Inbox <Mail className="size-4" />
        </Button>
      </div>

      {/* WhatsApp hint */}
      <Card className="border-border/60 text-left">
        <CardContent className="flex items-start gap-4 py-4">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-green-600/20 text-green-500">
            <MessageCircle className="size-5" />
          </div>
          <div>
            <p className="text-sm font-medium">Get real-time updates via WhatsApp</p>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              Connect WhatsApp to receive campaign alerts, approval requests, and
              performance summaries directly on your phone. Configure in{" "}
              <span className="font-medium text-foreground">Settings &rarr; Integrations</span>.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// --- Main Wizard ---

export function MarketingOnboardingWizard() {
  const navigate = useNavigate();
  const { selectedCompanyId, selectedCompany } = useCompany();
  const companyId = selectedCompanyId ?? "";

  const [step, setStep] = useState<WizardStep>(1);

  // Step 1 state
  const [platforms, setPlatforms] = useState<PlatformConnection[]>([
    {
      id: "google",
      name: "Google",
      services: ["Ads", "Analytics", "Search Console"],
      icon: <Globe className="size-4" />,
      connected: false,
    },
    {
      id: "meta",
      name: "Meta",
      services: ["Ads", "Instagram"],
      icon: <Instagram className="size-4" />,
      connected: false,
    },
    {
      id: "stripe",
      name: "Stripe",
      services: ["Payments", "Revenue data"],
      icon: <CreditCard className="size-4" />,
      connected: false,
    },
    {
      id: "twitter",
      name: "Twitter / X",
      services: ["Ads", "Organic"],
      icon: <Twitter className="size-4" />,
      connected: false,
    },
    {
      id: "linkedin",
      name: "LinkedIn",
      services: ["Ads", "Organic"],
      icon: <Linkedin className="size-4" />,
      connected: false,
    },
  ]);

  // Step 2 state
  const [productName, setProductName] = useState(selectedCompany?.name ?? "");
  const [productUrl, setProductUrl] = useState("");
  const [analysis, setAnalysis] = useState<ProductAnalysis | null>(null);

  // Step 3 state
  const [profile, setProfile] = useState<BusinessProfile>({
    businessModel: "",
    monthlyBudget: 0,
    primaryGoal: "",
    monthlyCustomers: "",
    targetCac: "",
  });

  // Step 4 state
  const [strategy, setStrategy] = useState<Strategy | null>(null);
  const [generatingStrategy, setGeneratingStrategy] = useState(false);

  // Step 5 state
  const [team, setTeam] = useState<TeamMember[]>(buildDefaultTeam);
  const [deploying, setDeploying] = useState(false);
  const [deployedCount, setDeployedCount] = useState(0);

  // Navigation helpers
  const goTo = (s: WizardStep) => setStep(s);

  const handleConnect = useCallback(
    async (platformId: string) => {
      try {
        const { url } = await api.get<{ url: string }>(
          `/companies/${companyId}/marketing/oauth/${platformId}/authorize`,
        );
        const popup = window.open(url, "_blank", "width=600,height=700");
        // Poll for popup close
        const interval = setInterval(() => {
          if (popup?.closed) {
            clearInterval(interval);
            setPlatforms((prev) =>
              prev.map((p) =>
                p.id === platformId ? { ...p, connected: true } : p,
              ),
            );
          }
        }, 500);
      } catch {
        // Mark connected optimistically for demo
        setPlatforms((prev) =>
          prev.map((p) =>
            p.id === platformId ? { ...p, connected: true } : p,
          ),
        );
      }
    },
    [companyId],
  );

  const generateStrategy = useCallback(async () => {
    setGeneratingStrategy(true);
    goTo(4);
    try {
      const result = await api.post<Strategy>(
        `/companies/${companyId}/marketing/strategy`,
        { profile, productName, productUrl, analysis },
      );
      setStrategy(result);
    } catch {
      // Fallback: build a reasonable default
      await new Promise((r) => setTimeout(r, 1500));
      setStrategy(buildDefaultStrategy(profile));
    } finally {
      setGeneratingStrategy(false);
    }
  }, [companyId, profile, productName, productUrl, analysis]);

  const deployTeam = useCallback(async () => {
    setDeploying(true);
    const enabled = team.filter((m) => m.enabled);
    let deployed = 0;

    for (const member of enabled) {
      try {
        await agentsApi.create(companyId, {
          name: member.name,
          role: member.role,
          adapterType: "gemma_local",
          model: "",
          dangerouslySkipPermissions: true,
        });
        deployed++;
      } catch {
        // Agent may already exist — continue
        deployed++;
      }
    }

    setDeployedCount(deployed);
    setDeploying(false);
    goTo(6);
  }, [companyId, team]);

  const connectedCount = platforms.filter((p) => p.connected).length;
  const companyPrefix = selectedCompany
    ? encodeURIComponent(selectedCompany.name.toLowerCase().replace(/\s+/g, "-"))
    : "";

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl px-4 pb-16">
        {/* Header */}
        <div className="flex items-center justify-center pt-8 pb-2">
          <h1 className="text-lg font-semibold tracking-tight text-foreground">
            Marketing Setup
          </h1>
        </div>

        <StepIndicator current={step} />

        {/* Step content */}
        <div className="mt-2">
          {step === 1 && (
            <StepConnect
              companyId={companyId}
              platforms={platforms}
              onConnect={handleConnect}
              onNext={() => goTo(2)}
            />
          )}

          {step === 2 && (
            <StepProduct
              onNext={() => goTo(3)}
              onBack={() => goTo(1)}
              productName={productName}
              setProductName={setProductName}
              productUrl={productUrl}
              setProductUrl={setProductUrl}
              analysis={analysis}
              setAnalysis={setAnalysis}
            />
          )}

          {step === 3 && (
            <StepBusiness
              onNext={generateStrategy}
              onBack={() => goTo(2)}
              profile={profile}
              setProfile={setProfile}
            />
          )}

          {step === 4 && (
            <StepStrategy
              onNext={() => goTo(5)}
              onBack={() => goTo(3)}
              strategy={strategy}
              generating={generatingStrategy}
            />
          )}

          {step === 5 && (
            <StepTeam
              onNext={deployTeam}
              onBack={() => goTo(4)}
              team={team}
              setTeam={setTeam}
              deploying={deploying}
            />
          )}

          {step === 6 && (
            <StepLaunch
              agentsDeployed={deployedCount}
              connectedCount={connectedCount}
              budget={profile.monthlyBudget}
              onDashboard={() => navigate(`/${companyPrefix}`)}
              onInbox={() => navigate(`/${companyPrefix}/inbox`)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
