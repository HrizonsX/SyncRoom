import { createAdminOverviewService } from "./overview-service.js";

export function createGlobalAdminOverviewService(
  options: Parameters<typeof createAdminOverviewService>[0],
) {
  return createAdminOverviewService({
    ...options,
    serviceName: options.serviceName || "syncroom-global-admin",
  });
}
