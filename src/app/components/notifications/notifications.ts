import { Component, inject } from '@angular/core';
import { NotificationService } from '@app/services/notification.service';
import { ANIMATION_CLASSES } from '@app/shared/animations';
import { VToast } from '@ui-kit/components/v-toast/v-toast';

@Component({
  selector: 'notifications',
  templateUrl: './notifications.html',
  imports: [VToast],
})
export class Notifications {
  protected readonly notificationService = inject(NotificationService);
  protected readonly AnimationClass = ANIMATION_CLASSES;

  protected dismiss(id: string): void {
    this.notificationService.removeNotification(id);
  }
}
