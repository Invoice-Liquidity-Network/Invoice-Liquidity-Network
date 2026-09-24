import { checkPriceBounds } from "./bounds";

describe("checkPriceBounds", () => {
    it("should reject extreme price spike without quorum", () => {
        const result = checkPriceBounds(100, 150, 2);
        expect(result).toBe(false);
    });

    it("should accept extreme price spike with quorum", () => {
        const result = checkPriceBounds(100, 150, 3);
        expect(result).toBe(true);
    });

    it("should accept normal price movement without quorum", () => {
        const result = checkPriceBounds(100, 105, 1);
        expect(result).toBe(true);
    });
});
