import { computed, Injectable, signal } from '@angular/core';
import { fromEvent } from 'rxjs';
import { distinctUntilChanged, map, startWith } from 'rxjs/operators';

interface DeviceInfo {
  isMobile: boolean;
  hasRearCamera: boolean;
  hasFrontCamera: boolean;
  isTouchDevice: boolean;
  platform: 'mobile' | 'tablet' | 'desktop';
}

const SCREEN_MOBILE_BREAKPOINT_PX = 768;
const KEYBOARD_DETECTION_HEIGHT_THRESHOLD_PX = 150;
const KEYBOARD_CLOSE_DEBOUNCE_MS = 150; // don't show buttons between food diary selections

@Injectable({
  providedIn: 'root',
})
export class DeviceInfoService {
  private readonly viewportIsMobile$$ = signal(false);

  // Lets a screen with its own layout logic (e.g. food diary's column-fit grid) decide
  // mobile/desktop for the whole app shell instead of the global viewport breakpoint below.
  // null hands control back to the viewport breakpoint — see setMobileOverride.
  private readonly mobileOverride$$ = signal<boolean | null>(null);

  public readonly isMobileScreen$$ = computed(() => this.mobileOverride$$() ?? this.viewportIsMobile$$());
  public readonly isDesktopScreen$$ = computed(() => !this.isMobileScreen$$());

  public readonly isMobileDevice$$ = computed(() => this.isDeviceMobile());
  public readonly isDesktopDevice$$ = computed(() => !this.isDeviceMobile());

  public readonly hasCameras$$ = computed(() => this.shouldShowCameraButton());

  public readonly isKeyboardOpen$$ = signal(false);

  // Shared by every fixed-position mobile FAB (nav hamburger, food add/toggle buttons) — keyboard
  // opening pushes the viewport up, so FABs slide off-screen rather than floating over the keyboard.
  public readonly shouldHideFabButtons$$ = computed(() => !this.isDesktopScreen$$() && this.isKeyboardOpen$$());

