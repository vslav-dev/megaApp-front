// Shared geometry for the food screen's floating action buttons — the mode-toggle FAB
// (food-mode-toggle-fab, owned by food-screen) and the diary FAB row (diary-nav-buttons, owned by
// food-diary) are rendered from separate components but stack in the same bottom-right corner, above
// the global nav hamburger (navigation.ts). This is the single place that defines their positions,
// so adding/reordering a layer can't silently collide with another component's hand-picked pixels.

// Matches Navigation's hamburger FAB offset (mb-4/mr-4).
const FAB_EDGE_OFFSET_PX = 16;
// One FAB's footprint (button size + gap to the next one).
const FAB_CLEARANCE_PX = 72;

// Bottom-right stacked column. Layer 0 is the global nav hamburger (navigation.ts) — not listed
// here since that component isn't food-specific, but its position defines this stack's baseline.
export const FoodFabLayer = {
  ModeToggle: 1,
  AddFood: 2,
} as const;

export function foodFabStackBottomPx(layer: number): string {
  return `${FAB_EDGE_OFFSET_PX + layer * FAB_CLEARANCE_PX}px`;
}

// Horizontal inset for a FAB row that needs to clear the single-button-wide stack at the right edge.
export const FOOD_FAB_ROW_RIGHT_INSET_PX = FAB_EDGE_OFFSET_PX + FAB_CLEARANCE_PX;
