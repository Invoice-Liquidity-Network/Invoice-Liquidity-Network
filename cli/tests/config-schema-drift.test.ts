import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { ConfigSchema } from "../src/config";

describe("Config Schema Drift", () => {
  it("should have parity between config.schema.json and ConfigSchema", () => {
    // 1. Load JSON Schema properties
    const schemaPath = path.join(__dirname, "../config.schema.json");
    const jsonSchema = JSON.parse(readFileSync(schemaPath, "utf8"));
    const jsonProperties = Object.keys(jsonSchema.properties || {}).sort();

    // 2. Load Zod Schema shape keys
    // @ts-expect-error Zod shape access for dynamic keys
    const zodProperties = Object.keys(ConfigSchema.shape)
      .filter((key) => key !== "$schema")
      .sort();

    // 3. Compare them to ensure no drift
    expect(jsonProperties).toEqual(zodProperties);
  });
});
