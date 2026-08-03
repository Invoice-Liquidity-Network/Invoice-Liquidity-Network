import { describe, it, expect } from "vitest";
import { TemplateEngine } from "./template-engine";

describe("TemplateEngine", () => {
  let engine: TemplateEngine;

  beforeEach(() => {
    engine = new TemplateEngine();
  });

  describe("Initialization", () => {
    it("should initialize with default templates", () => {
      const templates = engine.listTemplates();
      expect(templates.length).toBeGreaterThan(0);
      expect(templates.find(t => t.id === "invoice_submitted")).toBeDefined();
      expect(templates.find(t => t.id === "invoice_funded")).toBeDefined();
      expect(templates.find(t => t.id === "invoice_paid")).toBeDefined();
      expect(templates.find(t => t.id === "invoice_disputed")).toBeDefined();
    });
  });

  describe("Template rendering", () => {
    it("should render template with variables", () => {
      const result = engine.render("invoice_funded", {
        invoice: {
          id: 123,
          freelancer: "GABCD...",
          payer: "GXYZ...",
          amount: "1000",
          due_date: 1234567890,
          discount_rate: 300,
          status: "Funded",
          funder: "GFUND...",
          funded_at: 1234567890,
        },
      });

      expect(result.success).toBe(true);
      expect(result.subject).toContain("123");
      expect(result.body).toContain("1000");
    });

    it("should return error for non-existent template", () => {
      const result = engine.render("nonexistent", {});
      expect(result.success).toBe(false);
      expect(result.errors).toContain("Template not found: nonexistent");
    });

    it("should handle missing variables gracefully", () => {
      const result = engine.render("invoice_funded", {});
      expect(result.success).toBe(true);
      // Missing variables should remain as placeholders
      expect(result.body).toContain("{{");
    });
  });

  describe("Variable interpolation", () => {
    it("should interpolate simple variables", () => {
      const result = engine.render("invoice_funded", {
        invoice: { id: 123, freelancer: "G...", payer: "G...", amount: "1000", due_date: 0, discount_rate: 0, status: "" },
      });
      expect(result.body).toContain("123");
    });

    it("should interpolate nested properties", () => {
      const template = {
        id: "test",
        name: "Test",
        version: "1.0.0",
        subject: "Test",
        body: "Invoice {{invoice.id}} from {{invoice.payer}}",
        triggers: [],
        createdAt: 0,
        updatedAt: 0,
      };
      engine.upsertTemplate(template);

      const result = engine.render("test", {
        invoice: { id: 456, freelancer: "G...", payer: "GXYZ...", amount: "1000", due_date: 0, discount_rate: 0, status: "" },
      });

      expect(result.body).toContain("456");
      expect(result.body).toContain("GXYZ...");
    });
  });

  describe("Conditional blocks", () => {
    it("should render conditional content when truthy", () => {
      const template = {
        id: "conditional",
        name: "Conditional Test",
        version: "1.0.0",
        subject: "Test",
        body: "{% if invoice.funder %}Funded by {{invoice.funder}}{% endif %}",
        triggers: [],
        createdAt: 0,
        updatedAt: 0,
      };
      engine.upsertTemplate(template);

      const result = engine.render("conditional", {
        invoice: { id: 1, freelancer: "G...", payer: "G...", amount: "1000", due_date: 0, discount_rate: 0, status: "", funder: "GFUND..." },
      });

      expect(result.body).toContain("Funded by GFUND...");
    });

    it("should hide conditional content when falsy", () => {
      const template = {
        id: "conditional",
        name: "Conditional Test",
        version: "1.0.0",
        subject: "Test",
        body: "{% if invoice.funder %}Funded by {{invoice.funder}}{% endif %}",
        triggers: [],
        createdAt: 0,
        updatedAt: 0,
      };
      engine.upsertTemplate(template);

      const result = engine.render("conditional", {
        invoice: { id: 1, freelancer: "G...", payer: "G...", amount: "1000", due_date: 0, discount_rate: 0, status: "" },
      });

      expect(result.body).not.toContain("Funded by");
    });
  });

  describe("Template management", () => {
    it("should upsert template", () => {
      const template = {
        id: "custom",
        name: "Custom Template",
        version: "1.0.0",
        subject: "Custom",
        body: "Custom body",
        triggers: ["custom_trigger"],
        createdAt: 0,
        updatedAt: 0,
      };

      engine.upsertTemplate(template);
      const retrieved = engine.getTemplate("custom");

      expect(retrieved).toBeDefined();
      expect(retrieved?.name).toBe("Custom Template");
    });

    it("should update existing template", () => {
      const template = {
        id: "custom",
        name: "Original",
        version: "1.0.0",
        subject: "Original",
        body: "Original body",
        triggers: [],
        createdAt: 1000,
        updatedAt: 1000,
      };

      engine.upsertTemplate(template);

      const updated = {
        ...template,
        name: "Updated",
        body: "Updated body",
      };

      engine.upsertTemplate(updated);
      const retrieved = engine.getTemplate("custom");

      expect(retrieved?.name).toBe("Updated");
      expect(retrieved?.body).toBe("Updated body");
      expect(retrieved?.createdAt).toBe(1000); // Original createdAt preserved
      expect(retrieved?.updatedAt).toBeGreaterThan(1000); // updatedAt updated
    });

    it("should get template by ID", () => {
      const template = engine.getTemplate("invoice_funded");
      expect(template).toBeDefined();
      expect(template?.id).toBe("invoice_funded");
    });

    it("should return undefined for non-existent template", () => {
      const template = engine.getTemplate("nonexistent");
      expect(template).toBeUndefined();
    });

    it("should list all templates", () => {
      const templates = engine.listTemplates();
      expect(Array.isArray(templates)).toBe(true);
      expect(templates.length).toBeGreaterThan(0);
    });

    it("should delete template", () => {
      const template = {
        id: "to_delete",
        name: "To Delete",
        version: "1.0.0",
        subject: "Delete",
        body: "Body",
        triggers: [],
        createdAt: 0,
        updatedAt: 0,
      };

      engine.upsertTemplate(template);
      expect(engine.getTemplate("to_delete")).toBeDefined();

      const deleted = engine.deleteTemplate("to_delete");
      expect(deleted).toBe(true);
      expect(engine.getTemplate("to_delete")).toBeUndefined();
    });

    it("should return false when deleting non-existent template", () => {
      const deleted = engine.deleteTemplate("nonexistent");
      expect(deleted).toBe(false);
    });

    it("should clear all templates and reinitialize defaults", () => {
      engine.upsertTemplate({
        id: "custom",
        name: "Custom",
        version: "1.0.0",
        subject: "Custom",
        body: "Body",
        triggers: [],
        createdAt: 0,
        updatedAt: 0,
      });

      engine.clearTemplates();

      expect(engine.getTemplate("custom")).toBeUndefined();
      expect(engine.getTemplate("invoice_funded")).toBeDefined(); // Default restored
    });
  });

  describe("Template testing", () => {
    it("should test template successfully", () => {
      const result = engine.testTemplate("invoice_funded", {
        invoice: {
          id: 123,
          freelancer: "G...",
          payer: "G...",
          amount: "1000",
          due_date: 0,
          discount_rate: 0,
          status: "",
        },
      });

      expect(result.success).toBe(true);
      expect(result.rendered).toBeDefined();
      expect(result.rendered?.success).toBe(true);
    });

    it("should test template with errors", () => {
      const result = engine.testTemplate("nonexistent", {});

      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.rendered).toBeUndefined();
    });
  });

  describe("Template validation", () => {
    it("should validate correct template syntax", () => {
      const result = engine.validateTemplate("Hello {{name}} {% if show %}Visible{% endif %}");
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should detect unclosed conditional blocks", () => {
      const result = engine.validateTemplate("{% if show %}Visible");
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain("Unclosed conditional");
    });

    it("should detect malformed variables", () => {
      const result = engine.validateTemplate("{{invalid variable}}");
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain("Malformed variable");
    });
  });

  describe("Template versioning", () => {
    it("should get template by version", () => {
      const template = {
        id: "versioned",
        name: "Versioned",
        version: "2.0.0",
        subject: "Test",
        body: "Body",
        triggers: [],
        createdAt: 0,
        updatedAt: 0,
      };

      engine.upsertTemplate(template);
      const retrieved = engine.getTemplateVersion("versioned", "2.0.0");

      expect(retrieved).toBeDefined();
      expect(retrieved?.version).toBe("2.0.0");
    });

    it("should return undefined for wrong version", () => {
      const template = {
        id: "versioned",
        name: "Versioned",
        version: "2.0.0",
        subject: "Test",
        body: "Body",
        triggers: [],
        createdAt: 0,
        updatedAt: 0,
      };

      engine.upsertTemplate(template);
      const retrieved = engine.getTemplateVersion("versioned", "1.0.0");

      expect(retrieved).toBeUndefined();
    });
  });

  describe("Import/Export", () => {
    it("should export all templates", () => {
      const exported = engine.exportTemplates();
      expect(typeof exported).toBe("object");
      expect(exported["invoice_funded"]).toBeDefined();
    });

    it("should import templates", () => {
      const templates = {
        imported: {
          id: "imported",
          name: "Imported",
          version: "1.0.0",
          subject: "Import",
          body: "Body",
          triggers: [],
          createdAt: 0,
          updatedAt: 0,
        },
      };

      engine.importTemplates(templates);
      const retrieved = engine.getTemplate("imported");

      expect(retrieved).toBeDefined();
      expect(retrieved?.name).toBe("Imported");
    });
  });

  describe("Truthy evaluation", () => {
    it("should evaluate truthy values correctly", () => {
      const template = {
        id: "truthy",
        name: "Truthy Test",
        version: "1.0.0",
        subject: "Test",
        body: "{% if value %}Truthy{% endif %}",
        triggers: [],
        createdAt: 0,
        updatedAt: 0,
      };
      engine.upsertTemplate(template);

      // Test various truthy values
      expect(engine.render("truthy", { value: true }).body).toContain("Truthy");
      expect(engine.render("truthy", { value: 1 }).body).toContain("Truthy");
      expect(engine.render("truthy", { value: "text" }).body).toContain("Truthy");
      expect(engine.render("truthy", { value: [1, 2] }).body).toContain("Truthy");
      expect(engine.render("truthy", { value: { a: 1 } }).body).toContain("Truthy");
    });

    it("should evaluate falsy values correctly", () => {
      const template = {
        id: "falsy",
        name: "Falsy Test",
        version: "1.0.0",
        subject: "Test",
        body: "{% if value %}Truthy{% endif %}",
        triggers: [],
        createdAt: 0,
        updatedAt: 0,
      };
      engine.upsertTemplate(template);

      // Test various falsy values
      expect(engine.render("falsy", { value: false }).body).not.toContain("Truthy");
      expect(engine.render("falsy", { value: 0 }).body).not.toContain("Truthy");
      expect(engine.render("falsy", { value: "" }).body).not.toContain("Truthy");
      expect(engine.render("falsy", { value: null }).body).not.toContain("Truthy");
      expect(engine.render("falsy", { value: undefined }).body).not.toContain("Truthy");
      expect(engine.render("falsy", { value: [] }).body).not.toContain("Truthy");
    });
  });
});
