import { Service, signal, WritableSignal } from '@angular/core';
import { NOTIFICATION_DEFAULT_DURATION_MS } from '@app/shared/const';

export interface NotificationMessage {
  id: string;
  type: 'error' | 'warning' | 'info' | 'success';
  message: string;
  timestamp: number;
  persistent: boolean;
}

export interface AddNotificationOptions {
  persistent?: boolean;
  durationMs?: number;
}

@Service()
export class NotificationService {
  public notifications$$: WritableSignal<NotificationMessage[]> = signal([]);

  public showSyncError(message: string): void {
    this.addNotification('error', `Sync error: ${message}`);
  }

  public showSyncSuccess(message: string = 'Data synchronized successfully'): void {
    this.addNotification('success', message);
  }

  public showOfflineMode(): void {
    this.addNotification('warning', 'You are offline. Changes will be synchronized when connection is restored.');
  }

  public addNotification(type: NotificationMessage['type'], message: string, options?: AddNotificationOptions): string {
    const notification: NotificationMessage = {
      id: crypto.randomUUID(),
      type,
      message,
      timestamp: Date.now(),
      persistent: options?.persistent ?? false,
    };

    this.notifications$$.update((current) => [...current, notification]);

    if (!options?.persistent) {
      const durationMs = options?.durationMs ?? NOTIFICATION_DEFAULT_DURATION_MS;
      setTimeout(() => this.removeNotification(notification.id), durationMs);
    }

    return notification.id;
  }

  public removeNotification(id: string): void {
    this.notifications$$.update((current) => current.filter((n) => n.id !== id));
  }

  public clearAll(): void {
    this.notifications$$.set([]);
  }
}
