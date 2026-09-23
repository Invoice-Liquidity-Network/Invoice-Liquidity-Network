import { db } from './db';
import { processEvent } from './processor';

export async function replayDlqEvents() {
  const events = db.prepare('SELECT * FROM dlq_events WHERE status = "pending"').all();
  for (const event of events) {
    try {
      await processEvent(JSON.parse(event.payload));
      db.prepare('UPDATE dlq_events SET status = "processed" WHERE id = ?').run(event.id);
    } catch (err) {
      console.error(`Replay failed for event ${event.id}`, err);
    }
  }
}
