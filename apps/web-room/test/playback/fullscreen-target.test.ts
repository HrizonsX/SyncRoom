import assert from "node:assert/strict";
import test from "node:test";
import {
  PLAYER_FULLSCREEN_ROOT_ID,
  syncPlayerFullscreenTarget,
} from "../../src/playback/fullscreen-target.js";

test("syncs media controller fullscreen target to the stable root element", () => {
  const target = { id: PLAYER_FULLSCREEN_ROOT_ID } as HTMLElement;
  const controller = {
    fullscreenElement: undefined as HTMLElement | undefined,
  };
  const root = {
    querySelector(selector: string) {
      return selector === ".player-media-controller" ? controller : null;
    },
  } as ParentNode;
  const documentLike = {
    getElementById(id: string) {
      return id === PLAYER_FULLSCREEN_ROOT_ID ? target : null;
    },
  } as Document;

  syncPlayerFullscreenTarget(root, documentLike);

  assert.equal(controller.fullscreenElement, target);
});
