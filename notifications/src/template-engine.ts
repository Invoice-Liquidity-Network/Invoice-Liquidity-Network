export interface TemplateVariable {
  name: string;
  value: string | number | boolean;
}

export interface TemplateContext {
  invoice?: {
    id: number;
    freelancer: string;
    payer: string;
    amount: string;
    due_date: number;
    discount_rate: number;
    status: string;
    funder?: string;
    funded_at?: number;
  };
  recipient?: {
    address: string;
    email?: string;
  };
  trigger?: string;
  timestamp?: number;
  [key: string]: unknown;
}

export interface Template {
  id: string;
  name: string;
  version: string;
  subject: string;
  body: string;
  triggers: string[];
  createdAt: number;
  updatedAt: number;
}

export interface RenderResult {
  subject: string;
  body: string;
  success: boolean;
  errors?: string[];
}

export interface TemplateTestResult {
  success: boolean;
  rendered?: RenderResult;
  errors?: string[];
}

export class TemplateEngine {
  private templates: Map<string, Template>;
  private variableRegex = /\{\{(\w+)\}\}/g;
  private conditionalRegex = /\{%\s*if\s+(\w+)\s*%\}(.*?)\{%\s*endif\s*%\}/gs;

  constructor() {
    this.templates = new Map();
    this.initializeDefaultTemplates();
  }

  /**
   * Initialize default notification templates
   */
  private initializeDefaultTemplates(): void {
    const now = Date.now();

    // Invoice submitted template
    this.templates.set("invoice_submitted", {
      id: "invoice_submitted",
      name: "Invoice Submitted Notification",
      version: "1.0.0",
      subject: "Invoice #{{invoiceId}} has been submitted",
      body: `Invoice #{{invoiceId}} for {{amount}} has been submitted by {{freelancer}} to {{payer}}.
      
Amount: {{amount}}
Discount Rate: {{discountRate}}%
Due Date: {{dueDate}}

View details on the ILN dashboard.`,
      triggers: ["invoice_submitted"],
      createdAt: now,
      updatedAt: now,
    });

    // Invoice disputed template
    this.templates.set("invoice_disputed", {
      id: "invoice_disputed",
      name: "Invoice Disputed Notification",
      version: "1.0.0",
      subject: "Invoice #{{invoiceId}} has been disputed",
      body: `Invoice #{{invoiceId}} from {{freelancer}} has been disputed by the payer.

Amount: {{amount}}
Due Date: {{dueDate}}

Please visit the ILN dashboard to review the dispute details.`,
      triggers: ["invoice_disputed"],
      createdAt: now,
      updatedAt: now,
    });

    // Invoice funded template
    this.templates.set("invoice_funded", {
      id: "invoice_funded",
      name: "Invoice Funded Notification",
      version: "1.0.0",
      subject: "Your invoice #{{invoiceId}} has been funded",
      body: `Good news! Your invoice #{{invoiceId}} for {{amount}} from {{payer}} has been funded by {{funder}}.
      
Amount: {{amount}}
Discount Rate: {{discountRate}}%
Due Date: {{dueDate}}

View details on the ILN dashboard.`,
      triggers: ["invoice_funded"],
      createdAt: now,
      updatedAt: now,
    });

    // Invoice paid template
    this.templates.set("invoice_paid", {
      id: "invoice_paid",
      name: "Invoice Paid Notification",
      version: "1.0.0",
      subject: "Invoice #{{invoiceId}} has been paid",
      body: `Your invoice #{{invoiceId}} has been successfully paid by {{payer}}.

Amount: {{amount}}
Paid At: {{paidAt}}

The funds have been released to the liquidity provider.`,
      triggers: ["invoice_paid"],
      createdAt: now,
      updatedAt: now,
    });

    // Invoice defaulted template
    this.templates.set("invoice_defaulted", {
      id: "invoice_defaulted",
      name: "Invoice Defaulted Notification",
      version: "1.0.0",
      subject: "Invoice #{{invoiceId}} has defaulted",
      body: `Invoice #{{invoiceId}} from {{payer}} has reached its due date without payment.

Amount: {{amount}}
Due Date: {{dueDate}}

The liquidity provider may now claim default.`,
      triggers: ["invoice_defaulted"],
      createdAt: now,
      updatedAt: now,
    });

    // Invoice due soon template
    this.templates.set("invoice_due_soon", {
      id: "invoice_due_soon",
      name: "Invoice Due Soon Warning",
      version: "1.0.0",
      subject: "Invoice #{{invoiceId}} is due soon",
      body: `Reminder: Invoice #{{invoiceId}} from {{payer}} is due soon.

Amount: {{amount}}
Due Date: {{dueDate}}
Days Remaining: {{daysRemaining}}

Please ensure payment is made on time.`,
      triggers: ["invoice_due_soon"],
      createdAt: now,
      updatedAt: now,
    });

    // Invoice overdue template
    this.templates.set("invoice_overdue", {
      id: "invoice_overdue",
      name: "Invoice Overdue Notification",
      version: "1.0.0",
      subject: "Invoice #{{invoiceId}} is overdue",
      body: `Invoice #{{invoiceId}} from {{payer}} is now overdue.

Amount: {{amount}}
Due Date: {{dueDate}}
Days Overdue: {{daysOverdue}}

Please make payment immediately to avoid default.`,
      triggers: ["invoice_overdue"],
      createdAt: now,
      updatedAt: now,
    });
  }

