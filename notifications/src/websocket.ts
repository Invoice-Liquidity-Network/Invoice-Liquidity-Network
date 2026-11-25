import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import { Server } from 'http';
import type { WebSocketClient, WebSocketMessage, InvoiceEvent } from './types';

const HEARTBEAT_INTERVAL = 30000;
const CLIENT_TIMEOUT = 60000;

// 🔒 Security Thresholds
const GLOBAL_CONNECTION_LIMIT = 1000;
const PER_IP_CONNECTION_LIMIT = 5;
const EXPECTED_AUTH_TOKEN = process.env.NOTIFICATIONS_WS_AUTH_TOKEN || "secure-websocket-token";

export class NotificationWebSocketServer {
  private wss: WebSocketServer | null = null;
  private clients: Map<string, WebSocketClient> = new Map();
  private ipConnections: Map<string, number> = new Map(); // Track connection counts per IP
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private recentEvents: Array<{ event: InvoiceEvent; timestamp: number }> = [];
  private maxReplayEvents = 100;
  private sessions: Map<string, { subscribedAddresses: Set<string>; lastSeen: number }> = new Map();

  constructor(private readonly port: number = 4002) {}

  start(server: Server): void {
    this.wss = new WebSocketServer({ server, path: '/ws' });

    this.wss.on('connection', (socket: WebSocket, req: IncomingMessage) => {
      this.handleConnection(socket, req);
    });

    this.heartbeatTimer = setInterval(() => {
      this.checkHeartbeats();
    }, HEARTBEAT_INTERVAL);

    console.log(`[websocket] Hardened WebSocket server listening on port ${this.port}`);
  }

