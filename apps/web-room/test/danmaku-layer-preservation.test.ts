import assert from "node:assert/strict";
import test from "node:test";
import {
  getDanmakuItemKey,
  getUniqueNextDanmakuItemKeys,
  type DanmakuKeyElement,
} from "../src/danmaku-layer-preservation.js";

function elementWithDanmakuKey(key: string | null): DanmakuKeyElement {
  return {
    getAttribute(name: string) {
      return name === "data-danmaku-key" ? key : null;
    },
  };
}

test("reads stable danmaku item keys from rendered elements", () => {
  assert.equal(
    getDanmakuItemKey(elementWithDanmakuKey("member-1:1:hello")),
    "member-1:1:hello",
  );
  assert.equal(getDanmakuItemKey(elementWithDanmakuKey(null)), undefined);
});

test("keeps already rendered danmaku from being appended again", () => {
  assert.deepEqual(
    getUniqueNextDanmakuItemKeys(
      [
        elementWithDanmakuKey("member-1:1:hello"),
        elementWithDanmakuKey("member-2:2:world"),
      ],
      [
        elementWithDanmakuKey("member-1:1:hello"),
        elementWithDanmakuKey("member-3:3:new"),
        elementWithDanmakuKey("member-2:2:world"),
      ],
    ),
    ["member-3:3:new"],
  );
});
