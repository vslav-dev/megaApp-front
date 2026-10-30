import { Component, OnInit, computed, effect, inject, signal } from '@angular/core';
import { VButton } from '@ui-kit/components/v-button/v-button';
import { VCard } from '@ui-kit/components/v-card/v-card';
import { VExpand } from '@ui-kit/components/v-expand/v-expand';
import { IconName, VIcon } from '@ui-kit/components/v-icon/v-icon';
import { VSlider, VSliderRangeValue } from '@ui-kit/components/v-slider/v-slider';
import { VToggleItem } from '@ui-kit/components/v-toggle/v-toggle';
import { MoneyComputeService } from '../../services/money-compute.service';
import { MoneyService } from '../../services/money.service';
import { TelemetryService } from '../../services/telemetry.service';
import { parseIsoParts } from '@app/shared/utils';
import { BalanceChartData } from '../../shared/types';
import { AccountsBalance } from './accounts-balance/accounts-balance';
import { AccountsList } from './accounts-list/accounts-list';
import { AssetsList } from './assets-list/assets-list';
import { BalancesChart } from './balances-chart/balances-chart';
import { CategoriesList } from './categories-list/categories-list';
import { CurrenciesList } from './currencies-list/currencies-list';
import { ExpenseChart } from './expense-chart/expense-chart';
import { IncomeChart } from './income-chart/income-chart';
import { OrganizationsList } from './organizations-list/organizations-list';
import { TransactionsList } from './transactions-list/transactions-list';

const MoneyTab = {
  Setup: 'setup',
  Categories: 'categories',
  Assets: 'assets',
  Transactions: 'transactions',
} as const;

type MoneyTab = (typeof MoneyTab)[keyof typeof MoneyTab];

@Component({
  selector: 'money-screen',
  templateUrl: './money-screen.html',
  imports: [
    CurrenciesList,
    CategoriesList,
    AccountsList,
    AccountsBalance,
    OrganizationsList,
    AssetsList,
    TransactionsList,
    BalancesChart,
    ExpenseChart,
    IncomeChart,
    VButton,
    VCard,
    VExpand,
    VIcon,
    VSlider,
  ],
})
export class MoneyScreen implements OnInit {
  protected readonly Icon = IconName;
  protected readonly MoneyTab = MoneyTab;
  protected readonly activeTab$$ = signal<MoneyTab>(MoneyTab.Transactions);

  private readonly moneyService = inject(MoneyService);
  private readonly moneyComputeService = inject(MoneyComputeService);
  private readonly telemetry = inject(TelemetryService);
  private readonly sliderMonthFormatter = new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric' });
  private readonly screenStartedAt = performance.now();
  private screenReadyRecorded = false;

  protected readonly isChartDataReady$$ = computed(() => this.moneyService.isChartDataReady$$());

  private readonly screenReadyEffect$$ = effect(() => {
    if (!this.isChartDataReady$$() || this.screenReadyRecorded) return;
    this.screenReadyRecorded = true;
    void this.telemetry.recordAfterPaint('money.screen_ready', this.screenStartedAt, {
      tab: this.activeTab$$(),
      transactions: this.moneyService.transactions$$().length,
    });
  });

  protected readonly displayCurrency$$ = computed(() => this.moneyService.displayCurrency$$());
  protected readonly displayCurrencySymbol$$ = computed(() => {
    const currency = this.moneyService.currencies$$().find((c) => c.ticker === this.displayCurrency$$());
    return currency?.symbol ?? '₽';
  });

  protected readonly convertToUnifiedCurrency$$ = computed(() => this.moneyService.convertToUnifiedCurrency$$());
  protected readonly linkTransactionsToCharts$$ = computed(() => this.moneyService.linkTransactionsToCharts$$());

  protected readonly currencyToggleItems: VToggleItem[] = [
    { id: 'RUB', label: '₽' },
    { id: 'KZT', label: '₸' },
    { id: 'USD', label: '$' },
    { id: 'EUR', label: '€' },
  ];

  protected readonly balanceChartData$$ = this.moneyComputeService.balanceChartData$$;
  protected readonly incomeChartData$$ = this.moneyComputeService.incomeChartData$$;
  protected readonly expenseChartData$$ = this.moneyComputeService.expenseChartData$$;

  protected readonly allChartMonths$$ = computed((): string[] => {
    const set = new Set<string>();
    this.balanceChartData$$().dates.forEach((d) => set.add(d.substring(0, 7)));
    this.incomeChartData$$().months.forEach((m) => set.add(m.substring(0, 7)));
    this.expenseChartData$$().monthRows.forEach((r) => set.add(r.period));
    return Array.from(set).sort();
  });

  private readonly rangeStartIdx$$ = computed((): number => {
    const months = this.allChartMonths$$();
    const saved = this.moneyService.chartRangeStart$$();
    if (!saved) return 0;
    const idx = months.indexOf(saved);
    return idx >= 0 ? idx : 0;
  });

