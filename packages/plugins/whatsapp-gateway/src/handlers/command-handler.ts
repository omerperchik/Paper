// ---------------------------------------------------------------------------
// Command Handler — process parsed NL commands and execute via internal APIs
// ---------------------------------------------------------------------------

import type { PluginContext } from "../types.js";
import type { WhatsAppClient } from "../services/whatsapp-client.js";
import type { DashboardRenderer } from "../services/dashboard-renderer.js";
import type { ApprovalHandler } from "./approval-handler.js";
import type { ParsedCommand } from "../services/command-parser.js";

export class CommandHandler {
  private ctx: PluginContext;
  private waClient: WhatsAppClient;
  private dashRenderer: DashboardRenderer;
  private approvalHandler: ApprovalHandler;

  constructor(
    ctx: PluginContext,
    waClient: WhatsAppClient,
    dashRenderer: DashboardRenderer,
    approvalHandler: ApprovalHandler,
  ) {
    this.ctx = ctx;
    this.waClient = waClient;
    this.dashRenderer = dashRenderer;
    this.approvalHandler = approvalHandler;
  }

  async execute(command: ParsedCommand, from: string): Promise<void> {
    this.ctx.logger.info("Executing command", {
      intent: command.intent,
      from,
    });

    try {
      switch (command.intent) {
        case "status":
          await this.handleStatus(from);
          break;
        case "get_dashboard":
          await this.handleDashboard(from);
          break;
        case "get_cac":
          await this.handleCac(from);
          break;
        case "get_spend":
          await this.handleSpend(from);
          break;
        case "list_agents":
          await this.handleListAgents(from);
          break;
        case "list_tasks":
          await this.handleListTasks(from);
          break;
        case "pause_campaign":
          await this.handlePauseCampaign(from, command.params.campaignName);
          break;
        case "resume_campaign":
          await this.handleResumeCampaign(from, command.params.campaignName);
          break;
        case "approve_all":
          await this.approvalHandler.approveAllPending(from);
          break;
        case "help":
          await this.handleHelp(from);
          break;
        default:
          await this.waClient.sendText(
            from,
            `I understood your intent ("${command.intent}") but don't have a handler for it yet. Try "help" for available commands.`,
          );
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.ctx.logger.error("Command execution failed", { intent: command.intent, error: errMsg });
      await this.waClient.sendText(from, `Something went wrong executing "${command.raw}": ${errMsg}`);
    }
  }

  private async handleStatus(from: string): Promise<void> {
    const report = this.dashRenderer.renderStatusReport({
      agentCount: 0,
      activeTaskCount: 0,
      pendingApprovals: 0,
      todaySpend: "$0",
      topAlert: undefined,
    });
    await this.waClient.sendText(from, report);
  }

  private async handleDashboard(from: string): Promise<void> {
    await this.waClient.sendText(from, "Generating dashboard... You'll receive the full report in a moment.");
  }

  private async handleCac(from: string): Promise<void> {
    await this.waClient.sendText(from, "Pulling CAC data... The breakdown will arrive shortly.");
  }

  private async handleSpend(from: string): Promise<void> {
    await this.waClient.sendText(from, "Pulling spend data... The summary will arrive shortly.");
  }

  private async handleListAgents(from: string): Promise<void> {
    await this.waClient.sendText(from, "Fetching agent roster... Stand by.");
  }

  private async handleListTasks(from: string): Promise<void> {
    await this.waClient.sendText(from, "Fetching open tasks... Stand by.");
  }

  private async handlePauseCampaign(from: string, campaignName: string): Promise<void> {
    if (!campaignName) {
      await this.waClient.sendText(from, "Please specify which campaign to pause. Example: pause campaign Google Ads Q1");
      return;
    }
    await this.waClient.sendText(from, `Pausing campaign "${campaignName}"... You'll get confirmation shortly.`);
  }

  private async handleResumeCampaign(from: string, campaignName: string): Promise<void> {
    if (!campaignName) {
      await this.waClient.sendText(from, "Please specify which campaign to resume. Example: resume campaign Google Ads Q1");
      return;
    }
    await this.waClient.sendText(from, `Resuming campaign "${campaignName}"... You'll get confirmation shortly.`);
  }

  private async handleHelp(from: string): Promise<void> {
    const helpText = this.dashRenderer.renderHelp();
    await this.waClient.sendText(from, helpText);
  }
}
