import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '@app/services/auth.service';

export const adminOnlyGuard: CanActivateFn = async () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  await authService.ensureBootstrapped();

  if (authService.isAdmin$$()) {
    return true;
  }

  return router.createUrlTree(['/']);
};
