import { Component, effect, inject, viewChild } from '@angular/core';
import { NotificationService } from '@app/services/notification.service';
import { ANIMATION_CLASSES } from '@app/shared/animations';
import { VToast } from '@ui-kit/components/v-toast/v-toast';
import { VTopLayerDirective } from '@ui-kit/directives/top-layer.directive';

@Component({
  selector: 'notifications',
  templateUrl: './notifications.html',
  host: {
    '(document:v-modal-opened)': 'raise()',
  },
  imports: [VToast, VTopLayerDirective],
})
export class Notifications {
  protected readonly notificationService = inject(NotificationService);
  protected readonly AnimationClass = ANIMATION_CLASSES;

  private readonly topLayer = viewChild.required(VTopLayerDirective);

  // The top layer stacks by order of entry: toasts re-enter it on every new toast and every modal opening to stay above modals.
  private readonly raiseOnNewToastEffect = effect(() => {
    this.notificationService.notifications$$();
    this.raise();
  });

  protected raise(): void {
    this.topLayer().bringToFront();
  }

  protected dismiss(id: string): void {
    this.notificationService.removeNotification(id);
  }
}
