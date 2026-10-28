import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import { DeviceInfoService } from '@app/services/device-info.service';
import { VButton } from '@ui-kit/components/v-button/v-button';
import { VModal } from '@ui-kit/components/v-modal/v-modal';

@Component({
  selector: 'default-modal',
  templateUrl: 'default-modal.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  imports: [VButton, VModal],
})
export class DefaultModal {
  protected readonly deviceInfoService = inject(DeviceInfoService);

  public readonly isModalOpen = input<boolean>(false);
  public readonly modalTitle = input<string>('');
  public readonly modalMessage = input<string>('');
  public readonly confirmButtonLabel = input<string>('Yes');
  public readonly cancelButtonLabel = input<string>('No');

  public readonly confirmOutput = output<void>();
  public readonly cancelOutput = output<void>();
  public readonly closeOutput = output<void>();

  protected onClose(): void {
    this.closeOutput.emit();
  }

  protected onCancel(): void {
    this.cancelOutput.emit();
  }

  protected onConfirm(): void {
    this.confirmOutput.emit();
  }
}
