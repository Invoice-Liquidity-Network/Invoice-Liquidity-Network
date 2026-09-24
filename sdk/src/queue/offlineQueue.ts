export class OfflineWriteQueue {
  private queue: any[] = [];

  enqueue(writeOp: any) {
    this.queue.push(writeOp);
  }

  async flush() {
    // Process queue when online
  }
}
