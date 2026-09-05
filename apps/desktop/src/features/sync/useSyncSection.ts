import { useCallback, useEffect, useMemo, useState } from "react";

import type { SyncConflictOperation, SyncProfileDto } from "../../lib/sync";
import type { ConflictChoice } from "./SyncConflictPanel";
import { projectSyncForm } from "./form-values";
import { syncErrorMessage } from "./sync-errors";
import type { SyncSectionOptions } from "./types";
import { useSyncFormState } from "./useSyncFormState";

export function useSyncSection({
  api,
  disabled,
  onBusyChange,
  onSnapshot,
}: SyncSectionOptions) {
  const [profiles, setProfiles] = useState<SyncProfileDto[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const form = useSyncFormState();
  const {
    setBucket,
    setEndpoint,
    setObjectKey,
    setPathStyle,
    setProvider,
    setRegion,
    setResourceUrl,
  } = form;
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Idle");
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<SyncConflictOperation | null>(null);
  const [confirmChoice, setConfirmChoice] = useState<ConflictChoice | null>(
    null,
  );
  const [confirmReset, setConfirmReset] = useState(false);

  const selectProfile = useCallback(
    (profile: SyncProfileDto) => {
      setSelectedId(profile.profileId);
      setProvider(profile.target.provider);
      if (profile.target.provider === "webdav")
        setResourceUrl(profile.target.resourceUrl);
      else {
        setEndpoint(profile.target.endpoint ?? "");
        setRegion(profile.target.region);
        setBucket(profile.target.bucket);
        setObjectKey(profile.target.objectKey);
        setPathStyle(profile.target.pathStyle);
      }
      setConflict(null);
      setConfirmChoice(null);
      setConfirmReset(false);
      setStatus(
        profile.recoveryStatus === "required"
          ? "Sync recovery required."
          : profile.recoveryStatus === "unsupported"
            ? "Older or unsupported sync metadata must be reset explicitly."
            : "Idle",
      );
    },
    [
      setBucket,
      setEndpoint,
      setObjectKey,
      setPathStyle,
      setProvider,
      setRegion,
      setResourceUrl,
    ],
  );

  useEffect(() => {
    let active = true;
    void api
      .syncProfiles()
      .then((loaded) => {
        if (!active) return;
        setProfiles(loaded);
        const first = loaded.find((profile) => profile.available) ?? loaded[0];
        if (first !== undefined) selectProfile(first);
      })
      .catch(() => {
        if (active) setError("Nian Pass could not load sync profiles.");
      });
    return () => {
      active = false;
    };
  }, [api, selectProfile]);

  const selected = useMemo(
    () => profiles.find((profile) => profile.profileId === selectedId) ?? null,
    [profiles, selectedId],
  );
  const { target, credentials, providerConfigComplete, credentialsComplete } =
    projectSyncForm(form);
  const run = async (label: string, operation: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    onBusyChange(true);
    setError(null);
    setStatus(label);
    try {
      await operation();
    } catch (reason: unknown) {
      setError(syncErrorMessage(reason));
      setStatus("Failed");
    } finally {
      form.clearSecrets();
      setBusy(false);
      onBusyChange(false);
    }
  };
  const saveProfile = () =>
    run("Saving profile", async () => {
      const saved = await api.saveSyncProfile({
        ...(selectedId === null ? {} : { profileId: selectedId }),
        target,
      });
      setProfiles((current) => [
        ...current.filter((profile) => profile.profileId !== saved.profileId),
        saved,
      ]);
      setSelectedId(saved.profileId);
      setStatus("Profile saved. Credentials were not stored.");
    });
  const testConnection = () =>
    selected === null
      ? undefined
      : run("Connecting", async () => {
          const result = await api.testSyncProvider(
            selected.profileId,
            credentials,
          );
          setStatus(
            result.status === "present"
              ? "Connection succeeded; remote vault exists."
              : "Connection succeeded; remote vault is missing.",
          );
        });
  const syncNow = () =>
    selected === null
      ? undefined
      : run("Reading and comparing encrypted vaults", async () => {
          setConflict(null);
          setConfirmChoice(null);
          const result = await api.syncNow(
            selected.profileId,
            credentials,
            form.masterPassword,
          );
          onSnapshot(result.snapshot);
          setConflict(result.conflict);
          setConfirmChoice(null);
          setStatus(
            result.status === "done"
              ? "Synchronization complete."
              : "Conflict decision required.",
          );
        });
  const resolveConflict = (choice: ConflictChoice) =>
    selected === null || conflict === null
      ? undefined
      : run("Applying confirmed conflict choice", async () => {
          const result = await api.resolveSyncConflict(
            selected.profileId,
            conflict.conflictOperationId,
            choice,
            credentials,
            form.masterPassword,
          );
          onSnapshot(result.snapshot);
          setConflict(null);
          setConfirmChoice(null);
          setStatus("Synchronization complete.");
        });
  const resetSyncState = () =>
    selected === null
      ? undefined
      : run("Resetting Nian Pass sync metadata", async () => {
          await api.resetSyncState(selected.profileId);
          setProfiles((current) =>
            current.map((profile) =>
              profile.profileId === selected.profileId
                ? { ...profile, recoveryStatus: "none" }
                : profile,
            ),
          );
          setConflict(null);
          setConfirmChoice(null);
          setConfirmReset(false);
          setStatus(
            "Sync metadata reset. The local and remote vaults were not modified.",
          );
        });

  function startNewProfile() {
    setSelectedId(null);
    setConflict(null);
    setConfirmChoice(null);
    setConfirmReset(false);
    setStatus("New profile. Saving creates a new remote relationship.");
  }

  const syncUnavailable =
    disabled ||
    busy ||
    selected === null ||
    selected.recoveryStatus === "unsupported" ||
    !credentialsComplete ||
    form.masterPassword === "";
  return {
    profiles,
    selectedId,
    ...form,
    busy,
    status,
    error,
    conflict,
    confirmChoice,
    confirmReset,
    selected,
    providerConfigComplete,
    credentialsComplete,
    syncUnavailable,
    setSelectedId,
    setConfirmChoice,
    setConfirmReset,
    setConflict,
    selectProfile,
    startNewProfile,
    saveProfile,
    testConnection,
    syncNow,
    resolveConflict,
    resetSyncState,
  };
}
