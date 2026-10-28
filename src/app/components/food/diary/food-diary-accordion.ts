// Shared accordion-group id for the food diary screen — the day-summary panel (BMI/weight/
// nutrition) and the diary entries list render as separate <v-accordion> instances but share
// this id (single-open-item-at-a-time across both), so any consumer that needs to react to
// "something on this screen is expanded" (food-diary.ts, diary-nav-buttons.ts) reads the same
// id instead of redeclaring the string.
export const FOOD_DIARY_ACCORDION_GROUP_ID = 'food-diary-section';
