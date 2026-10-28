import { HttpErrorResponse, HttpEvent, HttpHandler, HttpInterceptor, HttpRequest } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { AuthService } from '@app/services/auth.service';
import { NetworkService } from '@app/services/network.service';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';

const SESSION_ENDPOINT = '/api/auth/session';

@Injectable()
export class AuthInterceptor implements HttpInterceptor {
  private readonly networkService = inject(NetworkService);
  private readonly authService = inject(AuthService);

  public intercept(request: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
    const preparedRequest = request.clone({
      setHeaders: { 'X-Client-ID': this.networkService.getClientId() },
    });

    return next.handle(preparedRequest).pipe(
      catchError((error: unknown) => {
        if (error instanceof HttpErrorResponse && error.status === 401 && !request.url.includes(SESSION_ENDPOINT)) {
          this.authService.invalidateSession();
        }
        return throwError(() => error);
      }),
    );
  }
}
