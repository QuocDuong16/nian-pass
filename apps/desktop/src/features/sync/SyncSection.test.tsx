import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { mutationApi, mutationSnapshot } from "../../test/desktop-api";
import { SyncSection } from "./SyncSection";

const profile = {
  profileId: "b466947b-e428-401b-87a2-eb30c751803f",
  target: {
    provider: "webdav" as const,
    resourceUrl: "https://dav.example.test/vault.kdbx",
  },
  available: true,
  recoveryStatus: "none",
};

const gatewayProfile = {
  profileId: "a466947b-e428-401b-87a2-eb30c751803f",
  target: {
    provider: "gateway" as const,
    baseUrl: "https://gateway.example.test",
    vaultId: "7163588f-9568-46fe-a1bd-32f3d15fd15d",
  },
  available: true,
  recoveryStatus: "none",
};

afterEach(() => {
  cleanup();
});

test("passes credentials once and clears every secret after sync", async () => {
  const syncNow = vi.fn().mockResolvedValue({
    status: "done",
    conflict: null,
    snapshot: mutationSnapshot,
  });
  const api = mutationApi({
    syncProfiles: vi.fn().mockResolvedValue([profile]),
    syncNow,
  });
  render(
    <SyncSection
      api={api}
      disabled={false}
      onBusyChange={vi.fn()}
      onSnapshot={vi.fn()}
    />,
  );

  await screen.findByDisplayValue(profile.target.resourceUrl);
  fireEvent.change(screen.getByLabelText("WebDAV username"), {
    target: { value: "sync-user" },
  });
  fireEvent.change(screen.getByLabelText("WebDAV password"), {
    target: { value: "SECRET_WEBDAV_PASSWORD" },
  });
  fireEvent.change(screen.getByLabelText("Vault master password"), {
    target: { value: "SECRET_MASTER_PASSWORD" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Sync now" }));

  await waitFor(() => {
    expect(syncNow).toHaveBeenCalledTimes(1);
  });
  expect(syncNow).toHaveBeenCalledWith(
    profile.profileId,
    {
      webdav: {
        username: "sync-user",
        password: "SECRET_WEBDAV_PASSWORD",
      },
    },
    "SECRET_MASTER_PASSWORD",
  );
  await waitFor(() => {
    expect(screen.getByLabelText("WebDAV password")).toHaveValue("");
    expect(screen.getByLabelText("Vault master password")).toHaveValue("");
  });
});

test("requires a second explicit action before destructive conflict resolution", async () => {
  const resolveSyncConflict = vi.fn();
  const api = mutationApi({
    syncProfiles: vi.fn().mockResolvedValue([profile]),
    syncNow: vi.fn().mockResolvedValue({
      status: "waitingForConflictDecision",
      conflict: {
        conflictOperationId: "55f13217-13ee-4c23-8a9a-a47e7b65c0e9",
        initialConflict: false,
        conflicts: [
          {
            objectKind: "entry",
            objectId: "safe-entry-id",
            conflictKind: "field",
            fieldKind: "password",
          },
        ],
      },
      snapshot: mutationSnapshot,
    }),
    resolveSyncConflict,
  });
  render(
    <SyncSection
      api={api}
      disabled={false}
      onBusyChange={vi.fn()}
      onSnapshot={vi.fn()}
    />,
  );

  await screen.findByDisplayValue(profile.target.resourceUrl);
  fireEvent.change(screen.getByLabelText("WebDAV username"), {
    target: { value: "sync-user" },
  });
  fireEvent.change(screen.getByLabelText("WebDAV password"), {
    target: { value: "SECRET_WEBDAV_PASSWORD" },
  });
  fireEvent.change(screen.getByLabelText("Vault master password"), {
    target: { value: "SECRET_MASTER_PASSWORD" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Sync now" }));

  await screen.findByRole("alertdialog");
  expect(
    screen.getByText(/No conflicting secret values are displayed/),
  ).toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "Use local as authoritative" }),
  );
  expect(resolveSyncConflict).not.toHaveBeenCalled();
  expect(
    screen.getByRole("button", { name: "Confirm destructive choice" }),
  ).toBeDisabled();

  fireEvent.change(screen.getByLabelText("WebDAV password"), {
    target: { value: "SECOND_SECRET" },
  });
  fireEvent.change(screen.getByLabelText("Vault master password"), {
    target: { value: "SECOND_MASTER" },
  });
  expect(
    screen.getByRole("button", { name: "Confirm destructive choice" }),
  ).toBeEnabled();
  fireEvent.click(
    screen.getByRole("button", { name: "Confirm destructive choice" }),
  );
  await waitFor(() => {
    expect(resolveSyncConflict).toHaveBeenCalledWith(
      profile.profileId,
      "55f13217-13ee-4c23-8a9a-a47e7b65c0e9",
      "keepLocal",
      { webdav: { username: "sync-user", password: "SECOND_SECRET" } },
      "SECOND_MASTER",
    );
  });
});

test("creates a non-secret WebDAV profile and reports failures generically", async () => {
  const saved = { ...profile, profileId: "new-profile" };
  const saveSyncProfile = vi
    .fn()
    .mockRejectedValueOnce(new Error("SECRET_PROVIDER_DETAIL"))
    .mockResolvedValueOnce(saved);
  const api = mutationApi({
    syncProfiles: vi.fn().mockResolvedValue([]),
    saveSyncProfile,
  });
  render(
    <SyncSection
      api={api}
      disabled={false}
      onBusyChange={vi.fn()}
      onSnapshot={vi.fn()}
    />,
  );

  const resource = screen.getByLabelText("Remote KDBX URL");
  fireEvent.change(resource, {
    target: { value: " https://dav.example.test/new.kdbx " },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Save non-secret profile" }),
  );
  await screen.findByText("Synchronization failed safely.");
  fireEvent.click(
    screen.getByRole("button", { name: "Save non-secret profile" }),
  );
  await screen.findByText("Profile saved. Credentials were not stored.");
  expect(saveSyncProfile).toHaveBeenLastCalledWith({
    target: {
      provider: "webdav",
      resourceUrl: "https://dav.example.test/new.kdbx",
    },
  });
});

test("creates a new S3 target, tests read-only connectivity, and syncs", async () => {
  const s3Profile = {
    profileId: "8f01f858-d99c-43d6-b2c6-e5f77caf9212",
    target: {
      provider: "s3" as const,
      endpoint: null,
      region: "us-east-1",
      bucket: "old-bucket",
      objectKey: "old.kdbx",
      pathStyle: false,
    },
    available: true,
    recoveryStatus: "required",
  };
  const saveSyncProfile = vi.fn().mockResolvedValue(s3Profile);
  const testSyncProvider = vi.fn().mockResolvedValue({ status: "present" });
  const syncNow = vi.fn().mockResolvedValue({
    status: "done",
    conflict: null,
    snapshot: mutationSnapshot,
  });
  const api = mutationApi({
    syncProfiles: vi.fn().mockResolvedValue([profile, s3Profile]),
    saveSyncProfile,
    testSyncProvider,
    syncNow,
  });
  render(
    <SyncSection
      api={api}
      disabled={false}
      onBusyChange={vi.fn()}
      onSnapshot={vi.fn()}
    />,
  );

  await screen.findByDisplayValue(profile.target.resourceUrl);
  fireEvent.change(screen.getByLabelText("Saved sync profile"), {
    target: { value: s3Profile.profileId },
  });
  expect(
    await screen.findByText("Sync recovery required."),
  ).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Saved sync profile"), {
    target: { value: "" },
  });
  expect(
    await screen.findByText(
      "New profile. Saving creates a new remote relationship.",
    ),
  ).toBeInTheDocument();
  for (const [label, value] of [
    ["Endpoint (optional)", "http://127.0.0.1:9000"],
    ["Region", "test-region"],
    ["Bucket", "test-bucket"],
    ["Object key", "vault.kdbx"],
    ["Access key ID", "TEST_ACCESS_KEY"],
    ["Secret access key", "SECRET_S3_ACCESS_SECRET"],
    ["Session token (optional)", "SECRET_SESSION_TOKEN"],
  ] as const) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }
  fireEvent.click(screen.getByLabelText("Path-style addressing"));
  fireEvent.click(
    screen.getByRole("button", { name: "Save non-secret profile" }),
  );
  await waitFor(() => {
    expect(saveSyncProfile).toHaveBeenCalledWith({
      target: {
        provider: "s3",
        endpoint: "http://127.0.0.1:9000",
        region: "test-region",
        bucket: "test-bucket",
        objectKey: "vault.kdbx",
        pathStyle: true,
      },
    });
  });

  fireEvent.change(screen.getByLabelText("Secret access key"), {
    target: { value: "SECRET_S3_ACCESS_SECRET" },
  });
  fireEvent.change(screen.getByLabelText("Session token (optional)"), {
    target: { value: "SECRET_SESSION_TOKEN" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
  await screen.findByText("Connection succeeded; remote vault exists.");
  expect(testSyncProvider).toHaveBeenCalledWith(s3Profile.profileId, {
    s3: {
      accessKeyId: "TEST_ACCESS_KEY",
      secretAccessKey: "SECRET_S3_ACCESS_SECRET",
      sessionToken: "SECRET_SESSION_TOKEN",
    },
  });

  fireEvent.change(screen.getByLabelText("Secret access key"), {
    target: { value: "SECOND_S3_SECRET" },
  });
  fireEvent.change(screen.getByLabelText("Vault master password"), {
    target: { value: "MASTER" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Sync now" }));
  await waitFor(() => {
    expect(syncNow).toHaveBeenCalledTimes(1);
  });
});

test("creates a UUID gateway target and clears the request-only token", async () => {
  const saveSyncProfile = vi
    .fn()
    .mockImplementation((request: { target: unknown }) =>
      Promise.resolve({
        profileId: "a466947b-e428-401b-87a2-eb30c751803f",
        target: request.target,
        available: true,
        recoveryStatus: "none",
      }),
    );
  const testSyncProvider = vi.fn().mockResolvedValue({ status: "missing" });
  const api = mutationApi({
    syncProfiles: vi.fn().mockResolvedValue([]),
    saveSyncProfile,
    testSyncProvider,
  });
  render(
    <SyncSection
      api={api}
      disabled={false}
      onBusyChange={vi.fn()}
      onSnapshot={vi.fn()}
    />,
  );

  fireEvent.change(screen.getByLabelText("Provider"), {
    target: { value: "gateway" },
  });
  const vaultId = screen.getByLabelText<HTMLInputElement>("Vault ID").value;
  expect(vaultId).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  const editedVaultId = "c3f8db0f-5f3a-4f94-a1c5-2133c14c5723";
  fireEvent.change(screen.getByLabelText("Vault ID"), {
    target: { value: editedVaultId },
  });
  fireEvent.change(screen.getByLabelText("Gateway URL"), {
    target: { value: " https://gateway.example.test " },
  });
  fireEvent.change(screen.getByLabelText("Access token"), {
    target: { value: "SECRET_GATEWAY_ACCESS_TOKEN" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Save non-secret profile" }),
  );
  await waitFor(() => {
    expect(saveSyncProfile).toHaveBeenCalledWith({
      target: {
        provider: "gateway",
        baseUrl: "https://gateway.example.test",
        vaultId: editedVaultId,
      },
    });
  });
  expect(screen.getByLabelText("Access token")).toHaveValue("");

  fireEvent.change(screen.getByLabelText("Access token"), {
    target: { value: "SECOND_GATEWAY_TOKEN" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
  await screen.findByText("Connection succeeded; remote vault is missing.");
  expect(testSyncProvider).toHaveBeenCalledWith(
    "a466947b-e428-401b-87a2-eb30c751803f",
    { gateway: { accessToken: "SECOND_GATEWAY_TOKEN" } },
  );
  expect(screen.getByLabelText("Access token")).toHaveValue("");
});

test("loads an existing gateway target without a token", async () => {
  const api = mutationApi({
    syncProfiles: vi.fn().mockResolvedValue([gatewayProfile]),
  });
  render(
    <SyncSection
      api={api}
      disabled={false}
      onBusyChange={vi.fn()}
      onSnapshot={vi.fn()}
    />,
  );

  expect(
    await screen.findByDisplayValue(gatewayProfile.target.baseUrl),
  ).toBeVisible();
  expect(screen.getByLabelText("Vault ID")).toHaveValue(
    gatewayProfile.target.vaultId,
  );
  expect(screen.getByLabelText("Access token")).toHaveValue("");
});

test("requires explicit confirmation before resetting unsupported sync metadata", async () => {
  const unsupported = { ...profile, recoveryStatus: "unsupported" as const };
  const resetSyncState = vi.fn().mockResolvedValue(undefined);
  const api = mutationApi({
    syncProfiles: vi.fn().mockResolvedValue([unsupported]),
    resetSyncState,
  });
  render(
    <SyncSection
      api={api}
      disabled={false}
      onBusyChange={vi.fn()}
      onSnapshot={vi.fn()}
    />,
  );

  expect(
    await screen.findByText(/remote target identity was not recorded/i),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Sync now" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Reset sync state" }));
  expect(resetSyncState).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(
    screen.queryByRole("button", { name: "Confirm reset sync state" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Reset sync state" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Confirm reset sync state" }),
  );
  await waitFor(() => {
    expect(resetSyncState).toHaveBeenCalledWith(profile.profileId);
  });
  expect(
    await screen.findByText(
      "Sync metadata reset. The local and remote vaults were not modified.",
    ),
  ).toBeInTheDocument();
});

test("can back out of and cancel an initial remote-authoritative choice", async () => {
  const api = mutationApi({
    syncProfiles: vi.fn().mockResolvedValue([profile]),
    syncNow: vi.fn().mockResolvedValue({
      status: "waitingForConflictDecision",
      conflict: {
        conflictOperationId: "initial-operation",
        initialConflict: true,
        conflicts: [],
      },
      snapshot: mutationSnapshot,
    }),
  });
  render(
    <SyncSection
      api={api}
      disabled={false}
      onBusyChange={vi.fn()}
      onSnapshot={vi.fn()}
    />,
  );
  await screen.findByDisplayValue(profile.target.resourceUrl);
  fireEvent.change(screen.getByLabelText("WebDAV username"), {
    target: { value: "user" },
  });
  fireEvent.change(screen.getByLabelText("WebDAV password"), {
    target: { value: "secret" },
  });
  fireEvent.change(screen.getByLabelText("Vault master password"), {
    target: { value: "master" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Sync now" }));
  await screen.findByText(/No proven common BASE exists/);
  fireEvent.click(
    screen.getByRole("button", { name: "Use remote as authoritative" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(
    screen.getByRole("button", { name: "Use local as authoritative" }),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
});

test("shows profile-load failure and dirty-vault warning", async () => {
  const api = mutationApi({
    syncProfiles: vi.fn().mockRejectedValue(new Error("unavailable")),
  });
  render(
    <SyncSection
      api={api}
      disabled
      onBusyChange={vi.fn()}
      onSnapshot={vi.fn()}
    />,
  );
  expect(
    await screen.findByText("Nian Pass could not load sync profiles."),
  ).toBeInTheDocument();
  expect(
    screen.getByText("Save or finish the current draft before syncing."),
  ).toBeInTheDocument();
});
