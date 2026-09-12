import { describe, expect, test } from "vitest";

import {
  parseSyncProfile,
  parseSyncProfiles,
  parseSyncResult,
  parseTestProviderResult,
} from "./sync";

const webdavProfile = {
  profileId: "4d61b53c-76fc-49f2-918e-893731758c32",
  target: {
    provider: "webdav",
    resourceUrl: "https://dav.example.test/vault.kdbx",
  },
  available: true,
  recoveryStatus: "none",
};

const s3Profile = {
  profileId: "175f6e4d-5eb4-4529-bc36-b0a5197f6cce",
  target: {
    provider: "s3",
    endpoint: null,
    region: "us-east-1",
    bucket: "private-bucket",
    objectKey: "vault.kdbx",
    pathStyle: false,
  },
  available: false,
  recoveryStatus: "required",
};

const gatewayProfile = {
  profileId: "00112233-4455-4677-8899-aabbccddeeff",
  target: {
    provider: "gateway",
    baseUrl: "https://gateway.example.test/",
    vaultId: "11112233-4455-4677-8899-aabbccddeeff",
  },
  available: true,
  recoveryStatus: "none",
};

const snapshot = {
  dirty: false,
  fileName: "fixture.kdbx",
  capabilities: {
    formatVersion: "4.1",
    writable: true,
    writeRestriction: null,
  },
  rootGroupId: "root",
  groups: [{ id: "root", name: "Root", childGroupIds: [], entryIds: [] }],
  entries: [],
};

describe("sync contract parsing", () => {
  test("accepts exact WebDAV, S3, and gateway profile shapes", () => {
    expect(
      parseSyncProfiles([webdavProfile, s3Profile, gatewayProfile]),
    ).toEqual([webdavProfile, s3Profile, gatewayProfile]);
    expect(
      parseSyncProfile({
        ...s3Profile,
        target: { ...s3Profile.target, endpoint: "https://s3.example.test" },
      }),
    ).toMatchObject({ target: { endpoint: "https://s3.example.test" } });
    expect(
      parseSyncProfile({ ...webdavProfile, recoveryStatus: "unsupported" }),
    ).toMatchObject({ recoveryStatus: "unsupported" });
  });

  test("accepts done, conflict, and provider-read responses", () => {
    expect(
      parseSyncResult({ status: "done", conflict: null, snapshot }),
    ).toMatchObject({ status: "done", conflict: null });
    expect(
      parseSyncResult({
        status: "waitingForConflictDecision",
        conflict: {
          conflictOperationId: "e52bf706-0642-4987-a1b2-d806f00eb5c7",
          initialConflict: false,
          conflicts: [
            {
              objectKind: "entry",
              objectId: "entry-id",
              conflictKind: "field",
              fieldKind: null,
            },
          ],
        },
        snapshot,
      }),
    ).toMatchObject({
      status: "waitingForConflictDecision",
      conflict: { conflicts: [{ objectId: "entry-id", fieldKind: null }] },
    });
    expect(parseTestProviderResult({ status: "missing" })).toEqual({
      status: "missing",
    });
    expect(parseTestProviderResult({ status: "present" })).toEqual({
      status: "present",
    });
  });

  test("rejects malformed and cross-state values", () => {
    expect(() => parseSyncProfiles({})).toThrow(/invalid desktop contract/);
    expect(() =>
      parseSyncProfile({ ...webdavProfile, available: "yes" }),
    ).toThrow(/invalid desktop contract/);
    expect(() =>
      parseSyncProfile({ ...webdavProfile, recoveryStatus: "legacy" }),
    ).toThrow(/invalid desktop contract/);
    expect(() =>
      parseSyncProfile({ ...webdavProfile, target: { provider: "unknown" } }),
    ).toThrow(/invalid desktop contract/);
    expect(() =>
      parseSyncProfile({
        ...s3Profile,
        target: { ...s3Profile.target, endpoint: 42 },
      }),
    ).toThrow(/invalid desktop contract/);
    expect(() =>
      parseSyncResult({ status: "done", conflict: {}, snapshot }),
    ).toThrow(/invalid desktop contract/);
    expect(() =>
      parseSyncResult({ status: "unknown", conflict: null, snapshot }),
    ).toThrow(/invalid desktop contract/);
    expect(() =>
      parseSyncResult({
        status: "waitingForConflictDecision",
        conflict: {
          conflictOperationId: "token",
          initialConflict: false,
          conflicts: [
            {
              objectKind: "entry",
              objectId: 3,
              conflictKind: "field",
              fieldKind: null,
            },
          ],
        },
        snapshot,
      }),
    ).toThrow(/invalid desktop contract/);
    expect(() => parseTestProviderResult({ status: "other" })).toThrow(
      /invalid desktop contract/,
    );
  });
});
