import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NotificationWebSocketServer } from '../src/websocket';
import type { InvoiceEvent } from '../src/types';
import { EventEmitter } from 'events';

// Mock WebSocket
class MockWebSocket extends EventEmitter {
  readyState = 1; // WebSocket.OPEN
  sentMessages: string[] = [];
  terminated = false;

  send(data: string) {
    this.sentMessages.push(data);
  }

  ping() {}

  close(_code?: number, _reason?: string) {
    this.readyState = 3; // WebSocket.CLOSED
    this.emit('close');
  }

  terminate() {
    this.terminated = true;
    this.close();
  }
}

describe('Notification WebSocket Reconnect Hardening (#1466)', () => {
  let wsServer: NotificationWebSocketServer;

  beforeEach(() => {
    vi.useRealTimers();
    wsServer = new NotificationWebSocketServer(4002);
  });

  afterEach(() => {
    wsServer.stop();
  });

  const makeEvent = (overrides: Partial<InvoiceEvent> = {}): InvoiceEvent => ({
    eventId: 'evt-ws-1',
    type: 'funded',
    invoiceId: 99,
    amount: '1000',
    freelancer: 'G_FREELANCER_1',
    payer: 'G_PAYER_1',
    dueDate: 12345678,
    ...overrides,
  });

  it('records broadcast events in the circular replay buffer', () => {
    expect(wsServer.getRecentEventsCount()).toBe(0);
    wsServer.broadcastEvent(makeEvent({ eventId: 'e-1' }));
    wsServer.broadcastEvent(makeEvent({ eventId: 'e-2' }));
    expect(wsServer.getRecentEventsCount()).toBe(2);
  });

  it('replays missed events upon client reconnection with lastEventTimestamp', () => {
    const socket1 = new MockWebSocket();
    (wsServer as any).handleConnection(socket1 as any, { socket: { remoteAddress: '127.0.0.1' } } as any);

    // Initial connection sends heartbeat
    expect(socket1.sentMessages.length).toBe(1);

    // Subscribe to G_FREELANCER_1 with sessionId
    socket1.emit(
      'message',
      Buffer.from(
        JSON.stringify({
          type: 'subscribe',
          address: 'G_FREELANCER_1',
        })
      )
    );

    // Client disconnects
    socket1.emit(
      'message',
      Buffer.from(
        JSON.stringify({
          type: 'reconnect',
          sessionId: 'session-xyz',
          address: 'G_FREELANCER_1',
        })
      )
    );
    socket1.close();

    // Event happens while disconnected
    const missedTime = Date.now();
    wsServer.broadcastEvent(makeEvent({ eventId: 'missed-1', freelancer: 'G_FREELANCER_1' }));

    // Client reconnects on new socket with sessionId and lastEventTimestamp
    const socket2 = new MockWebSocket();
    (wsServer as any).handleConnection(socket2 as any, { socket: { remoteAddress: '127.0.0.1' } } as any);

    socket2.emit(
      'message',
      Buffer.from(
        JSON.stringify({
          type: 'reconnect',
          sessionId: 'session-xyz',
          lastEventTimestamp: missedTime - 1000,
        })
      )
    );

    // Should receive missed event and replay_complete
    const messages = socket2.sentMessages.map((m) => JSON.parse(m));
    const eventMsg = messages.find((m) => m.type === 'event' && m.payload.eventId === 'missed-1');
    const replayMsg = messages.find((m) => m.type === 'replay_complete');

    expect(eventMsg).toBeDefined();
    expect(replayMsg).toBeDefined();
    expect(replayMsg.payload.replayedCount).toBe(1);
  });

  it('deduplicates events sent to the same client', () => {
    const socket = new MockWebSocket();
    (wsServer as any).handleConnection(socket as any, { socket: { remoteAddress: '127.0.0.1' } } as any);

    socket.emit(
      'message',
      Buffer.from(
        JSON.stringify({
          type: 'subscribe',
          address: 'G_FREELANCER_1',
        })
      )
    );

    const event = makeEvent({ eventId: 'unique-event-1', freelancer: 'G_FREELANCER_1' });
    wsServer.broadcastEvent(event);
    // Broadcast exact same event again
    wsServer.broadcastEvent(event);

    const receivedEvents = socket.sentMessages
      .map((m) => JSON.parse(m))
      .filter((m) => m.type === 'event' && m.payload.eventId === 'unique-event-1');

    // Should only have been delivered once
    expect(receivedEvents).toHaveLength(1);
  });

  it('prunes stale disconnected sessions after maxAgeMs', () => {
    vi.useFakeTimers();
    const now = 1_000_000;
    vi.setSystemTime(now);

    const socket = new MockWebSocket();
    (wsServer as any).handleConnection(socket as any, { socket: { remoteAddress: '127.0.0.1' } } as any);

    socket.emit(
      'message',
      Buffer.from(
        JSON.stringify({
          type: 'reconnect',
          sessionId: 'old-session-1',
          address: 'G_FREELANCER_1',
        })
      )
    );
    socket.close();

    expect(wsServer.getSessionCount()).toBe(1);

    // Fast-forward 25 hours (greater than 24h default)
    vi.setSystemTime(now + 25 * 3600_000);
    const pruned = wsServer.pruneStaleSessions(24 * 3600_000, now + 25 * 3600_000);

    expect(pruned).toBe(1);
    expect(wsServer.getSessionCount()).toBe(0);
  });
});
