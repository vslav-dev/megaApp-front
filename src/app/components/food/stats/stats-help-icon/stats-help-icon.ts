import { ChangeDetectionStrategy, Component } from '@angular/core';
import { IconName, VIcon } from '@ui-kit/components/v-icon/v-icon';
import { VTooltip } from '@ui-kit/components/v-tooltip/v-tooltip';

@Component({
  selector: 'food-stats-help-icon',
  templateUrl: './stats-help-icon.html',
  imports: [VIcon, VTooltip],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StatsHelpIcon {
  protected readonly Icon = IconName;
}
