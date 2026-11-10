import { Service } from '@angular/core';
import { fromEvent, Observable } from 'rxjs';
import { filter } from 'rxjs/operators';

export interface KeyboardShortcut {
  code: string;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  preventDefault?: boolean;
  allowRepeat?: boolean;
  allowInEditable?: boolean;
  when?: () => boolean;
}

@Service()
export class KeyboardService {
  private readonly keyboardEvents$ = fromEvent<KeyboardEvent>(document, 'keydown');

  public shortcut$(shortcut: KeyboardShortcut): Observable<KeyboardEvent> {
    return this.keyboardEvents$.pipe(filter((event) => this.matchesShortcut(event, shortcut)));
  }

  private matchesShortcut(event: KeyboardEvent, shortcut: KeyboardShortcut): boolean {
    if (event.defaultPrevented) return false;
    if (shortcut.when && !shortcut.when()) return false;
    if (!shortcut.allowRepeat && event.repeat) return false;
    if (!shortcut.allowInEditable && this.isEditableTarget(event.target)) return false;

    const matches =
      event.code === shortcut.code &&
      event.altKey === Boolean(shortcut.altKey) &&
      event.ctrlKey === Boolean(shortcut.ctrlKey) &&
      event.metaKey === Boolean(shortcut.metaKey) &&
      event.shiftKey === Boolean(shortcut.shiftKey);

    if (!matches) return false;
    if (shortcut.preventDefault !== false) {
      event.preventDefault();
    }
    return true;
  }

  private isEditableTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;

    const editableParent = target.closest('[contenteditable="true"]');
    if (editableParent) return true;

    const tagName = target.tagName.toLowerCase();
    return tagName === 'input' || tagName === 'textarea' || tagName === 'select';
  }
}
