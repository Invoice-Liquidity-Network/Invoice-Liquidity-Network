import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import { Server } from 'http';
import type { WebSocketClient, WebSocketMessage, InvoiceEvent } from './types';

const HEARTBEAT_INTERVAL = 30000;
const CLIENT_TIMEOUT = 60000;

export class NotificationWebSocketServer {
  private wss: WebSocketServer | null = null;
  private clients: Map<string, WebSocketClient> = new Map();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly port: number = 4002) {}

  start(server: Server): void {
    this.wss = new WebSocketServer({ server, path: '/ws' });

    this.wss.on('connection', (socket: WebSocket, req: IncomingMessage) => {
      this.handleConnection(socket, req);
    });

    this.heartbeatTimer = setInterval(() => {
      this.checkHeartbeats();
    }, HEARTBEAT_INTERVAL);

    console.log(`[websocket] WebSocket server listening on port ${this.port}`);
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

    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }
  }

  broadcastEvent(event: InvoiceEvent): void {
    const message: WebSocketMessage = {
      type: 'event',
      payload: event,
      timestamp: Date.now(),
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

  private handleConnection(socket: WebSocket, _req: IncomingMessage): void {
    const clientId = this.generateClientId();
    const client: WebSocketClient = {
      id: clientId,
      address: '',
      socket,
      subscribedAddresses: new Set(),
      lastHeartbeat: Date.now(),
      isAlive: true,
    };

    this.clients.set(clientId, client);

    socket.on('message', (data: Buffer) => {
      this.handleMessage(client, data.toString());
    });

    socket.on('close', () => {
      this.clients.delete(clientId);
      console.log(`[websocket] Client ${clientId} disconnected`);
    });

    socket.on('error', (error: Error) => {
      console.error(`[websocket] Client ${clientId} error:`, error.message);
      this.clients.delete(clientId);
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

    console.log(`[websocket] Client ${clientId} connected`);
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
      console.log(`[websocket] Client ${client.id} subscribed to ${message.address}`);
    }
  }

  private handleUnsubscribe(client: WebSocketClient, message: WebSocketMessage): void {
    if (message.address) {
      client.subscribedAddresses.delete(message.address);
      console.log(`[websocket] Client ${client.id} unsubscribed from ${message.address}`);
    }
  }

  private sendToClient(client: WebSocketClient, message: WebSocketMessage): void {
    if (client.socket.readyState === WebSocket.OPEN) {
      client.socket.send(JSON.stringify(message));
    }
  }

  private checkHeartbeats(): void {
    const now = Date.now();
    this.clients.forEach((client, id) => {
      if (now - client.lastHeartbeat > CLIENT_TIMEOUT) {
        client.isAlive = false;
        client.socket.terminate();
        this.clients.delete(id);
        console.log(`[websocket] Client ${id} timed out and was terminated`);
      }
    });

    this.clients.forEach((client) => {
      if (client.isAlive) {
        client.socket.ping();
      }
    });
  }

  private generateClientId(): string {
    return `ws-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }
}
