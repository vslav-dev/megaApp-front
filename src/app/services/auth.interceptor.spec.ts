import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { authInterceptor } from '@app/services/auth.interceptor';
import { AuthService } from '@app/services/auth.service';
import { NetworkService } from '@app/services/network.service';

function setup() {
  const authServiceFake: Pick<AuthService, 'invalidateSession'> = { invalidateSession: vi.fn() };
  const networkServiceFake: Pick<NetworkService, 'getClientId'> = { getClientId: vi.fn(() => 'client-1') };

  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(withInterceptors([authInterceptor])),
      provideHttpClientTesting(),
      { provide: AuthService, useValue: authServiceFake },
      { provide: NetworkService, useValue: networkServiceFake },
    ],
  });

  return {
    http: TestBed.inject(HttpClient),
    httpMock: TestBed.inject(HttpTestingController),
    authServiceFake,
  };
}

describe('authInterceptor', () => {
  it('adds the client id header to every request', () => {
    const { http, httpMock } = setup();

    http.get('/api/anything').subscribe();

    const request = httpMock.expectOne('/api/anything');
    expect(request.request.headers.get('X-Client-ID')).toBe('client-1');
    request.flush({});
  });

  it('invalidates the session on 401 and still propagates the error', () => {
    const { http, httpMock, authServiceFake } = setup();
    const onError = vi.fn();

    http.get('/api/anything').subscribe({ error: onError });
    httpMock.expectOne('/api/anything').flush({}, { status: 401, statusText: 'Unauthorized' });

    expect(authServiceFake.invalidateSession).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('does not invalidate the session on 401 from the session endpoint', () => {
    const { http, httpMock, authServiceFake } = setup();

    http.get('/api/auth/session').subscribe({ error: () => undefined });
    httpMock.expectOne('/api/auth/session').flush({}, { status: 401, statusText: 'Unauthorized' });

    expect(authServiceFake.invalidateSession).not.toHaveBeenCalled();
  });

  it('does not invalidate the session on other error statuses', () => {
    const { http, httpMock, authServiceFake } = setup();

    http.get('/api/anything').subscribe({ error: () => undefined });
    httpMock.expectOne('/api/anything').flush({}, { status: 500, statusText: 'Server Error' });

    expect(authServiceFake.invalidateSession).not.toHaveBeenCalled();
  });
});
