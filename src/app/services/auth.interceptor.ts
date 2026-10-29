import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { AuthService } from '@app/services/auth.service';
import { NetworkService } from '@app/services/network.service';
import { throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';

const SESSION_ENDPOINT = '/api/auth/session';

export const authInterceptor: HttpInterceptorFn = (request, next) => {
  const authService = inject(AuthService);
  const preparedRequest = request.clone({
    setHeaders: { 'X-Client-ID': inject(NetworkService).getClientId() },
  });

  return next(preparedRequest).pipe(
    catchError((error: unknown) => {
      if (error instanceof HttpErrorResponse && error.status === 401 && !request.url.includes(SESSION_ENDPOINT)) {
        authService.invalidateSession();
      }
      return throwError(() => error);
    }),
  );
};
