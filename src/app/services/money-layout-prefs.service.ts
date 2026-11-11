import { Service, WritableSignal } from '@angular/core';
import { persistedSignal } from '@app/services/settings/persisted-signal';

export const MIN_MONEY_CHART_HEIGHT_PX = 120;
export const MAX_MONEY_CHART_HEIGHT_PX = 800;

export const MIN_TRANSACTIONS_LIST_HEIGHT_PX = 300;
export const MAX_TRANSACTIONS_LIST_HEIGHT_PX = 1600;

// Local-only (per user, per browser) block heights of the money screen.
@Service()
export class MoneyLayoutPrefsService {
  public readonly expenseChartHeightPx$$: WritableSignal<number> = persistedSignal(
    'money_expense_chart_height_px',
    300,
  );

  public readonly incomeChartHeightPx$$: WritableSignal<number> = persistedSignal(
    'money_income_chart_height_px',
    190,
  );

  public readonly balancesChartHeightPx$$: WritableSignal<number> = persistedSignal(
    'money_balances_chart_height_px',
    190,
  );

  public readonly transactionsListHeightPx$$: WritableSignal<number> = persistedSignal(
    'money_transactions_list_height_px',
    893,
  );
}
