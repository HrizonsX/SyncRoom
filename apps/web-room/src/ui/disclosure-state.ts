const DISCLOSURE_SELECTOR = "details[data-disclosure-id]";

export type DisclosureOpenState = Record<string, boolean>;

export function readDisclosureOpenState(root: ParentNode): DisclosureOpenState {
  const state: DisclosureOpenState = {};
  root
    .querySelectorAll<HTMLDetailsElement>(DISCLOSURE_SELECTOR)
    .forEach((details) => {
      const id = details.dataset.disclosureId;
      if (id) {
        state[id] = details.open;
      }
    });
  return state;
}

export function restoreDisclosureOpenState(
  root: ParentNode,
  state: DisclosureOpenState,
): void {
  root
    .querySelectorAll<HTMLDetailsElement>(DISCLOSURE_SELECTOR)
    .forEach((details) => {
      const id = details.dataset.disclosureId;
      if (id && id in state) {
        details.open = state[id] ?? false;
      }
    });
}
