import { describe, expect, it } from "vitest";
import { printSchema, buildSchema } from "graphql";
import { typeDefs as yogaTypeDefs } from "../src/graphql";
import { typeDefs as modularTypeDefs } from "../src/graphql/schema";

function normalizeSchema(sdl: string): string {
  const schema = buildSchema(sdl);
  return printSchema(schema);
}

describe("GraphQL schema snapshot", () => {
  it("monolithic schema (graphql.ts) should match snapshot", () => {
    const sdl = normalizeSchema(yogaTypeDefs);
    expect(sdl).toMatchSnapshot();
  });

  it("modular schema (graphql/schema.ts) should match snapshot", () => {
    const sdl = normalizeSchema(modularTypeDefs);
    expect(sdl).toMatchSnapshot();
  });
});
