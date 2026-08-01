/**
 * Template system for `iln generate`.
 *
 * Built-in templates: invoice-client, webhook-handler, subscription-config
 *
 * Custom templates: drop a <name>.tpl file in ~/.iln/templates/ or
 * ./.iln/templates/ and use {{VARIABLE}} placeholders for interpolation.
 *
 * Public API
 * ──────────
 *   listTemplates() → TemplateDefinition[]
 *   generate(options) → GenerateResult
 *   interpolate(template, vars) → string
 */

import fs from "fs";
import os from "os";
import path from "path";

// ── Types ──────────────────────────────────────────────────────────────────

export interface TemplateVariable {
  name: string;
  description: string;
  default?: string;
}

export interface TemplateDefinition {
  name: string;
  description: string;
  outputFile: string;
  variables: TemplateVariable[];
  render(vars: Record<string, string>): string;
}

export interface GenerateOptions {
  template: string;
  vars?: Record<string, string>;
  outDir?: string;
  preview?: boolean;
}

export interface GenerateResult {
  templateName: string;
  outputFile: string;
  content: string;
  written: boolean;
}

// ── Interpolation ──────────────────────────────────────────────────────────

/** Replace `{{VARIABLE}}` placeholders with values from vars. */
export function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? `{{${key}}}`);
}

// ── Built-in templates ─────────────────────────────────────────────────────

const BUILTIN: TemplateDefinition[] = [
  {
    name: "invoice-client",
    description: "Bootstrapped ILN client for a new integration",
    outputFile: "iln-client.ts",
    variables: [
      { name: "contractId", description: "Stellar contract ID", default: "CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX" },
      { name: "rpcUrl", description: "Stellar RPC URL", default: "https://soroban-testnet.stellar.org" },
      { name: "networkPassphrase", description: "Network passphrase", default: "Test SDF Network ; September 2015" },
    ],
    render: (vars) =>
      `import { ILNClient, createKeypairFileSigner } from "@iln/sdk";

const client = new ILNClient({
  contractId: "${vars.contractId}",
  rpcUrl: "${vars.rpcUrl}",
  networkPassphrase: "${vars.networkPassphrase}",
  signer: createKeypairFileSigner(process.env.ILN_KEYPAIR_PATH!),
});

export default client;
`,
  },
  {
    name: "webhook-handler",
    description: "Express webhook endpoint with HMAC signature verification",
    outputFile: "webhook-handler.ts",
    variables: [
      { name: "secret", description: "Webhook signing secret (from subscription)", default: "your-webhook-secret" },
      { name: "port", description: "HTTP listener port", default: "3001" },
    ],
    render: (vars) =>
      `import express from "express";
import crypto from "crypto";

const SECRET = process.env.ILN_WEBHOOK_SECRET ?? "${vars.secret}";
const PORT = parseInt(process.env.PORT ?? "${vars.port}", 10);

const app = express();
app.use(express.json());

function verifySignature(payload: string, signature: string): boolean {
  const expected = crypto.createHmac("sha256", SECRET).update(payload).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

app.post("/webhook", (req, res) => {
  const sig = req.headers["x-iln-signature"] as string | undefined;
  if (!sig || !verifySignature(JSON.stringify(req.body), sig)) {
    return res.status(401).json({ error: "Invalid signature" });
  }

  const event = req.body as { type: string; invoiceId: string; amount: string };
  console.log(\`Event: \${event.type} — invoice #\${event.invoiceId}, amount: \${event.amount}\`);

  switch (event.type) {
    case "funded":   /* TODO: handle funded */   break;
    case "paid":     /* TODO: handle paid */     break;
    case "defaulted":/* TODO: handle defaulted */break;
  }

  res.status(200).json({ received: true });
});

app.listen(PORT, () => console.log(\`ILN webhook listener on :\${PORT}\`));
`,
  },
  {
    name: "subscription-config",
    description: "Notification subscription payload for POST /subscribe",
    outputFile: "subscription.json",
    variables: [
      { name: "stellarAddress", description: "Your Stellar public key (G…)", default: "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX" },
      { name: "email", description: "Notification email", default: "you@example.com" },
    ],
    render: (vars) =>
      JSON.stringify(
        {
          stellar_address: vars.stellarAddress,
          channel: "email",
          destination: vars.email,
          triggers: ["invoice_funded", "invoice_paid", "invoice_defaulted", "invoice_due_soon"],
        },
        null,
        2
      ) + "\n",
  },
];

// ── Custom template loading ────────────────────────────────────────────────

function loadCustomTemplates(): TemplateDefinition[] {
  const searchDirs = [
    path.join(os.homedir(), ".iln", "templates"),
    path.join(process.cwd(), ".iln", "templates"),
  ];
  const result: TemplateDefinition[] = [];

  for (const dir of searchDirs) {
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".tpl"))) {
      const name = file.replace(/\.tpl$/, "");
      const raw = fs.readFileSync(path.join(dir, file), "utf8");
      // Extract declared variables from {{NAME}} placeholders
      const varNames = [...new Set([...raw.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]))];
      result.push({
        name,
        description: `Custom template from ${dir}`,
        outputFile: name,
        variables: varNames.map((n) => ({ name: n, description: n })),
        render: (vars) => interpolate(raw, vars),
      });
    }
  }
  return result;
}

function allTemplates(): TemplateDefinition[] {
  return [...BUILTIN, ...loadCustomTemplates()];
}

// ── Public API ─────────────────────────────────────────────────────────────

/** Return all available templates (built-in + custom). */
export function listTemplates(): TemplateDefinition[] {
  return allTemplates();
}

/**
 * Generate a file from a template.
 * With `preview: true` the content is returned but nothing is written to disk.
 */
export function generate(options: GenerateOptions): GenerateResult {
  const templates = allTemplates();
  const def = templates.find((t) => t.name === options.template);
  if (!def) {
    throw new Error(
      `Unknown template "${options.template}". Run \`iln generate --list\` to see available templates.`
    );
  }

  // Merge caller-supplied vars with per-variable defaults
  const vars: Record<string, string> = {};
  for (const v of def.variables) {
    vars[v.name] = options.vars?.[v.name] ?? v.default ?? "";
  }
  // Allow extra vars the caller passes even if not declared in the template
  Object.assign(vars, options.vars);

  const content = def.render(vars);
  const outputFile = path.join(options.outDir ?? ".", def.outputFile);
  const written = !options.preview;

  if (written) {
    fs.mkdirSync(path.dirname(path.resolve(outputFile)), { recursive: true });
    fs.writeFileSync(outputFile, content);
  }

  return { templateName: def.name, outputFile, content, written };
}
