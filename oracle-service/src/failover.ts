export class FailoverManager {
    primaryHealthy: boolean = true;
    errorCount: number = 0;

    checkHealth(errorRate: number, latency: number, staleness: number) {
        if (errorRate > 0.05 || latency > 2000 || staleness > 300) {
            this.primaryHealthy = false;
            console.log("Automated failover triggered: switching to secondary source.");
        } else {
            this.primaryHealthy = true;
        }
    }
}