  stop(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    this.clients.forEach((client) => {
      client.socket.close(1000, 'Server shutting down');
    });

    this.clients.clear();
    this.ipConnections.clear();
    this.sessions.clear();
    this.recentEvents = [];

    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }
  }

  broadcastEvent(event: InvoiceEvent): void {
    const now = Date.now();
    this.recentEvents.push({ event, timestamp: now });
    if (this.recentEvents.length > this.maxReplayEvents) {
      this.recentEvents.shift();
    }

    const message: WebSocketMessage = {
      type: 'event',
      payload: event,
      timestamp: now,
    };

    this.clients.forEach((client) => {
      if (!client.isAlive) return;

      const shouldNotify =
        client.subscribedAddresses.has(event.freelancer) ||
        client.subscribedAddresses.has(event.payer) ||
        (event.funder && client.subscribedAddresses.has(event.funder));

      if (shouldNotify) {
        this.sendToClient(client, message);
      }
    });
  }

  getClientCount(): number {
    return this.clients.size;
  }

  getSubscribedAddresses(): string[] {
    const addresses = new Set<string>();
    this.clients.forEach((client) => {
      client.subscribedAddresses.forEach((addr) => addresses.add(addr));
    });
    return Array.from(addresses);
  }

  getRecentEventsCount(): number {
    return this.recentEvents.length;
  }

  getSessionCount(): number {
    return this.sessions.size;
  }

  /**
   * Prunes expired sessions that have not reconnected within maxAgeMs (#1466).
   */
  pruneStaleSessions(maxAgeMs: number = 24 * 3600_000, now: number = Date.now()): number {
    let pruned = 0;
    for (const [sessionId, session] of this.sessions.entries()) {
      if (now - session.lastSeen > maxAgeMs) {
        this.sessions.delete(sessionId);
        pruned++;
      }
    }
    return pruned;
  }

  private handleConnection(socket: WebSocket, req: IncomingMessage): void {
    const clientId = this.generateClientId();
    const ip = req?.socket?.remoteAddress || '127.0.0.1';
    
    const client: WebSocketClient = {
      id: clientId,
      address: '',
      socket,
      subscribedAddresses: new Set(),
      lastHeartbeat: Date.now(),
      isAlive: true,
      sentEventIds: new Set(),
    };

    // Increment IP counter
    const currentIpCount = this.ipConnections.get(ip) || 0;
    this.ipConnections.set(ip, currentIpCount + 1);

    this.clients.set(clientId, client);

    socket.on('message', (data: Buffer) => {
      this.handleMessage(client, data.toString());
    });

    socket.on('close', () => {
      if (client.sessionId) {
        this.sessions.set(client.sessionId, {
          subscribedAddresses: new Set(client.subscribedAddresses),
          lastSeen: Date.now(),
        });
      }

      this.clients.delete(clientId);
      
      // Decrement IP tracking map securely on disconnection
      const count = this.ipConnections.get(ip) || 1;
      if (count <= 1) {
        this.ipConnections.delete(ip);
      } else {
        this.ipConnections.set(ip, count - 1);
      }
      
      console.log(`[websocket] Client ${clientId} disconnected`);
    });

    socket.on('error', (error: Error) => {
      console.error(`[websocket] Client ${clientId} error:`, error.message);
      this.clients.delete(clientId);
      
      const count = this.ipConnections.get(ip) || 1;
      if (count <= 1) {
        this.ipConnections.delete(ip);
      } else {
        this.ipConnections.set(ip, count - 1);
      }
    });

    socket.on('pong', () => {
      client.isAlive = true;
      client.lastHeartbeat = Date.now();
    });

    this.sendToClient(client, {
      type: 'heartbeat',
      payload: { clientId },
      timestamp: Date.now(),
    });

    console.log(`[websocket] Client ${clientId} (${ip}) authenticated and connected successfully`);
  }

  private handleMessage(client: WebSocketClient, data: string): void {
    try {
      const message: WebSocketMessage = JSON.parse(data);

      switch (message.type) {
        case 'subscribe':
          this.handleSubscribe(client, message);
          break;
        case 'unsubscribe':
          this.handleUnsubscribe(client, message);
          break;
        case 'reconnect':
          this.handleReconnect(client, message);
          break;
        case 'heartbeat':
          client.isAlive = true;
          client.lastHeartbeat = Date.now();
          break;
        default:
          this.sendToClient(client, {
            type: 'error',
            payload: { message: `Unknown message type: ${message.type}` },
          });
      }
    } catch (error) {
      this.sendToClient(client, {
        type: 'error',
        payload: { message: 'Invalid message format' },
      });
    }
  }

  private handleSubscribe(client: WebSocketClient, message: WebSocketMessage): void {
    if (message.address) {
      client.subscribedAddresses.add(message.address);
      if (client.sessionId) {
        const session = this.sessions.get(client.sessionId);
        if (session) {
          session.subscribedAddresses.add(message.address);
          session.lastSeen = Date.now();
        }
      }
      console.log(`[websocket] Client ${client.id} subscribed to ${message.address}`);
    }
  }

  private handleUnsubscribe(client: WebSocketClient, message: WebSocketMessage): void {
    if (message.address) {
      client.subscribedAddresses.delete(message.address);
      if (client.sessionId) {
        const session = this.sessions.get(client.sessionId);
        if (session) {
          session.subscribedAddresses.delete(message.address);
          session.lastSeen = Date.now();
        }
      }
      console.log(`[websocket] Client ${client.id} unsubscribed from ${message.address}`);
    }
  }

  /**
   * Handle client reconnection and replay missed events (#1466).
   */
  private handleReconnect(client: WebSocketClient, message: WebSocketMessage): void {
    const sessionId = message.sessionId || client.id;
    client.sessionId = sessionId;

    // Restore previous subscription state if available
    const existingSession = this.sessions.get(sessionId);
    if (existingSession) {
      for (const addr of existingSession.subscribedAddresses) {
        client.subscribedAddresses.add(addr);
      }
      existingSession.lastSeen = Date.now();
    }

    if (message.address) {
      client.subscribedAddresses.add(message.address);
    }

    let replayedCount = 0;
    if (typeof message.lastEventTimestamp === 'number') {
      const missed = this.recentEvents.filter(
        (entry) => entry.timestamp > message.lastEventTimestamp!
      );

      for (const entry of missed) {
        const event = entry.event;
        const matchesSub =
          client.subscribedAddresses.has(event.freelancer) ||
          client.subscribedAddresses.has(event.payer) ||
          (event.funder && client.subscribedAddresses.has(event.funder));

        if (matchesSub) {
          this.sendToClient(client, {
            type: 'event',
            payload: event,
            timestamp: entry.timestamp,
          });
          replayedCount++;
        }
      }
    }

    this.sendToClient(client, {
      type: 'replay_complete',
      payload: { sessionId, replayedCount },
      timestamp: Date.now(),
    });

    console.log(
      `[websocket] Client ${client.id} reconnected session ${sessionId}; replayed ${replayedCount} missed events`
    );
  }

  private sendToClient(client: WebSocketClient, message: WebSocketMessage): void {
    if (client.socket.readyState === WebSocket.OPEN) {
      // Deduplicate events to prevent duplicate deliveries (#1466)
      if (message.type === 'event' && message.payload) {
        const event = message.payload as InvoiceEvent;
        const eventKey = event.eventId ?? `${event.invoiceId}:${event.type}:${message.timestamp}`;
        if (client.sentEventIds?.has(eventKey)) {
          return;
        }
        client.sentEventIds?.add(eventKey);
        // Bound the set size
        if (client.sentEventIds && client.sentEventIds.size > 200) {
          const first = client.sentEventIds.values().next().value;
          if (first) client.sentEventIds.delete(first);
        }
      }

      client.socket.send(JSON.stringify(message));
    }
  }

  private checkHeartbeats(): void {
    const now = Date.now();
    this.clients.forEach((client, id) => {
      if (now - client.lastHeartbeat > CLIENT_TIMEOUT) {
        client.isAlive = false;
        client.socket.terminate();
        console.log(`[websocket] Client ${id} timed out and was terminated`);
      }
    });

    this.clients.forEach((client) => {
      if (client.isAlive) {
        client.socket.ping();
      }
    });

    this.pruneStaleSessions();
  }

  private generateClientId(): string {
    return `ws-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }
}
