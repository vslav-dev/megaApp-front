export const TimeTrack = {
  Primary: 'primary',
  Secondary: 'secondary',
} as const;
export type TimeTrack = (typeof TimeTrack)[keyof typeof TimeTrack];

export const CategoryGroupKind = {
  Area: 'area',
} as const;
export type CategoryGroupKind = (typeof CategoryGroupKind)[keyof typeof CategoryGroupKind];

export const TimeScreenView = {
  Entry: 'entry',
  Stats: 'stats',
} as const;
export type TimeScreenView = (typeof TimeScreenView)[keyof typeof TimeScreenView];

export interface GroupBinding {
  groupId: number;
  required: boolean;
}

export interface ActivityKind {
  id: number;
  name: string;
  groupBindings: GroupBinding[];
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CategoryGroup {
  id: number;
  name: string;
  kind: CategoryGroupKind | null;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CategoryOption {
  id: number;
  groupId: number;
  name: string;
  color: string | null;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface EntryOption {
  groupId: number;
  optionId: number;
}

export interface TimeEntry {
  id: number;
  activityKindId: number;
  track: TimeTrack;
  startAt: string;
  endAt: string;
  options: EntryOption[];
  createdAt: string;
  updatedAt: string;
}

export interface Catalog {
  activityKinds: ActivityKind[];
  categoryGroups: CategoryGroup[];
  categoryOptions: CategoryOption[];
}

export interface ActivityKindInput {
  name: string;
  groupBindings: GroupBinding[];
  isArchived: boolean;
}

export interface CategoryGroupInput {
  name: string;
  kind: CategoryGroupKind | null;
  isArchived: boolean;
}

export interface CategoryOptionInput {
  groupId: number;
  name: string;
  color: string | null;
  isArchived: boolean;
}

export interface TimeEntryCreateInput {
  activityKindId: number;
  track: TimeTrack;
  startAt: string;
  endAt: string;
  options: EntryOption[];
}

export interface TimeEntryTimeInput {
  track: TimeTrack;
  startAt: string;
  endAt: string;
}

export interface TimeEntrySelectionInput {
  activityKindId: number;
  options: EntryOption[];
}
