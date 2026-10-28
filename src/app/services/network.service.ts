import { Injectable, computed, signal } from '@angular/core';
import { IncomingWsMessage, OutgoingWsMessage, PongWsMessage, WebSocketMessageType } from '@app/shared/types';
import { Subject } from 'rxjs';
import { NotificationService } from './notification.service';

// One byte prefix identifying a binary WS frame's payload — mirrors
// megaapp-back's wsFrameMetricsUpdate/wsFrameMetricsLatest (realtime.go).
// Binary frames carry metrics wire-format data (see shared/metrics-wire.ts)
// and never go through the JSON wsMessages$ channel — a JSON envelope
// around binary data would force it through base64 and defeat the point of
// a binary format.
export const MetricsBinaryFrameType = {
  Update: 0,
  Latest: 1,
} as const;

export type MetricsBinaryFrameType = (typeof MetricsBinaryFrameType)[keyof typeof MetricsBinaryFrameType];

export interface MetricsBinaryFrame {
  frameType: MetricsBinaryFrameType;
  payload: ArrayBuffer;
}

export const RealtimeState = {
  Stopped: 'stopped',
  Connecting: 'connecting',
  Connected: 'connected',
  Waiting: 'waiting',
  Offline: 'offline',
} as const;

export type RealtimeState = (typeof RealtimeState)[keyof typeof RealtimeState];

const FIRST_RECONNECT_DELAY_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 30_000;
const STABLE_CONNECTION_MS = 10_000;

@Injectable({ providedIn: 'root' })
export class NetworkService {
  public readonly isOnline$$ = signal(navigator.onLine);
  public readonly isConnected$$ = signal(false);
  public readonly realtimeState$$ = signal<RealtimeState>(RealtimeState.Stopped);
  public readonly isNetworkAvailable$$ = computed(() => this.isOnline$$());
  public readonly wsMessages$ = new Subject<IncomingWsMessage>();
  public readonly metricsBinaryFrames$ = new Subject<MetricsBinaryFrame>();
  public readonly connected$ = new Subject<void>();

  private socket: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private stableConnectionTimer: ReturnType<typeof setTimeout> | null = null;
  private shouldReconnect = false;
  private reconnectAttempt = 0;
  private sessionProbeInFlight = false;
  private sessionInvalidationHandler: (() => void) | null = null;
  private readonly clientId = this.getOrCreateClientId();

  public constructor(private readonly notifications: NotificationService) {
    window.addEventListener('online', () => this.updateOnlineStatus(true));
    window.addEventListener('offline', () => this.updateOnlineStatus(false));
    document.addEventListener('visibilitychange', () => this.onVisibilityChange());
  }

  public setSessionInvalidationHandler(handler: () => void): void {
    this.sessionInvalidationHandler = handler;
  }

  public getClientId(): string {
    return this.clientId;
  }

  public connect(): void {
    this.shouldReconnect = true;
    this.openIfAllowed();
  }

  public disconnect(): void {
    this.shouldReconnect = false;
    this.clearReconnectTimer();
    this.clearStableConnectionTimer();
    const socket = this.socket;
    this.socket = null;
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close(1000, 'Client disconnect');
    this.isConnected$$.set(false);
    this.realtimeState$$.set(RealtimeState.Stopped);
  }

