import {
  ANNOUNCEMENT_ID_MAX_LENGTH,
  ANNOUNCEMENT_TEXT_MAX_LENGTH,
  MAX_ANNOUNCEMENT_ITEMS,
  type AnnouncementItem,
  type AnnouncementState,
} from "@syncroom/protocol";

export class AnnouncementValidationError extends Error {}

export type AnnouncementStore = {
  getState: () => AnnouncementState;
  replaceItems: (items: unknown) => AnnouncementState;
};

export function createInMemoryAnnouncementStore(
  options: {
    now?: () => number;
  } = {},
): AnnouncementStore {
  const now = options.now ?? Date.now;
  let state: AnnouncementState = {
    version: 0,
    updatedAt: 0,
    items: [],
  };

  function getState(): AnnouncementState {
    return cloneState(state);
  }

  function replaceItems(items: unknown): AnnouncementState {
    state = {
      version: state.version + 1,
      updatedAt: now(),
      items: normalizeAnnouncementItems(items),
    };
    return getState();
  }

  return {
    getState,
    replaceItems,
  };
}

function normalizeAnnouncementItems(items: unknown): AnnouncementItem[] {
  if (!Array.isArray(items)) {
    throw new AnnouncementValidationError("items must be an array.");
  }
  if (items.length > MAX_ANNOUNCEMENT_ITEMS) {
    throw new AnnouncementValidationError(
      `items cannot contain more than ${MAX_ANNOUNCEMENT_ITEMS} announcements.`,
    );
  }

  return items.map((item, index) => normalizeAnnouncementItem(item, index));
}

function normalizeAnnouncementItem(
  item: unknown,
  index: number,
): AnnouncementItem {
  if (typeof item !== "object" || item === null) {
    throw new AnnouncementValidationError(`items[${index}] must be an object.`);
  }
  const record = item as Record<string, unknown>;
  const id = normalizeBoundedString(
    record.id,
    ANNOUNCEMENT_ID_MAX_LENGTH,
    `items[${index}].id`,
  );
  const text = normalizeBoundedString(
    record.text,
    ANNOUNCEMENT_TEXT_MAX_LENGTH,
    `items[${index}].text`,
  );

  return { id, text };
}

function normalizeBoundedString(
  value: unknown,
  maxLength: number,
  fieldName: string,
): string {
  if (typeof value !== "string") {
    throw new AnnouncementValidationError(`${fieldName} must be a string.`);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new AnnouncementValidationError(`${fieldName} is required.`);
  }
  if (trimmed.length > maxLength) {
    throw new AnnouncementValidationError(
      `${fieldName} cannot exceed ${maxLength} characters.`,
    );
  }
  return trimmed;
}

function cloneState(state: AnnouncementState): AnnouncementState {
  return {
    version: state.version,
    updatedAt: state.updatedAt,
    items: state.items.map((item) => ({ ...item })),
  };
}
