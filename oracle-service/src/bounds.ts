export const MAX_PRICE_DELTA = 0.15; // 15% max movement
export function checkPriceBounds(oldPrice: number, newPrice: number, quorumCount: number): boolean {
    const delta = Math.abs(newPrice - oldPrice) / oldPrice;
    if (delta > MAX_PRICE_DELTA) {
        if (quorumCount < 3) {
            console.error(`ALERT: Price delta ${delta} exceeds maximum allowed bounds without quorum. Holding for review.`);
            return false;
        }
    }
    return true;
}
