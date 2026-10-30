import {
  Component,
  effect,
  ElementRef,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { VButton } from '@ui-kit/components/v-button/v-button';
import { VInput } from '@ui-kit/components/v-input/v-input';
import { MoneyService } from '@app/services/money.service';
import { Organization } from '@app/shared/types';

@Component({
  selector: 'organization-form',
  templateUrl: './organization-form.html',
  imports: [VButton, VInput],
})
export class OrganizationForm {
  public readonly organizationInput = input<Organization | null>(null);

  public readonly savedOutput = output<void>();
  public readonly cancelledOutput = output<void>();

  private readonly moneyService = inject(MoneyService);
  private readonly fileInputElem = viewChild<ElementRef<HTMLInputElement>>('fileInput');

  protected readonly title$$ = signal('');
  protected readonly logoBase64$$ = signal<string | null>(null);

  public constructor() {
    effect(() => {
      const current = this.organizationInput();
      if (current) {
        this.fillForm(current);
      } else {
        this.resetForm();
      }
    });
  }

  private fillForm(organization: Organization): void {
    this.title$$.set(organization.title);
    this.logoBase64$$.set(organization.logoBase64 ?? null);
  }

  private resetForm(): void {
    this.title$$.set('');
    this.logoBase64$$.set(null);
  }

  protected onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1] ?? result;
      this.logoBase64$$.set(base64);
    };
    reader.readAsDataURL(file);
  }

  protected triggerFileInput(): void {
    this.fileInputElem()?.nativeElement.click();
  }

  protected clearLogo(): void {
    this.logoBase64$$.set(null);
    const fileInput = this.fileInputElem();
    if (fileInput) {
      fileInput.nativeElement.value = '';
    }
  }

  protected getLogoSrc(): string | null {
    const logo = this.logoBase64$$();
    if (!logo) return null;
    return `data:image/png;base64,${logo}`;
  }

  protected async save(): Promise<void> {
    if (!this.isFormValid()) return;

    const organizationData: Organization = {
      title: this.title$$(),
      logoBase64: this.logoBase64$$(),
    };

    const current = this.organizationInput();
    if (current?.id) {
      organizationData.id = current.id;
      if (await this.moneyService.updateOrganization(organizationData)) {
        this.savedOutput.emit();
      }
    } else {
      if (await this.moneyService.createOrganization(organizationData)) {
        this.savedOutput.emit();
      }
    }
  }

  protected cancel(): void {
    this.cancelledOutput.emit();
  }

  protected isEditing(): boolean {
    return Boolean(this.organizationInput()?.id);
  }

  protected isFormValid(): boolean {
    return Boolean(this.title$$());
  }
}
