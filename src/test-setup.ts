// jsdom has no top layer: stub the dialog and popover APIs the ui-kit relies on.
// A shown popover is marked with `data-popover-open` so specs can assert on it.

if (!HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement): void {
    this.setAttribute('open', '');
  };
}

if (!HTMLDialogElement.prototype.close) {
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement): void {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
}

if (!HTMLElement.prototype.showPopover) {
  HTMLElement.prototype.showPopover = function (this: HTMLElement): void {
    this.setAttribute('data-popover-open', '');
  };
}

if (!HTMLElement.prototype.hidePopover) {
  HTMLElement.prototype.hidePopover = function (this: HTMLElement): void {
    this.removeAttribute('data-popover-open');
  };
}