  private deviceInfo: DeviceInfo | null = null;
  private initialViewportHeight: number = 0;
  private keyboardCloseTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.setupResizeListener();
    this.setupKeyboardDetection();
  }

  private setupResizeListener(): void {
    fromEvent(window, 'resize')
      .pipe(
        startWith(null),
        map(() => window.innerWidth < SCREEN_MOBILE_BREAKPOINT_PX),
        distinctUntilChanged(),
      )
      .subscribe((isMobile) => {
        this.viewportIsMobile$$.set(isMobile);
      });
  }

  // isMobile: force mobile/desktop for the whole app shell. null: hand control back to the
  // window.innerWidth breakpoint. Callers must clear their override (pass null) when they stop
  // being relevant (e.g. route leave / ngOnDestroy), or every other screen stays stuck on it.
  public setMobileOverride(isMobile: boolean | null): void {
    this.mobileOverride$$.set(isMobile);
  }

  private setupKeyboardDetection(): void {
    if (typeof window === 'undefined') return;

    const visualViewport = window.visualViewport;
    if (!visualViewport) return;

    this.initialViewportHeight = visualViewport.height;

    const checkKeyboardState = () => {
      const currentHeight = visualViewport.height;
      const heightDifference = this.initialViewportHeight - currentHeight;
      const isOpen = heightDifference > KEYBOARD_DETECTION_HEIGHT_THRESHOLD_PX;

      if (isOpen) {
        if (this.keyboardCloseTimeout) {
          clearTimeout(this.keyboardCloseTimeout);
          this.keyboardCloseTimeout = null;
        }
        this.isKeyboardOpen$$.set(true);
      } else {
        if (this.keyboardCloseTimeout) {
          clearTimeout(this.keyboardCloseTimeout);
        }
        this.keyboardCloseTimeout = setTimeout(() => {
          this.isKeyboardOpen$$.set(false);
          this.keyboardCloseTimeout = null;
        }, KEYBOARD_CLOSE_DEBOUNCE_MS);
      }
    };

    visualViewport.addEventListener('resize', checkKeyboardState);
    visualViewport.addEventListener('scroll', checkKeyboardState);
  }

  public shouldShowCameraButton(): boolean {
    const userAgent = navigator.userAgent.toLowerCase();
    const isLaptop =
      userAgent.includes('macintosh') ||
      userAgent.includes('windows') ||
      (userAgent.includes('linux') && !userAgent.includes('android'));

    const isTouchDevice = this.isTouchDevice();
    if (isLaptop && !isTouchDevice) {
      return false;
    }

    const isMobile = this.isDeviceMobile();
    const hasMediaDevices = Boolean(navigator.mediaDevices?.getUserMedia);
    return (isMobile || isTouchDevice) && hasMediaDevices;
  }

  private isTouchDevice(): boolean {
    return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  }

  private isDeviceMobile(): boolean {
    const userAgent = navigator.userAgent.toLowerCase();
    const mobileKeywords = ['android', 'iphone', 'ipad', 'ipod', 'blackberry', 'windows phone', 'mobile', 'opera mini'];

    return mobileKeywords.some((keyword) => userAgent.includes(keyword));
  }

  public async shouldShowCameraButtonAsync(): Promise<boolean> {
    const deviceInfo = await this.getDeviceInfo();

    return deviceInfo.isMobile || deviceInfo.hasRearCamera;
  }

  public async getDeviceInfo(): Promise<DeviceInfo> {
    if (this.deviceInfo) {
      return this.deviceInfo;
    }

    const isTouchDevice = this.isTouchDevice();
    const isMobile = this.isDeviceMobile();
    const platform = this.getDevicePlatform();
    const { hasRearCamera, hasFrontCamera } = await this.detectCameras();

    this.deviceInfo = {
      isMobile,
      hasRearCamera,
      hasFrontCamera,
      isTouchDevice,
      platform,
    };

    return this.deviceInfo;
  }

  public logDeviceInfo(): void {
    const isMobile = this.isDeviceMobile();
    const isTouchDevice = this.isTouchDevice();
    const hasMediaDevices = Boolean(navigator.mediaDevices?.getUserMedia);
    const userAgent = navigator.userAgent;
    const shouldShow = this.shouldShowCameraButton();

    console.log('Device Detection Info:', {
      userAgent,
      isMobile,
      isTouchDevice,
      hasMediaDevices,
      shouldShowCameraButton: shouldShow,
      platform: this.getDevicePlatform(),
    });
  }

  public getDevicePlatform(): 'mobile' | 'tablet' | 'desktop' {
    const userAgent = navigator.userAgent.toLowerCase();

    if (/iphone|android.*mobile/.test(userAgent)) {
      return 'mobile';
    }

    if (/ipad|android(?!.*mobile)|tablet/.test(userAgent)) {
      return 'tablet';
    }

    return 'desktop';
  }

  private async detectCameras(): Promise<{ hasRearCamera: boolean; hasFrontCamera: boolean }> {
    try {
      if (!navigator.mediaDevices?.enumerateDevices) {
        return { hasRearCamera: false, hasFrontCamera: false };
      }

      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoInputs = devices.filter((device) => device.kind === 'videoinput');

      let hasRearCamera = false;
      let hasFrontCamera = false;

      for (const device of videoInputs) {
        const label = device.label.toLowerCase();

        if (label.includes('back') || label.includes('rear') || label.includes('environment')) {
          hasRearCamera = true;
        } else if (label.includes('front') || label.includes('user') || label.includes('facing')) {
          hasFrontCamera = true;
        } else if (label.includes('webcam') || label.includes('camera') || label.includes('usb')) {
          hasFrontCamera = true;
        }
      }

      if (videoInputs.length > 0 && !hasRearCamera && !hasFrontCamera) {
        const isMobile = this.isDeviceMobile();

        if (isMobile) {
          if (videoInputs.length === 1) {
            hasRearCamera = true;
          } else {
            hasRearCamera = true;
            hasFrontCamera = true;
          }
        } else {
          hasFrontCamera = true;
        }
      }

      return { hasRearCamera, hasFrontCamera };
    } catch (error) {
      console.warn('Failed to detect cameras:', error);
      return { hasRearCamera: false, hasFrontCamera: false };
    }
  }
}
