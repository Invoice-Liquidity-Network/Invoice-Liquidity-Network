#!/usr/bin/env ts-node
/**
 * Governance Proposal Monitor
 *
 * Polls the ILN Governance contract for new Active proposals every 5 minutes
 * and sends Discord webhook notifications with proposal details.
 *
 * Environment Variables:
 *   DISCORD_WEBHOOK_URL - Discord webhook URL for notifications (required)
 *   GOVERNANCE_CONTRACT_ID - Governance contract ID (defaults to testnet)
 *   RPC_URL - Stellar RPC server URL (defaults to testnet)
 *   NETWORK_PASSPHRASE - Stellar network passphrase (defaults to testnet)
 *   FRONTEND_BASE_URL - Frontend URL for proposal link (defaults to testnet frontend)
 *   POLL_INTERVAL_MS - Poll interval in milliseconds (default: 300000 = 5 minutes)
 *
 * Usage:
 *   DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/... ts-node index.ts
 *   DISCORD_WEBHOOK_URL=... ts-node index.ts --verbose
 */

import fs from "fs";
import path from "path";
import axios from "axios";
import { Command } from "commander";
import { rpc } from "@stellar/stellar-sdk";
import {
  GovernanceClient,
  GOVERNANCE_TESTNET,
  ProposalStatus,
  ProposalActionKind,
  parseGovernanceProposalListSimulation,
  type GovernanceProposal,
  type ListProposalsParams,
} from "@invoice-liquidity/sdk";

// ─── Types ────────────────────────────────────────────────────────────────────

interface MonitorState {
  lastPollTime: number;
  seenProposalIds: Set<string>;
}

interface GovernanceConfig {
  discordWebhookUrl: string;
  contractId: string;
  rpcUrl: string;
  networkPassphrase: string;
  frontendBaseUrl: string;
  pollIntervalMs: number;
  verbose: boolean;
}

// ─── Config ───────────────────────────────────────────────────────────────────

const DEFAULT_FRONTEND_URL = "https://iln-testnet.vercel.app";
const DEFAULT_POLL_INTERVAL = 5 * 60 * 1000; // 5 minutes
const STATE_FILE = path.join(__dirname, ".governance-state.json");

// ─── Utilities ────────────────────────────────────────────────────────────────

function log(message: string, verbose = false) {
  const timestamp = new Date().toISOString();
  if (verbose) {
    console.log(`[${timestamp}] ${message}`);
  } else {
    console.log(`[${timestamp}] ${message}`);
  }
}

function logVerbose(message: string, config: GovernanceConfig) {
  if (config.verbose) {
    log(message);
  }
}

function loadState(): MonitorState {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const data = fs.readFileSync(STATE_FILE, "utf-8");
      const parsed = JSON.parse(data);
      return {
        lastPollTime: parsed.lastPollTime || 0,
        seenProposalIds: new Set(parsed.seenProposalIds || []),
      };
    }
  } catch (err) {
    logVerbose(`Error loading state file: ${err}`, {
      verbose: true,
    } as GovernanceConfig);
  }

  return {
    lastPollTime: 0,
    seenProposalIds: new Set(),
  };
}

function saveState(state: MonitorState) {
  try {
    fs.writeFileSync(
      STATE_FILE,
      JSON.stringify(
        {
          lastPollTime: state.lastPollTime,
          seenProposalIds: Array.from(state.seenProposalIds),
        },
        null,
        2,
      ),
      "utf-8",
    );
  } catch (err) {
    console.error(`Error saving state file: ${err}`);
  }
}

// ─── Proposal Parsing ──────────────────────────────────────────────────────────

function getActionTypeLabel(proposal: GovernanceProposal): string {
  const action = proposal.action;
  switch (action.kind) {
    case ProposalActionKind.UpdateFeeRate:
      return "Update Fee Rate";
    case ProposalActionKind.AddToken:
      return "Add Token";
    case ProposalActionKind.RemoveToken:
      return "Remove Token";
    case ProposalActionKind.UpdateMaxDiscountRate:
      return "Update Max Discount Rate";
    default:
      return "Unknown Action";
  }
}

function getActionDescription(proposal: GovernanceProposal): string {
  const action = proposal.action;
  switch (action.kind) {
    case ProposalActionKind.UpdateFeeRate:
      return `New fee rate: ${Number(proposal.proposedValue) / 10000}% (in basis points: ${proposal.proposedValue})`;
    case ProposalActionKind.AddToken:
      return `Token address: ${action.tokenAddress}`;
    case ProposalActionKind.RemoveToken:
      return `Token address: ${action.tokenAddress}`;
    case ProposalActionKind.UpdateMaxDiscountRate:
      return `New max discount rate: ${Number(proposal.proposedValue) / 10000}% (in basis points: ${proposal.proposedValue})`;
    default:
      return "No details available";
  }
}

// ─── Discord Notifications ────────────────────────────────────────────────────

