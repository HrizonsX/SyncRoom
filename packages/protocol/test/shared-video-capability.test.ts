import assert from "node:assert/strict";
import test from "node:test";

const protocol = (await import("../src/index.js")) as Record<string, unknown>;
const describeSharedVideoCapabilities =
  protocol.describeSharedVideoCapabilities as
    | ((value: unknown) => {
        page: {
          canOpen: boolean;
          normalizedUrl?: string;
        };
        provider: {
          resolved: boolean;
          canPlayInWebRoom: boolean;
          providerId?: string;
          mode?: string;
          candidateCount: number;
          sourceTypes: string[];
          unavailableReason?: string;
        };
      })
    | undefined;

function createProviderSharedVideo(policy: {
  proxy: boolean;
  shared: boolean;
}) {
  return {
    videoId: "BV1xx411c7mD",
    url: "https://www.bilibili.com/video/BV1xx411c7mD",
    title: "Bilibili video",
    provider: {
      providerId: "bilibili",
      sourceId: "BV1xx411c7mD",
      sourceUrl: "https://www.bilibili.com/video/BV1xx411c7mD",
      title: "Bilibili video",
      item: {
        itemId: "BV1xx411c7mD:cid-987654",
        title: "Part 1",
        kind: "part",
        cid: "987654",
        bvid: "BV1xx411c7mD",
      },
      policy,
      candidates: [
        {
          id: "dash-avc-1080p",
          sourceType: "mpd",
          url: "https://syncroom.example.test/proxy/manifest/manifest-1.mpd",
          qualityLabel: "1080P",
          codecs: "avc1.640028,mp4a.40.2",
          default: true,
        },
      ],
      defaultCandidateId: "dash-avc-1080p",
    },
  };
}

test("classifies an extension-style page share as page-open only", () => {
  assert.equal(typeof describeSharedVideoCapabilities, "function");

  const capabilities = describeSharedVideoCapabilities({
    videoId: "web:abc123",
    url: "https://example.com/watch?v=abc",
    title: "Example video",
  });

  assert.deepEqual(capabilities, {
    page: {
      canOpen: true,
      normalizedUrl: "https://example.com/watch?v=abc",
    },
    provider: {
      resolved: false,
      canPlayInWebRoom: false,
      candidateCount: 0,
      sourceTypes: [],
      unavailableReason: "missing_provider_descriptor",
    },
  });
});

test("classifies a proxied provider share as web-room playable", () => {
  assert.equal(typeof describeSharedVideoCapabilities, "function");

  const capabilities = describeSharedVideoCapabilities(
    createProviderSharedVideo({ proxy: true, shared: true }),
  );

  assert.equal(capabilities.page.canOpen, true);
  assert.equal(capabilities.provider.resolved, true);
  assert.equal(capabilities.provider.canPlayInWebRoom, true);
  assert.equal(capabilities.provider.providerId, "bilibili");
  assert.equal(capabilities.provider.mode, "proxy");
  assert.equal(capabilities.provider.candidateCount, 1);
  assert.deepEqual(capabilities.provider.sourceTypes, ["mpd"]);
});

test("classifies direct provider policy without implying extension support", () => {
  assert.equal(typeof describeSharedVideoCapabilities, "function");

  const shared = describeSharedVideoCapabilities(
    createProviderSharedVideo({ proxy: false, shared: true }),
  );
  const privateDirect = describeSharedVideoCapabilities(
    createProviderSharedVideo({ proxy: false, shared: false }),
  );

  assert.equal(shared.provider.mode, "direct-shared");
  assert.equal(privateDirect.provider.mode, "direct-private");
  assert.equal(shared.page.canOpen, true);
  assert.equal(privateDirect.page.canOpen, true);
});

test("keeps malformed provider candidates from becoming web-playable", () => {
  assert.equal(typeof describeSharedVideoCapabilities, "function");

  const capabilities = describeSharedVideoCapabilities({
    videoId: "web:abc123",
    url: "https://example.com/watch?v=abc",
    title: "Example video",
    provider: {
      providerId: "generic",
      policy: { proxy: false, shared: true },
      candidates: [
        {
          id: "avi",
          sourceType: "avi",
          url: "https://example.com/video.avi",
        },
      ],
    },
  });

  assert.equal(capabilities.provider.resolved, true);
  assert.equal(capabilities.provider.canPlayInWebRoom, false);
  assert.equal(
    capabilities.provider.unavailableReason,
    "unsupported_candidate_source",
  );
});
