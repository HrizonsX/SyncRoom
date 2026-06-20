import assert from "node:assert/strict";
import test from "node:test";
import {
  readDisclosureOpenState,
  restoreDisclosureOpenState,
} from "../src/disclosure-state.js";

type FakeDisclosure = {
  dataset: { disclosureId?: string };
  open: boolean;
};

function createFakeDisclosureRoot(items: FakeDisclosure[]) {
  return {
    querySelectorAll(selector: string) {
      assert.equal(selector, "details[data-disclosure-id]");
      return items;
    },
  } as unknown as ParentNode;
}

test("restores open disclosure state after a rerender", () => {
  const before = createFakeDisclosureRoot([
    { dataset: { disclosureId: "members" }, open: true },
    { dataset: { disclosureId: "diagnostics" }, open: false },
  ]);
  const state = readDisclosureOpenState(before);
  const afterItems: FakeDisclosure[] = [
    { dataset: { disclosureId: "members" }, open: false },
    { dataset: { disclosureId: "diagnostics" }, open: true },
  ];

  restoreDisclosureOpenState(createFakeDisclosureRoot(afterItems), state);

  assert.equal(afterItems[0]?.open, true);
  assert.equal(afterItems[1]?.open, false);
});
