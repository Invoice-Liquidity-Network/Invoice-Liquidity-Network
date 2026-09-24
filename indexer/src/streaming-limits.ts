export const MAX_SESSION_MEMORY_MB = 500;
export const MAX_SESSION_ROWS = 100000;
export const MAX_SESSION_DURATION_MS = 60000;

export function enforceStreamingLimits(memoryMb: number, rowCount: number, durationMs: number): boolean {
    if (memoryMb > MAX_SESSION_MEMORY_MB || rowCount > MAX_SESSION_ROWS || durationMs > MAX_SESSION_DURATION_MS) {
        throw new Error("Resource budget exceeded for streaming export session.");
    }
    return true;
}