  public sendMessage(message: OutgoingWsMessage | PongWsMessage): boolean {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN || !this.isConnected$$()) return false;
    this.socket.send(JSON.stringify({ version: 1, ...message }));
    return true;
  }

  private openIfAllowed(): void {
    if (!this.shouldReconnect || this.isSocketActive()) return;
    if (!this.isOnline$$()) {
      this.realtimeState$$.set(RealtimeState.Offline);
      return;
    }
    if (document.visibilityState === 'hidden') {
      this.realtimeState$$.set(RealtimeState.Waiting);
      return;
    }

    this.clearReconnectTimer();
    this.realtimeState$$.set(RealtimeState.Connecting);
    const socket = new WebSocket(this.buildWebSocketURL());
    socket.binaryType = 'arraybuffer';
    let wasOpened = false;
    this.socket = socket;

    socket.onopen = () => {
      if (this.socket !== socket) {
        socket.close();
        return;
      }
      wasOpened = true;
      this.isConnected$$.set(true);
      this.realtimeState$$.set(RealtimeState.Connected);
      this.connected$.next();
      this.clearStableConnectionTimer();
      this.stableConnectionTimer = setTimeout(() => {
        if (this.socket === socket && socket.readyState === WebSocket.OPEN) this.reconnectAttempt = 0;
      }, STABLE_CONNECTION_MS);
    };

    socket.onmessage = (event: MessageEvent<string | ArrayBuffer>) => {
      if (this.socket !== socket) return;
      if (event.data instanceof ArrayBuffer) {
        this.handleIncomingBinaryFrame(event.data);
        return;
      }
      try {
        this.handleIncomingMessage(JSON.parse(event.data) as IncomingWsMessage);
      } catch {
        // Invalid server message is isolated to this connection.
      }
    };

    socket.onclose = (event) => {
      if (this.socket === socket) this.socket = null;
      this.clearStableConnectionTimer();
      this.isConnected$$.set(false);
      if (!this.shouldReconnect) return;
      if (event.code === 4001 || event.code === 4002) {
        this.sessionInvalidationHandler?.();
        return;
      }
      if (!wasOpened) {
        void this.probeSessionThenReconnect();
        return;
      }
      this.scheduleReconnect();
    };
  }

  private async probeSessionThenReconnect(): Promise<void> {
    if (this.sessionProbeInFlight) return;
    this.sessionProbeInFlight = true;
    try {
      const response = await fetch('/api/auth/session', { credentials: 'same-origin' });
      if (response.status === 401) {
        this.sessionInvalidationHandler?.();
        return;
      }
    } catch {
      // Network and backend failures use reconnect backoff; they never end the session.
    } finally {
      this.sessionProbeInFlight = false;
    }
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (!this.shouldReconnect || this.reconnectTimer || !this.isOnline$$() || document.visibilityState === 'hidden')
      return;
    const exponentialDelay = Math.min(MAX_RECONNECT_DELAY_MS, FIRST_RECONNECT_DELAY_MS * 2 ** this.reconnectAttempt++);
    const delay = Math.round(exponentialDelay * (0.75 + Math.random() * 0.5));
    this.realtimeState$$.set(RealtimeState.Waiting);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openIfAllowed();
    }, delay);
  }

  private updateOnlineStatus(isOnline: boolean): void {
    this.isOnline$$.set(isOnline);
    if (!isOnline) {
      this.clearReconnectTimer();
      this.realtimeState$$.set(RealtimeState.Offline);
      this.notifications.showOfflineMode();
      return;
    }
    this.openIfAllowed();
  }

  private onVisibilityChange(): void {
    if (document.visibilityState === 'hidden') {
      this.clearReconnectTimer();
      return;
    }
    this.openIfAllowed();
  }

  private buildWebSocketURL(): string {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const hostname = window.location.hostname;
    const port = this.resolveWebSocketPort(window.location.port);
    return `${protocol}//${hostname}${port ? `:${port}` : ''}/api/ws?clientId=${encodeURIComponent(this.clientId)}`;
  }

  private resolveWebSocketPort(currentPort: string): string {
    return currentPort === '4200' || currentPort === '4201' ? '3000' : currentPort;
  }

  private getOrCreateClientId(): string {
    const storageKey = 'megaapp_tab_id';
    const existing = sessionStorage.getItem(storageKey);
    if (existing) return existing;
    const value = crypto.randomUUID();
    sessionStorage.setItem(storageKey, value);
    return value;
  }

  private isSocketActive(): boolean {
    return this.socket?.readyState === WebSocket.OPEN || this.socket?.readyState === WebSocket.CONNECTING;
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer === null) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private clearStableConnectionTimer(): void {
    if (this.stableConnectionTimer === null) return;
    clearTimeout(this.stableConnectionTimer);
    this.stableConnectionTimer = null;
  }

  private handleIncomingBinaryFrame(data: ArrayBuffer): void {
    if (data.byteLength === 0) return;
    // First byte is the frame-type prefix (see MetricsBinaryFrameType); the
    // rest is the wire-encoded payload, decoded downstream by whichever
    // service consumes that frame type (metrics.service.ts / metrics-health.service.ts).
    const frameType = new Uint8Array(data, 0, 1)[0] as MetricsBinaryFrameType;
    this.metricsBinaryFrames$.next({ frameType, payload: data.slice(1) });
  }

  private handleIncomingMessage(data: IncomingWsMessage): void {
    if (data.type === WebSocketMessageType.PING) {
      this.sendMessage({ type: WebSocketMessageType.PONG });
      return;
    }
    this.wsMessages$.next(data);
  }
}
