import { Component, input } from '@angular/core';

// Wraps a toolbar control (e.g. a v-button) that can grow extra companion
// controls (an input, a toggle, ...) when its own state is active. When
// isActive() is true, vertical dividers frame the whole group so it reads
// as one unit instead of blending into the surrounding toolbar buttons.
@Component({
  selector: 'toolbar-group',
  templateUrl: './toolbar-group.html',
  styleUrl: './toolbar-group.css',
  host: {
    '[class.active]': 'isActive()',
  },
})
export class ToolbarGroup {
  public readonly isActive = input<boolean>(false);
}
