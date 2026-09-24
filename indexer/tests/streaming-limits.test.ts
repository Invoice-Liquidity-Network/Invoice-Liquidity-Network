import { enforceStreamingLimits } from "../src/streaming-limits";

describe("enforceStreamingLimits", () => {
    it("should throw error when limits exceeded", () => {
        expect(() => enforceStreamingLimits(600, 50000, 30000)).toThrow();
    });
});
