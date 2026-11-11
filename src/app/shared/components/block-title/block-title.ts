import { Component, inject, input, output, signal } from '@angular/core';
import { DeviceInfoService } from '@app/services/device-info.service';
import { VButton } from '@ui-kit/components/v-button/v-button';
import { IconName, VIcon } from '@ui-kit/components/v-icon/v-icon';
import { VModal } from '@ui-kit/components/v-modal/v-modal';
import { VSlider } from '@ui-kit/components/v-slider/v-slider';

// Block title with a settings button revealed on hover; the button opens a block height editor.
@Component({
  selector: 'block-title',
  templateUrl: './block-title.html',
  imports: [VButton, VIcon, VModal, VSlider],
})
export class BlockTitle {
  public readonly titleInput = input.required<string>();
  public readonly heightPxInput = input.required<number>();
  public readonly minHeightPxInput = input.required<number>();
  public readonly maxHeightPxInput = input.required<number>();

  public readonly heightPxOutput = output<number>();

  protected readonly Icon = IconName;
  protected readonly deviceInfoService = inject(DeviceInfoService);
  protected readonly isModalOpen$$ = signal(false);
  protected readonly draftHeightPx$$ = signal(0);

  protected openSettings(): void {
    this.draftHeightPx$$.set(this.heightPxInput());
    this.isModalOpen$$.set(true);
  }

  // The slider emits fractional values while dragging; heights are whole pixels.
  protected onSliderChange(value: number): void {
    this.draftHeightPx$$.set(Math.round(value));
  }

  protected save(): void {
    this.heightPxOutput.emit(this.draftHeightPx$$());
    this.isModalOpen$$.set(false);
  }

  protected cancel(): void {
    this.isModalOpen$$.set(false);
  }
}