  private readonly rangeEndIdx$$ = computed((): number => {
    const months = this.allChartMonths$$();
    const saved = this.moneyService.chartRangeEnd$$();
    if (!saved) return months.length > 0 ? months.length - 1 : 0;
    const idx = months.indexOf(saved);
    return idx >= 0 ? idx : months.length > 0 ? months.length - 1 : 0;
  });

  protected readonly sliderRange$$ = computed((): VSliderRangeValue => [this.rangeStartIdx$$(), this.rangeEndIdx$$()]);

  protected readonly chartRangeSliderMax$$ = computed(() => Math.max(0, this.allChartMonths$$().length - 1));

  protected readonly chartRangeSliderValueList$$ = computed(() => this.allChartMonths$$().map((_, i) => i));

  protected readonly sliderStartLabel$$ = computed((): string =>
    this.formatSliderMonth(this.allChartMonths$$()[this.rangeStartIdx$$()]),
  );

  protected readonly sliderEndLabel$$ = computed((): string =>
    this.formatSliderMonth(this.allChartMonths$$()[this.rangeEndIdx$$()]),
  );

  protected readonly sliderRangeLabel$$ = computed((): string => {
    const total = this.rangeEndIdx$$() - this.rangeStartIdx$$() + 1;
    if (total <= 0) return '';
    const y = Math.floor(total / 12);
    const m = total % 12;
    const parts: string[] = [];
    if (y > 0) parts.push(`${y} yr${y > 1 ? 's' : ''}`);
    if (m > 0) parts.push(`${m} mo`);
    return parts.length > 0 ? parts.join(' ') : '1 mo';
  });

  protected readonly balanceChartDataClipped$$ = computed((): BalanceChartData => {
    const data = this.balanceChartData$$();
    const months = this.allChartMonths$$();
    const startIdx = this.rangeStartIdx$$();
    const endIdx = this.rangeEndIdx$$();
    if (startIdx === 0 && endIdx === months.length - 1) return data;
    const start = months[startIdx];
    const end = months[endIdx];
    if (start === undefined || end === undefined) return { dates: [], totals: [], accountSeries: [] };
    const i0 = data.dates.findIndex((d) => d.substring(0, 7) >= start);
    // Dates ascend, so the last one within the range sits right before the first one past it.
    const firstPastEnd = data.dates.findIndex((d) => d.substring(0, 7) > end);
    const i1 = firstPastEnd === -1 ? data.dates.length - 1 : firstPastEnd - 1;
    if (i0 < 0 || i1 < 0 || i0 > i1) return { dates: [], totals: [], accountSeries: [] };
    return {
      dates: data.dates.slice(i0, i1 + 1),
      totals: data.totals.slice(i0, i1 + 1),
      accountSeries: data.accountSeries.map((s) => ({
        ...s,
        values: s.values.slice(i0, i1 + 1),
        suspendedValues: s.suspendedValues.slice(i0, i1 + 1),
      })),
    };
  });

  protected readonly monthRangeForCharts$$ = computed((): [string, string] | null => {
    const months = this.allChartMonths$$();
    const startIdx = this.rangeStartIdx$$();
    const endIdx = this.rangeEndIdx$$();
    const start = months[startIdx];
    const end = months[endIdx];
    if (start === undefined || end === undefined || (startIdx === 0 && endIdx === months.length - 1)) return null;
    return [start, end];
  });

  protected onChartRangeChange(range: VSliderRangeValue): void {
    const startedAt = performance.now();
    const months = this.allChartMonths$$();
    const [startIdx, endIdx] = range;
    const maxIdx = months.length - 1;
    this.moneyService.setChartRange(
      startIdx <= 0 ? null : (months[startIdx] ?? null),
      endIdx >= maxIdx ? null : (months[endIdx] ?? null),
    );
    void this.telemetry.recordAfterPaint('money.range_change', startedAt, { months: endIdx - startIdx + 1 });
  }

  protected setDisplayCurrency(id: string): void {
    if (!id || id === this.moneyService.displayCurrency$$()) return;
    const startedAt = performance.now();
    const previous = this.moneyService.displayCurrency$$();
    this.moneyService.setDisplayCurrency(id);
    void this.telemetry.recordAfterPaint('money.currency_change', startedAt, { from: previous, to: id });
  }

  protected toggleConvertToUnifiedCurrency(): void {
    this.moneyService.setConvertToUnifiedCurrency(!this.convertToUnifiedCurrency$$());
  }

  protected toggleLinkTransactionsToCharts(): void {
    this.moneyService.setLinkTransactionsToCharts(!this.linkTransactionsToCharts$$());
  }

  public ngOnInit(): void {
    this.moneyService.loadData();
  }

  protected setActiveTab(tab: MoneyTab): void {
    const startedAt = performance.now();
    const previous = this.activeTab$$();
    this.activeTab$$.set(tab);
    void this.telemetry.recordAfterPaint('money.tab_change', startedAt, { from: previous, to: tab });
  }

  private formatSliderMonth(ym: string | undefined): string {
    if (!ym) return '';
    const [year, month] = parseIsoParts(ym);
    return this.sliderMonthFormatter.format(new Date(year, month - 1, 1));
  }
}
