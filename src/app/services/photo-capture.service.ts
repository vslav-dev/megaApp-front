import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { TelemetryService } from './telemetry.service';

interface PhotoAnalysisResult {
  result: boolean;
  data?: {
    id: number;
    name: string;
    kcals: number;
    protein: number;
    fat: number;
    carbs: number;
    fiber: number;
    description: string;
  } | null;
  error?: string;
}

@Injectable({
  providedIn: 'root',
})
export class PhotoCaptureService {
  private readonly http: HttpClient = inject(HttpClient);
  private readonly telemetry = inject(TelemetryService);

  public async analyzeImage(file: File): Promise<PhotoAnalysisResult> {
    const startedAt = performance.now();
    try {
      const formData = new FormData();
      formData.append('image', file);

      const response = await firstValueFrom(this.http.post<PhotoAnalysisResult>('/api/food/analyze-image', formData));

      this.telemetry.record(
        'food.photo_analysis',
        performance.now() - startedAt,
        {
          imageBytes: file.size,
          accepted: response.result,
        },
        response.result ? 'success' : 'error',
      );
      return response;
    } catch (error) {
      console.error('Error analyzing image:', error);
      this.telemetry.record('food.photo_analysis', performance.now() - startedAt, { imageBytes: file.size }, 'error');
      return {
        result: false,
        error: 'Failed to analyze image',
      };
    }
  }

  public async selectFromGallery(): Promise<File | null> {
    return new Promise((resolve) => {
      const input = this.createFileInput();

      input.onchange = (event) => {
        const file = (event.target as HTMLInputElement).files?.[0];
        resolve(file || null);
      };

      input.oncancel = () => {
        resolve(null);
      };

      input.click();
    });
  }

  private createFileInput(): HTMLInputElement {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.capture = 'environment';
    return input;
  }
}
