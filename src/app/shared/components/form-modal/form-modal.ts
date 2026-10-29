import { Component, inject, input, output } from '@angular/core';
import { DeviceInfoService } from '@app/services/device-info.service';
import { VModal } from '@ui-kit/components/v-modal/v-modal';

@Component({
  selector: 'form-modal',
  templateUrl: './form-modal.html',
  imports: [VModal],
})
export class FormModal {
  protected readonly deviceInfoService = inject(DeviceInfoService);

  public readonly isModalOpen = input<boolean>(false);
  public readonly isBackdropDimmed = input<boolean>(true);

  public readonly closeOutput = output<void>();

  protected onClose(): void {
    this.closeOutput.emit();
  }
}
