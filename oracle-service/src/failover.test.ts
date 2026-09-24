import { FailoverManager } from "./failover";

describe("FailoverManager", () => {
    it("should failover when primary is unhealthy", () => {
        const manager = new FailoverManager();
        manager.checkHealth(0.10, 1000, 100);
        expect(manager.primaryHealthy).toBe(false);
    });
});
