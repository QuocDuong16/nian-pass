import type {
  ProviderCredentials,
  SaveSyncProfileRequest,
  SyncProfileDto,
  SyncResultDto,
  TestProviderResultDto,
} from "./sync";
import {
  parseSyncProfile,
  parseSyncProfiles,
  parseSyncResult,
  parseTestProviderResult,
} from "./sync";

export interface SyncApi {
  syncProfiles: () => Promise<SyncProfileDto[]>;
  saveSyncProfile: (request: SaveSyncProfileRequest) => Promise<SyncProfileDto>;
  deleteSyncProfile: (profileId: string) => Promise<void>;
  testSyncProvider: (
    profileId: string,
    credentials: ProviderCredentials,
  ) => Promise<TestProviderResultDto>;
  syncNow: (
    profileId: string,
    credentials: ProviderCredentials,
    masterPassword: string,
  ) => Promise<SyncResultDto>;
  resolveSyncConflict: (
    profileId: string,
    conflictOperationId: string,
    choice: "keepLocal" | "keepRemote",
    credentials: ProviderCredentials,
    masterPassword: string,
  ) => Promise<SyncResultDto>;
}

type Call = <T>(
  command: string,
  parse: (value: unknown) => T,
  args?: Record<string, unknown>,
) => Promise<T>;

export function createSyncApi(call: Call): SyncApi {
  return {
    syncProfiles: () => call("sync_profiles", parseSyncProfiles),
    saveSyncProfile: (request) =>
      call("save_sync_profile", parseSyncProfile, { request }),
    deleteSyncProfile: (profileId) =>
      call("delete_sync_profile", () => undefined, { profileId }),
    testSyncProvider: (profileId, credentials) =>
      call("test_sync_provider", parseTestProviderResult, {
        profileId,
        credentials,
      }),
    syncNow: (profileId, credentials, masterPassword) =>
      call("sync_now", parseSyncResult, {
        profileId,
        credentials,
        masterPassword,
      }),
    resolveSyncConflict: (
      profileId,
      conflictOperationId,
      choice,
      credentials,
      masterPassword,
    ) =>
      call("resolve_sync_conflict", parseSyncResult, {
        request: {
          profileId,
          conflictOperationId,
          choice,
          credentials,
          masterPassword,
        },
      }),
  };
}
