import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MoneyService } from '@app/services/money.service';
import { DefaultModal } from '@app/shared/components/default-modal/default-modal';
import { FormModal } from '@app/shared/components/form-modal/form-modal';
import { Account, AccountKind, Asset, AssetType, Transaction, TransactionKind } from '@app/shared/types';
import { VButton } from '@ui-kit/components/v-button/v-button';
import { VCard } from '@ui-kit/components/v-card/v-card';
import { VCheckbox } from '@ui-kit/components/v-checkbox/v-checkbox';
import { IconName, VIcon } from '@ui-kit/components/v-icon/v-icon';
import { VInput } from '@ui-kit/components/v-input/v-input';
import { VToggle } from '@ui-kit/components/v-toggle/v-toggle';
import { ICON_BUTTON } from '../money.const';

interface OpenedPosition {
  accountId: number;
  accountTitle: string;
  assetId: number;
  assetTitle: string;
  assetTicker: string;
  openedAtISO: string;
  openQuantity: number;
}

interface OpenedPositionGroup {
  accountId: number;
  accountTitle: string;
  positions: OpenedPosition[];
}

interface AssetGroup {
  title: string;
  assets: Asset[];
}

@Component({
  selector: 'assets-list',
  templateUrl: './assets-list.html',
  imports: [FormsModule, DefaultModal, FormModal, VButton, VCard, VIcon, VInput, VToggle, VCheckbox],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AssetsList {
  protected readonly Icon = IconName;
  protected readonly iconButton = ICON_BUTTON;

  private readonly moneyService = inject(MoneyService);

  protected readonly assets$$ = computed(() => this.moneyService.assets$$());
  protected readonly assetGroups$$ = computed(() => this.buildAssetGroups());
  protected readonly openedPositions$$ = computed(() => this.buildOpenedPositions());
  protected readonly openedPositionGroups$$ = computed(() => this.buildOpenedPositionGroups());

  private readonly accounts$$ = computed(() => this.moneyService.accounts$$());
  protected readonly brokerageAccounts$$ = computed(() =>
    this.accounts$$().filter(
      (account) => account.kind === AccountKind.BROKERAGE || account.kind === AccountKind.CRYPTO,
    ),
  );
  private readonly transactions$$ = computed(() => this.moneyService.transactions$$());

  protected readonly showForm$$ = signal(false);
  protected readonly editingAsset$$ = signal<Asset | null>(null);
  protected readonly title$$ = signal('');
  protected readonly ticker$$ = signal('');
  protected readonly type$$ = signal<AssetType>(AssetType.STOCK);
  protected readonly selectedAccountIds$$ = signal<number[]>([]);
  protected readonly suspendedSince$$ = signal('');
  protected readonly suspendedUntil$$ = signal('');
  protected readonly isSuspended$$ = signal(false);
  protected readonly isDeleteConfirmOpen$$ = signal(false);

  private readonly pendingDeleteId$$ = signal<number | null>(null);

  protected showCreateForm(): void {
    this.editingAsset$$.set(null);
    this.resetForm();
    this.showForm$$.set(true);
  }

  protected editAsset(asset: Asset): void {
    this.editingAsset$$.set(asset);
    this.fillForm(asset);
    this.showForm$$.set(true);
  }

  protected async saveAsset(): Promise<void> {
    if (!this.title$$() || !this.ticker$$() || !this.type$$() || this.selectedAccountIds$$().length === 0) return;

    const assetData: Asset = {
      title: this.title$$(),
      ticker: this.ticker$$(),
      type: this.type$$(),
      accountIds: this.selectedAccountIds$$(),
      suspendedSince: this.suspendedSince$$() || null,
      suspendedUntil: this.suspendedUntil$$() || null,
    };

    const currentAsset = this.editingAsset$$();
    if (currentAsset?.id) {
      assetData.id = currentAsset.id;
      if (await this.moneyService.updateAsset(assetData)) {
        this.onSaved();
      }
      return;
    }

    if (await this.moneyService.createAsset(assetData)) {
      this.onSaved();
    }
  }

  protected deleteAsset(id: number): void {
    if (!this.canDeleteAsset(id)) return;
    this.openConfirmationModal(id);
  }

  private openConfirmationModal(id: number): void {
    this.pendingDeleteId$$.set(id);
    this.isDeleteConfirmOpen$$.set(true);
  }

  protected closeConfirmationModal(): void {
    this.isDeleteConfirmOpen$$.set(false);
    this.pendingDeleteId$$.set(null);
  }

  protected onDeleteConfirmed(): void {
    const id = this.pendingDeleteId$$();
    this.isDeleteConfirmOpen$$.set(false);
    this.pendingDeleteId$$.set(null);
    if (!id) return;
    if (!this.canDeleteAsset(id)) return;
    void this.moneyService.deleteAsset(id);
  }

  protected onSaved(): void {
    this.showForm$$.set(false);
    this.editingAsset$$.set(null);
    this.resetForm();
  }

  protected onCancelled(): void {
    this.showForm$$.set(false);
    this.editingAsset$$.set(null);
    this.resetForm();
  }

  protected isEditing(): boolean {
    return Boolean(this.editingAsset$$()?.id);
  }

  protected typeToggleItems(): { id: string; label: string }[] {
    return [
      { id: AssetType.STOCK, label: 'Stock' },
      { id: AssetType.BOND, label: 'Bond' },
      { id: AssetType.CRYPTO, label: 'Crypto' },
    ];
  }

  protected typeToggleValue(): string[] {
    return [this.type$$()];
  }

  protected onTypeToggleChange(value: string[]): void {
    const nextType = value[0] as AssetType | undefined;
    this.type$$.set(nextType ?? AssetType.STOCK);
  }

  protected getAssetTypeLabel(type: AssetType): string {
    switch (type) {
      case AssetType.STOCK:
        return 'Stock';
      case AssetType.BOND:
        return 'Bond';
      case AssetType.CRYPTO:
        return 'Crypto';
      default:
        return type;
    }
  }

  protected getAccountTitle(accountId: number): string {
    const account = this.accounts$$().find((item) => item.id === accountId);
    return account?.title ?? `Account #${accountId}`;
  }

  protected getAssetAccountsLabel(asset: Asset): string {
    return asset.accountIds.map((accountId) => this.getAccountTitle(accountId)).join(', ');
  }

  protected isAccountSelected(accountId: number): boolean {
    return this.selectedAccountIds$$().includes(accountId);
  }

  protected onAccountSelectionChange(accountId: number, isSelected: boolean): void {
    const current = this.selectedAccountIds$$();
    if (isSelected) {
      if (current.includes(accountId)) return;
      this.selectedAccountIds$$.set([...current, accountId].sort((first, second) => first - second));
      return;
    }

    this.selectedAccountIds$$.set(current.filter((currentAccountId) => currentAccountId !== accountId));
  }

  protected onSuspendedCheckboxChange(checked: boolean): void {
    this.isSuspended$$.set(checked);
    if (!checked) {
      this.suspendedSince$$.set('');
      this.suspendedUntil$$.set('');
    }
  }

  protected canDeleteAsset(assetId: number): boolean {
    return !this.transactions$$().some((transaction: Transaction) =>
      this.isAssetLinkedToTransaction(assetId, transaction),
    );
  }

  private isAssetLinkedToTransaction(assetId: number, transaction: Transaction): boolean {
    const detailsJSON = transaction.detailsJSON;
    if (!detailsJSON) return false;

    let parsed: any = detailsJSON;
    if (typeof detailsJSON === 'string') {
      try {
        parsed = JSON.parse(detailsJSON);
      } catch {
        return false;
      }
    }

    return Number(parsed?.assetId) === Number(assetId);
  }

  private fillForm(asset: Asset): void {
    this.title$$.set(asset.title);
    this.ticker$$.set(asset.ticker);
    this.type$$.set(asset.type);
    this.selectedAccountIds$$.set([...asset.accountIds].sort((first, second) => first - second));
    this.suspendedSince$$.set(asset.suspendedSince ?? '');
    this.suspendedUntil$$.set(asset.suspendedUntil ?? '');
    this.isSuspended$$.set(!!asset.suspendedSince);
  }

  private resetForm(): void {
    this.title$$.set('');
    this.ticker$$.set('');
    this.type$$.set(AssetType.STOCK);
    this.selectedAccountIds$$.set([]);
    this.isSuspended$$.set(false);
    this.suspendedSince$$.set('');
    this.suspendedUntil$$.set('');
  }

  protected formatOpenedDate(dateISO: string): string {
    const date = new Date(dateISO + 'T00:00:00');
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}.${month}.${year}`;
  }

  protected formatQuantity(quantity: number): string {
    return new Intl.NumberFormat('ru-RU', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 8,
    }).format(quantity);
  }

  private buildOpenedPositions(): OpenedPosition[] {
    const accountsById = new Map<number, Account>(this.accounts$$().map((account) => [account.id!, account]));
    const assetsById = new Map<number, Asset>(this.assets$$().map((asset) => [asset.id!, asset]));

    const trades = this.transactions$$()
      .filter((transaction) => {
        return transaction.kind === TransactionKind.INVEST_BUY || transaction.kind === TransactionKind.INVEST_SELL;
      })
      .sort((first, second) => {
        const dateCompare = first.dateISO.localeCompare(second.dateISO);
        if (dateCompare !== 0) return dateCompare;
        return (first.id ?? 0) - (second.id ?? 0);
      });

    const stateByKey = new Map<
      string,
      { accountId: number; assetId: number; openedAtISO: string | null; quantity: number }
    >();

    trades.forEach((trade) => {
      const details = this.parseDetails(trade.detailsJSON);
      const assetId = this.toPositiveNumber(details?.assetId);
      const quantity = this.toPositiveNumber(details?.quantity);

      if (assetId == null || quantity == null) return;

      const key = `${trade.accountId}:${assetId}`;
      const current = stateByKey.get(key) ?? {
        accountId: trade.accountId,
        assetId,
        openedAtISO: null,
        quantity: 0,
      };

      if (trade.kind === TransactionKind.INVEST_BUY) {
        if (current.quantity <= 0) {
          current.openedAtISO = trade.dateISO;
        }
        current.quantity += quantity;
      }

      if (trade.kind === TransactionKind.INVEST_SELL) {
        current.quantity -= quantity;
        if (current.quantity < 0) {
          const asset = assetsById.get(assetId);
          console.log(
            `[Money] Warning: negative open quantity detected for ${asset?.ticker ?? `asset#${assetId}`} on account ${trade.accountId}.`,
          );
          current.quantity = 0;
          current.openedAtISO = null;
        }

        if (current.quantity === 0) {
          current.quantity = 0;
          current.openedAtISO = null;
        }
      }

      stateByKey.set(key, current);
    });

    return Array.from(stateByKey.values())
      .filter((item) => item.quantity > 0 && item.openedAtISO)
      .map((item) => {
        const account = accountsById.get(item.accountId);
        const asset = assetsById.get(item.assetId);

        return {
          accountId: item.accountId,
          accountTitle: account?.title ?? `Account #${item.accountId}`,
          assetId: item.assetId,
          assetTitle: asset?.title ?? `Asset #${item.assetId}`,
          assetTicker: asset?.ticker ?? '',
          openedAtISO: item.openedAtISO!,
          openQuantity: item.quantity,
        };
      })
      .sort((first, second) => first.openedAtISO.localeCompare(second.openedAtISO));
  }

  private buildOpenedPositionGroups(): OpenedPositionGroup[] {
    const grouped = new Map<number, OpenedPositionGroup>();

    this.openedPositions$$().forEach((position) => {
      const current = grouped.get(position.accountId) ?? {
        accountId: position.accountId,
        accountTitle: position.accountTitle,
        positions: [],
      };

      current.positions.push(position);
      grouped.set(position.accountId, current);
    });

    return Array.from(grouped.values()).map((group) => ({
      ...group,
      positions: group.positions.sort((first, second) => first.openedAtISO.localeCompare(second.openedAtISO)),
    }));
  }

  private buildAssetGroups(): AssetGroup[] {
    const allAssets = this.assets$$();
    const groups: AssetGroup[] = [];

    const otherAssets = allAssets
      .filter((a) => a.type !== AssetType.CRYPTO)
      .sort((first, second) => first.title.localeCompare(second.title));

    const cryptoAssets = allAssets
      .filter((a) => a.type === AssetType.CRYPTO)
      .sort((first, second) => first.title.localeCompare(second.title));

    if (otherAssets.length > 0) groups.push({ title: 'Assets', assets: otherAssets });
    if (cryptoAssets.length > 0) groups.push({ title: 'Crypto', assets: cryptoAssets });

    return groups;
  }

  private parseDetails(detailsJSON: any): any {
    if (!detailsJSON) return null;

    if (typeof detailsJSON === 'object') {
      return detailsJSON;
    }

    if (typeof detailsJSON === 'string') {
      try {
        return JSON.parse(detailsJSON);
      } catch {
        return null;
      }
    }

    return null;
  }

  private toPositiveNumber(value: unknown): number | null {
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue) || numberValue <= 0) return null;
    return numberValue;
  }
}
