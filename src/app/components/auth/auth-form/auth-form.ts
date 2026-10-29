import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { form, FormField, FormRoot, minLength, required } from '@angular/forms/signals';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '@app/services/auth.service';
import { computeLandingRoute } from '@app/services/landing-route';
import { SettingsService } from '@app/services/settings.service';
import { UserCreds } from '@app/shared/types';
import { VButton } from '@ui-kit/components/v-button/v-button';
import { VCard } from '@ui-kit/components/v-card/v-card';
import { VInput } from '@ui-kit/components/v-input/v-input';

const MIN_PASSWORD_LENGTH = 6;

const EMPTY_CREDS: UserCreds = { username: '', password: '' };

@Component({
  selector: 'auth-form',
  templateUrl: './auth-form.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormField, FormRoot, VCard, VInput, VButton],
})
export class AuthForm {
  protected readonly isLoginMode$$ = signal(true);
  protected readonly justRegistered$$ = signal(false);

  protected readonly authService = inject(AuthService);
  private readonly settingsService = inject(SettingsService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  private readonly creds$$ = signal<UserCreds>({ ...EMPTY_CREDS });

  protected readonly authForm = form(
    this.creds$$,
    (path) => {
      required(path.username, { message: 'Поле не должно быть пустым' });
      required(path.password, { message: 'Введите пароль' });
      minLength(path.password, MIN_PASSWORD_LENGTH, {
        message: `Пароль должен быть не менее ${MIN_PASSWORD_LENGTH} символов.`,
      });
    },
    { submission: { action: () => this.submit() } },
  );

  protected toggleMode(): void {
    this.isLoginMode$$.update((value) => !value);
    this.justRegistered$$.set(false);
  }

  protected retryBootstrap(): void {
    void this.authService.retryBootstrap();
  }

  // Runs as the form's submission action: only when the form is valid, with authForm().submitting() true meanwhile.
  private async submit(): Promise<void> {
    const user = this.creds$$();

    try {
      if (this.isLoginMode$$()) {
        await this.authService.login(user);
        await this.settingsService.ensureReady();
        this.authForm().reset({ ...EMPTY_CREDS });
        await this.router.navigateByUrl(this.resolveLandingUrl());
      } else {
        await this.authService.register(user);
        this.authForm().reset({ ...EMPTY_CREDS });
        this.isLoginMode$$.set(true);
        this.justRegistered$$.set(true);
      }
    } catch (error) {
      console.log(error);
    }
  }

  private resolveLandingUrl(): string {
    const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl');
    if (returnUrl && returnUrl.startsWith('/') && !returnUrl.startsWith('/auth')) {
      return returnUrl;
    }

    return computeLandingRoute(this.settingsService.settings$$());
  }
}
