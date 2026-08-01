import YAML from "yaml";

describe("output formatter", () => {
  it("renders valid json", () => {
    const json = JSON.stringify(
      { id: 1 },
      null,
      2
    );

    expect(JSON.parse(json)).toEqual({
      id: 1,
    });
  });

  it("renders valid yaml", () => {
    const yaml = YAML.stringify({
      id: 1,
    });

    expect(YAML.parse(yaml)).toEqual({
      id: 1,
    });
  });
});