  /**
   * Render a template with given context
   */
  render(templateId: string, context: TemplateContext): RenderResult {
    const template = this.templates.get(templateId);
    if (!template) {
      return {
        subject: "",
        body: "",
        success: false,
        errors: [`Template not found: ${templateId}`],
      };
    }

    const errors: string[] = [];

    try {
      const subject = this.processTemplate(template.subject, context);
      const body = this.processTemplate(template.body, context);

      return {
        subject,
        body,
        success: errors.length === 0,
        errors: errors.length > 0 ? errors : undefined,
      };
    } catch (error) {
      return {
        subject: "",
        body: "",
        success: false,
        errors: [`Rendering failed: ${error instanceof Error ? error.message : String(error)}`],
      };
    }
  }

  /**
   * Process template string with variable interpolation and conditionals
   */
  private processTemplate(template: string, context: TemplateContext): string {
    let result = template;

    // Process conditionals first
    result = this.processConditionals(result, context);

    // Process variables
    result = this.processVariables(result, context);

    return result;
  }

  /**
   * Process conditional blocks
   */
  private processConditionals(template: string, context: TemplateContext): string {
    return template.replace(this.conditionalRegex, (match, condition, content) => {
      const value = this.getContextValue(condition, context);
      const isTruthy = this.isTruthy(value);
      return isTruthy ? content : "";
    });
  }

  /**
   * Process variable substitutions
   */
  private processVariables(template: string, context: TemplateContext): string {
    return template.replace(this.variableRegex, (match, varName) => {
      const value = this.getContextValue(varName, context);
      return value !== undefined ? String(value) : match;
    });
  }

  /**
   * Get value from context by variable name
   */
  private getContextValue(varName: string, context: TemplateContext): unknown {
    // Handle nested property access (e.g., invoice.id)
    const parts = varName.split(".");
    let value: unknown = context;

    for (const part of parts) {
      if (value && typeof value === "object" && part in value) {
        value = (value as Record<string, unknown>)[part];
      } else {
        return undefined;
      }
    }

    return value;
  }

  /**
   * Check if a value is truthy for conditional evaluation
   */
  private isTruthy(value: unknown): boolean {
    if (value === undefined || value === null) {
      return false;
    }
    if (typeof value === "boolean") {
      return value;
    }
    if (typeof value === "number") {
      return value !== 0;
    }
    if (typeof value === "string") {
      return value.length > 0;
    }
    if (Array.isArray(value)) {
      return value.length > 0;
    }
    return true;
  }

  /**
   * Create or update a template
   */
  upsertTemplate(template: Template): void {
    const existing = this.templates.get(template.id);
    this.templates.set(template.id, {
      ...template,
      updatedAt: Date.now(),
      createdAt: existing?.createdAt ?? template.createdAt,
    });
  }

  /**
   * Get a template by ID
   */
  getTemplate(templateId: string): Template | undefined {
    return this.templates.get(templateId);
  }

  /**
   * List all templates
   */
  listTemplates(): Template[] {
    return Array.from(this.templates.values());
  }

  /**
   * Delete a template
   */
  deleteTemplate(templateId: string): boolean {
    return this.templates.delete(templateId);
  }

  /**
   * Test a template with sample context
   */
  testTemplate(templateId: string, context: TemplateContext): TemplateTestResult {
    const result = this.render(templateId, context);
    
    return {
      success: result.success,
      rendered: result.success ? result : undefined,
      errors: result.errors,
    };
  }

  /**
   * Validate template syntax
   */
  validateTemplate(template: string): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Check for unclosed conditionals
    const ifCount = (template.match(/\{%\s*if/g) || []).length;
    const endifCount = (template.match(/\{%\s*endif/g) || []).length;
    
    if (ifCount !== endifCount) {
      errors.push(`Unclosed conditional blocks: ${ifCount} if blocks but ${endifCount} endif blocks`);
    }

    // Check for malformed variables
    const varMatches = template.match(/\{\{(\w+)\}\}/g) || [];
    for (const match of varMatches) {
      if (!/^\{\{\w+\}\}$/.test(match)) {
        errors.push(`Malformed variable: ${match}`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Get template version history (simplified - stores only current version)
   */
  getTemplateVersion(templateId: string, version: string): Template | undefined {
    const template = this.templates.get(templateId);
    if (template && template.version === version) {
      return template;
    }
    return undefined;
  }

  /**
   * Export all templates
   */
  exportTemplates(): Record<string, Template> {
    return Object.fromEntries(this.templates.entries());
  }

  /**
   * Import templates
   */
  importTemplates(templates: Record<string, Template>): void {
    for (const [id, template] of Object.entries(templates)) {
      this.templates.set(id, template);
    }
  }

  /**
   * Clear all templates
   */
  clearTemplates(): void {
    this.templates.clear();
    this.initializeDefaultTemplates();
  }
}