async function sendDiscordNotification(
  proposal: GovernanceProposal,
  config: GovernanceConfig,
): Promise<void> {
  const actionType = getActionTypeLabel(proposal);
  const actionDesc = getActionDescription(proposal);
  const votingDeadlineDate = new Date(proposal.votingEnd * 1000);
  const proposalUrl = `${config.frontendBaseUrl}/governance/proposal/${proposal.id}`;

  const embed = {
    title: `🔔 New Governance Proposal: ${actionType}`,
    description: `A new proposal has been submitted to the ILN DAO governance.`,
    color: 4328442, // Blue-ish
    fields: [
      {
        name: "Proposal ID",
        value: `#${proposal.id}`,
        inline: true,
      },
      {
        name: "Action Type",
        value: actionType,
        inline: true,
      },
      {
        name: "Proposed Value",
        value: proposal.proposedValue.toString(),
        inline: false,
      },
      {
        name: "Details",
        value: actionDesc,
        inline: false,
      },
      {
        name: "Voting Deadline",
        value: votingDeadlineDate.toUTCString(),
        inline: true,
      },
      {
        name: "Status",
        value: proposal.status,
        inline: true,
      },
    ],
    footer: {
      text: "Invoice Liquidity Network",
      icon_url:
        "https://raw.githubusercontent.com/Invoice-Liquidity-Network/Invoice-Liquidity-Network/main/docs/assets/logo.png",
    },
    timestamp: new Date().toISOString(),
  };

  const payload = {
    embeds: [embed],
    components: [
      {
        type: 1,
        components: [
          {
            type: 2,
            label: "View Proposal",
            style: 5,
            url: proposalUrl,
          },
        ],
      },
    ],
  };

  try {
    await axios.post(config.discordWebhookUrl, payload);
    log(`✓ Sent Discord notification for proposal #${proposal.id}`);
  } catch (err) {
    console.error(
      `✗ Failed to send Discord notification for proposal #${proposal.id}:`,
      err instanceof Error ? err.message : err,
    );
  }
}

// ─── Proposal Polling ──────────────────────────────────────────────────────────

async function fetchProposals(
  client: GovernanceClient,
  config: GovernanceConfig,
): Promise<GovernanceProposal[]> {
  try {
    logVerbose(`Fetching Active proposals from contract...`, config);

    const params: ListProposalsParams = {
      status: ProposalStatus.Active,
      page: 0,
      pageSize: 100, // Adjust if needed for large proposal lists
    };

    const tx = client.listProposals(params);
    const server = new rpc.Server(config.rpcUrl, { allowHttp: true });

    const result = await server.simulateTransaction(tx);

    if (result.error) {
      throw new Error(`Contract simulation error: ${result.error.detail}`);
    }

    if (!result.results || result.results.length === 0) {
      logVerbose(`No simulation results returned`, config);
      return [];
    }

    const proposals = parseGovernanceProposalListSimulation(result);
    logVerbose(`Fetched ${proposals.length} Active proposal(s)`, config);
    return proposals;
  } catch (err) {
    console.error(
      `✗ Error fetching proposals:`,
      err instanceof Error ? err.message : err,
    );
    return [];
  }
}

async function pollProposals(
  state: MonitorState,
  config: GovernanceConfig,
): Promise<void> {
  const client = new GovernanceClient({
    contractId: config.contractId,
    rpcUrl: config.rpcUrl,
    networkPassphrase: config.networkPassphrase,
  });

  const proposals = await fetchProposals(client, config);

  for (const proposal of proposals) {
    const proposalIdStr = proposal.id.toString();

    if (!state.seenProposalIds.has(proposalIdStr)) {
      logVerbose(
        `New proposal detected: #${proposal.id} (${getActionTypeLabel(proposal)})`,
        config,
      );
      state.seenProposalIds.add(proposalIdStr);
      await sendDiscordNotification(proposal, config);
    } else {
      logVerbose(`Proposal #${proposal.id} already seen, skipping`, config);
    }
  }

  state.lastPollTime = Date.now();
  saveState(state);
}

// ─── Main Loop ────────────────────────────────────────────────────────────────

async function startMonitoring(config: GovernanceConfig): Promise<void> {
  const state = loadState();

  log(`🚀 Governance Monitor started`);
  log(
    `📋 Configuration: contract=${config.contractId.slice(0, 10)}..., interval=${config.pollIntervalMs}ms`,
  );
  log(`💬 Discord webhook configured: ${config.discordWebhookUrl.slice(0, 50)}...`);

  // Perform initial poll
  await pollProposals(state, config);

  // Set up recurring poll
  setInterval(async () => {
    logVerbose(`\n⏰ Polling for new proposals...`, config);
    await pollProposals(state, config);
  }, config.pollIntervalMs);

  log(`✓ Monitor running. Will check for new proposals every ${config.pollIntervalMs / 1000}s`);
}

// ─── CLI ───────────────────────────────────────────────────────────────────────

function main() {
  const program = new Command();

  program
    .name("governance-monitor")
    .description(
      "Monitor ILN Governance proposals and send Discord notifications",
    )
    .option("--verbose", "Enable verbose logging", false)
    .option("--contract <id>", "Override governance contract ID")
    .option("--rpc <url>", "Override RPC URL")
    .option("--frontend <url>", "Override frontend base URL", DEFAULT_FRONTEND_URL)
    .option(
      "--interval <ms>",
      "Poll interval in milliseconds",
      DEFAULT_POLL_INTERVAL.toString(),
    )
    .parse(process.argv);

  const opts = program.opts();

  const discordWebhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!discordWebhookUrl) {
    console.error("❌ Error: DISCORD_WEBHOOK_URL environment variable is required");
    process.exit(1);
  }

  const config: GovernanceConfig = {
    discordWebhookUrl,
    contractId:
      opts.contract || process.env.GOVERNANCE_CONTRACT_ID || GOVERNANCE_TESTNET.contractId,
    rpcUrl: opts.rpc || process.env.RPC_URL || GOVERNANCE_TESTNET.rpcUrl,
    networkPassphrase:
      process.env.NETWORK_PASSPHRASE || GOVERNANCE_TESTNET.networkPassphrase,
    frontendBaseUrl: opts.frontend,
    pollIntervalMs: parseInt(opts.interval, 10),
    verbose: opts.verbose,
  };

  startMonitoring(config).catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}

main();
