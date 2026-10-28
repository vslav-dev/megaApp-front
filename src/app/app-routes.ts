import { Routes } from '@angular/router';
import { adminOnlyGuard } from '@app/services/admin-only.guard';
import { authGuard } from '@app/services/auth.guard';
import { guestOnlyGuard } from '@app/services/guest-only.guard';
import { isChapterSelected } from '@app/services/is-chapter-selected.guard';
import { rootRedirectGuard } from '@app/services/root-redirect.guard';
import { settingsReadyGuard } from '@app/services/settings-ready.guard';

export const routes: Routes = [
  {
    path: 'auth',
    loadComponent: () => import('@app/components/auth/auth-form/auth-form').then((m) => m.AuthForm),
    canActivate: [guestOnlyGuard],
  },
  {
    path: 'food',
    loadComponent: () => import('@app/components/food/food-screen').then((m) => m.FoodScreen),
    canActivate: [authGuard, settingsReadyGuard, isChapterSelected],
  },
  {
    path: 'money',
    loadComponent: () => import('@app/components/money/money-screen').then((m) => m.MoneyScreen),
    canActivate: [authGuard, settingsReadyGuard, isChapterSelected],
  },
  {
    path: 'settings',
    loadComponent: () => import('@app/components/settings/settings').then((m) => m.Settings),
    canActivate: [authGuard, settingsReadyGuard],
  },
  {
    path: 'metrics',
    loadComponent: () =>
      import('@app/components/metrics/metrics-dashboard/metrics-dashboard').then((m) => m.MetricsDashboard),
    canActivate: [authGuard, settingsReadyGuard, adminOnlyGuard],
  },
  { path: '', pathMatch: 'full', canActivate: [rootRedirectGuard], children: [] },
  { path: '**', canActivate: [rootRedirectGuard], children: [] },
];
