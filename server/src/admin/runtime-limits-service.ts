export type RuntimeLimits = {
  maxActiveRoomsPerNode: number | null;
};

export class RuntimeLimitsValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuntimeLimitsValidationError";
  }
}

function normalizeMaxActiveRoomsPerNode(value: unknown): number | null {
  if (value === null || value === "") {
    return null;
  }

  if (!Number.isInteger(value) || Number(value) <= 0) {
    throw new RuntimeLimitsValidationError(
      "maxActiveRoomsPerNode must be a positive integer or null.",
    );
  }

  return Number(value);
}

export function createRuntimeLimitsService(
  initial: Partial<RuntimeLimits> = {},
) {
  let limits: RuntimeLimits = {
    maxActiveRoomsPerNode:
      initial.maxActiveRoomsPerNode === undefined
        ? null
        : normalizeMaxActiveRoomsPerNode(initial.maxActiveRoomsPerNode),
  };

  function getLimits(): RuntimeLimits {
    return { ...limits };
  }

  return {
    getLimits,
    getMaxActiveRoomsPerNode() {
      return limits.maxActiveRoomsPerNode;
    },
    updateLimits(input: unknown): RuntimeLimits {
      if (typeof input !== "object" || input === null) {
        throw new RuntimeLimitsValidationError(
          "runtime limits payload must be an object.",
        );
      }
      if (!Object.hasOwn(input, "maxActiveRoomsPerNode")) {
        throw new RuntimeLimitsValidationError(
          "maxActiveRoomsPerNode is required.",
        );
      }
      limits = {
        maxActiveRoomsPerNode: normalizeMaxActiveRoomsPerNode(
          (input as { maxActiveRoomsPerNode?: unknown }).maxActiveRoomsPerNode,
        ),
      };
      return getLimits();
    },
  };
}
