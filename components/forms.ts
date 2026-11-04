/*
 * Save buttons never rely on form submission (rule kept from the old page):
 * the button checks the form with reportValidity() and then calls the handler directly.
 * Enter in a text box presses the save button.
 */
import type { KeyboardEvent, RefObject } from 'react';

export function runIfValid(form: RefObject<HTMLFormElement | null>, handler: () => void, onError: (text: string) => void): void {
  const f = form.current;
  if (f && f.reportValidity && !f.reportValidity()) return;
  try { handler(); } catch (err) { onError('Something went wrong: ' + (err as Error).message); }
}

export function enterPresses(button: RefObject<HTMLButtonElement | null>) {
  return function (e: KeyboardEvent<HTMLFormElement>) {
    const t = e.target as HTMLInputElement;
    if (e.key === 'Enter' && t.tagName === 'INPUT' && t.type !== 'checkbox') {
      e.preventDefault();
      if (button.current) button.current.click();
    }
  };
}

export type Msg = { text: string; good?: boolean };
export function msgClass(m: Msg): string { return 'msg' + (m.good ? ' good' : ''); }
