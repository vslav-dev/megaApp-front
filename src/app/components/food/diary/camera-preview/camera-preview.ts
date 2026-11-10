import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { FoodAddModalService } from '@app/services/food/food-add-modal.service';
import { PhotoCaptureService } from '@app/services/photo-capture.service';
import { TelemetryService } from '@app/services/telemetry.service';
import { CapturedPhoto } from '@app/shared/types';
import { VButton } from '@ui-kit/components/v-button/v-button';
import { IconName, VIcon } from '@ui-kit/components/v-icon/v-icon';

@Component({
  selector: 'camera-preview',
  templateUrl: './camera-preview.html',
  imports: [VIcon, VButton],
})
export class CameraPreview implements AfterViewInit, OnDestroy {
  // Rendered only while the live camera is shown (not for an error or a taken photo), hence optional.
  private readonly videoElem = viewChild<ElementRef<HTMLVideoElement>>('video');
  private readonly canvasElem = viewChild<ElementRef<HTMLCanvasElement>>('canvas');

  protected readonly isLoading$$ = signal(false);
  protected readonly photoDataUrl$$ = signal<string>('');
  protected readonly error$$ = signal<string>('');
  protected readonly isConfirmPhotoTemporarilyDisabled$$ = signal(false);

  private readonly capturedFile$$ = signal<File | null>(null);
  protected readonly hasPhoto$$ = computed(() => this.capturedFile$$() !== null);

  protected readonly Icon = IconName;

  private cameraStream: MediaStream | null = null;

  private readonly photoCaptureService = inject(PhotoCaptureService);
  private readonly telemetry = inject(TelemetryService);
  private readonly foodAddModalService = inject(FoodAddModalService);

  private readonly confirmPhotoButtonCooldownEffect$$ = effect(() => {
    if (this.hasPhoto$$()) {
      this.isConfirmPhotoTemporarilyDisabled$$.set(true);
      setTimeout(() => this.isConfirmPhotoTemporarilyDisabled$$.set(false), 500);
    }
  });

  public ngAfterViewInit(): void {
    void this.startCamera();
  }

  public ngOnDestroy(): void {
    this.stopCamera();
  }

  public async startCamera(): Promise<void> {
    const startedAt = performance.now();
    try {
      this.isLoading$$.set(true);
      this.error$$.set('');

      this.cameraStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment',
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });

      const video = this.videoElem()?.nativeElement;
      if (video) {
        video.srcObject = this.cameraStream;
        await video.play();
      }
      this.telemetry.record('food.photo_camera_start', performance.now() - startedAt);
    } catch (error) {
      console.error('Error accessing camera:', error);
      this.error$$.set('Не удалось получить доступ к камере. Проверьте разрешения.');
      this.telemetry.record('food.photo_camera_start', performance.now() - startedAt, undefined, 'error');
    } finally {
      this.isLoading$$.set(false);
    }
  }

  public takePhoto(): void {
    const startedAt = performance.now();
    const video = this.videoElem()?.nativeElement;
    const canvas = this.canvasElem()?.nativeElement;
    if (!video || !canvas) {
      return;
    }

    const ctx = canvas.getContext('2d');

    if (!ctx) {
      this.error$$.set('Ошибка создания изображения');
      return;
    }

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    ctx.drawImage(video, 0, 0);

    canvas.toBlob(
      (blob) => {
        if (blob) {
          this.capturedFile$$.set(new File([blob], 'photo.jpg', { type: 'image/jpeg' }));
          this.photoDataUrl$$.set(canvas.toDataURL('image/jpeg', 0.8));
          this.stopCamera();
          this.telemetry.record('food.photo_capture', performance.now() - startedAt, {
            imageBytes: blob.size,
          });
        } else {
          this.error$$.set('Ошибка создания фото');
          this.telemetry.record('food.photo_capture', performance.now() - startedAt, undefined, 'error');
        }
      },
      'image/jpeg',
      0.8,
    );
  }

  public async confirmPhoto(): Promise<void> {
    const capturedFile = this.capturedFile$$();
    if (capturedFile && this.photoDataUrl$$()) {
      const capturedPhoto: CapturedPhoto = {
        file: capturedFile,
        dataUrl: this.photoDataUrl$$(),
      };

      this.foodAddModalService.submitSuccess();

      try {
        const result = await this.photoCaptureService.analyzeImage(capturedPhoto.file);

        if (result?.result && result.data) {
          console.log('Photo analysis result:', result.data);
        } else if (result?.error) {
          console.error('Photo analysis failed:', result.error);
        } else {
          console.error('Photo analysis returned no results');
        }
      } catch (error) {
        console.error('Error during photo analysis:', error);
      }
    }
  }

  public retakePhoto(): void {
    this.photoDataUrl$$.set('');
    this.capturedFile$$.set(null);
    void this.startCamera();
  }

  public cancel(): void {
    this.foodAddModalService.goBackToSearch();
  }

  private stopCamera(): void {
    if (this.cameraStream) {
      this.cameraStream.getTracks().forEach((track) => track.stop());
      this.cameraStream = null;
    }
  }
}
