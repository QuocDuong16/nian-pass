import { expect, test } from "vitest";

import { createSyncApi } from "./sync-api";

test("sync API exposes only the reviewed command surface and argument shapes", async () => {
  const calls: {
    command: string;
    args: Record<string, unknown> | undefined;
  }[] = [];
  const responses: Record<string, unknown> = {
    sync_profiles: [],
    save_sync_profile: {
      profileId: "profile-id",
      target: {
        provider: "webdav",
        resourceUrl: "https://dav.test/vault.kdbx",
      },
      available: true,
      recoveryStatus: "none",
    },
    test_sync_provider: { status: "missing" },
    sync_now: {
      status: "done",
      conflict: null,
      snapshot: {
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
      },
    },
    resolve_sync_conflict: {
      status: "done",
      conflict: null,
      snapshot: {
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
      },
    },
  };
  const call = <T>(
    command: string,
    parse: (value: unknown) => T,
    args?: Record<string, unknown>,
  ): Promise<T> => {
    calls.push({ command, args });
    return Promise.resolve(parse(responses[command]));
  };
  const api = createSyncApi(call);
  const credentials = { webdav: { username: "user", password: "secret" } };

  await api.syncProfiles();
  await api.saveSyncProfile({
    target: { provider: "webdav", resourceUrl: "https://dav.test/vault.kdbx" },
  });
  await api.deleteSyncProfile("profile-id");
  await api.resetSyncState("profile-id");
  await api.testSyncProvider("profile-id", credentials);
  await api.syncNow("profile-id", credentials, "master");
  await api.resolveSyncConflict(
    "profile-id",
    "operation-id",
    "keepRemote",
    credentials,
    "master",
  );

  expect(calls.map(({ command }) => command)).toEqual([
    "sync_profiles",
    "save_sync_profile",
    "delete_sync_profile",
    "reset_sync_state",
    "test_sync_provider",
    "sync_now",
    "resolve_sync_conflict",
  ]);
  expect(calls.at(-1)?.args).toEqual({
    request: {
      profileId: "profile-id",
      conflictOperationId: "operation-id",
      choice: "keepRemote",
      credentials,
      masterPassword: "master",
    },
  });
});
