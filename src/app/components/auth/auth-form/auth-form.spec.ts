import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '@app/services/auth.service';
import { SettingsService } from '@app/services/settings.service';
import { AuthForm } from './auth-form';

const RETURN_URL = '/money';

function setup() {
  const authFake = {
    bootstrapError$$: signal(false),
    retryBootstrap: vi.fn(),
    login: vi.fn().mockResolvedValue(undefined),
    register: vi.fn().mockResolvedValue(undefined),
  };
  const settingsFake = { ensureReady: vi.fn().mockResolvedValue(undefined), settings$$: signal({}) };
  const routerFake = { navigateByUrl: vi.fn().mockResolvedValue(true) };
  const routeFake = { snapshot: { queryParamMap: { get: () => RETURN_URL } } };

  TestBed.configureTestingModule({
    providers: [
      { provide: AuthService, useValue: authFake },
      { provide: SettingsService, useValue: settingsFake },
      { provide: Router, useValue: routerFake },
      { provide: ActivatedRoute, useValue: routeFake },
    ],
  });

  const fixture = TestBed.createComponent(AuthForm);
  return { fixture, authFake, routerFake };
}

async function typeInto(fixture: ComponentFixture<AuthForm>, index: number, text: string): Promise<void> {
  const input: HTMLInputElement = fixture.nativeElement.querySelectorAll('input')[index];
  input.value = text;
  input.dispatchEvent(new Event('input'));
  await fixture.whenStable();
}

async function submit(fixture: ComponentFixture<AuthForm>): Promise<void> {
  fixture.nativeElement.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }));
  await fixture.whenStable();
}

function submitButton(fixture: ComponentFixture<AuthForm>): HTMLButtonElement {
  return fixture.nativeElement.querySelector('button[type="submit"]');
}

describe('AuthForm', () => {
  it('keeps the submit button disabled until both fields are valid', async () => {
    const { fixture } = setup();
    await fixture.whenStable();
    expect(submitButton(fixture).disabled).toBe(true);

    await typeInto(fixture, 0, 'user');
    await typeInto(fixture, 1, '12345');
    expect(submitButton(fixture).disabled).toBe(true);

    await typeInto(fixture, 1, '123456');
    expect(submitButton(fixture).disabled).toBe(false);
  });

  it('shows the validator message once the user has typed an invalid password', async () => {
    const { fixture } = setup();
    await fixture.whenStable();

    await typeInto(fixture, 1, '123');

    const message = fixture.nativeElement.querySelector('.error-message').textContent.trim();
    expect(message).toBe('Пароль должен быть не менее 6 символов.');
  });

  it('does not log in an invalid form', async () => {
    const { fixture, authFake } = setup();
    await fixture.whenStable();
    await typeInto(fixture, 0, 'user');

    await submit(fixture);

    expect(authFake.login).not.toHaveBeenCalled();
  });

  it('logs in with the typed credentials, clears the form and goes to the return url', async () => {
    const { fixture, authFake, routerFake } = setup();
    await fixture.whenStable();
    await typeInto(fixture, 0, 'user');
    await typeInto(fixture, 1, '123456');

    await submit(fixture);

    expect(authFake.login).toHaveBeenCalledWith({ username: 'user', password: '123456' });
    expect(routerFake.navigateByUrl).toHaveBeenCalledWith(RETURN_URL);
    const inputs: HTMLInputElement[] = Array.from(fixture.nativeElement.querySelectorAll('input'));
    expect(inputs.map((input) => input.value)).toEqual(['', '']);
  });
});
