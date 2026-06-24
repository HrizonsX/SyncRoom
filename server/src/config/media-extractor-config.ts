import type { MediaExtractorConfig } from "../types.js";
import type { EnvSource } from "./env.js";
import {
  loadSectionConfigFromEnv,
  MEDIA_EXTRACTOR_CONFIG_FIELDS,
} from "./runtime-config-schema.js";

const DEFAULT_MEDIA_EXTRACTOR_CONFIG: MediaExtractorConfig = {
  baseUrl: "http://127.0.0.1:8790",
};

function assertMediaExtractorBaseUrl(value: string): void {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(value);
  } catch {
    throw new Error(
      "MEDIA_EXTRACTOR_BASE_URL must be a valid absolute HTTP URL.",
    );
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new Error("MEDIA_EXTRACTOR_BASE_URL must use http:// or https://.");
  }
}

export function getDefaultMediaExtractorConfig(): MediaExtractorConfig {
  return { ...DEFAULT_MEDIA_EXTRACTOR_CONFIG };
}

export function loadMediaExtractorConfig(
  env: EnvSource = process.env,
): MediaExtractorConfig {
  const config = loadSectionConfigFromEnv(
    env,
    DEFAULT_MEDIA_EXTRACTOR_CONFIG,
    MEDIA_EXTRACTOR_CONFIG_FIELDS,
  );
  assertMediaExtractorBaseUrl(config.baseUrl);

  return {
    baseUrl: config.baseUrl.replace(/\/+$/, ""),
  };
}
