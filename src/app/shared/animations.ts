export const ANIMATION_DURATION_MS = {
  FAST: 125,
  MEDIUM: 250,
  SLOW: 400,
  THEME: 200,
} as const;

export const ANIMATION_DURATION_MS_STRING = {
  FAST: `${ANIMATION_DURATION_MS.FAST}ms`,
  MEDIUM: `${ANIMATION_DURATION_MS.MEDIUM}ms`,
  SLOW: `${ANIMATION_DURATION_MS.SLOW}ms`,
  THEME: `${ANIMATION_DURATION_MS.THEME}ms`,
} as const;

// CSS class names for animate.enter/leave approach
export const ANIMATION_CLASSES = {
  FADE_SCALE_IN: 'fade-scale-in-animation',
  SLIDE_IN_RIGHT: 'slide-in-right-animation',
  SLIDE_OUT_RIGHT: 'slide-out-right-animation',
  SLIDE_IN_LEFT: 'slide-in-left-animation',
  SLIDE_OUT_LEFT: 'slide-out-left-animation',
} as const;
