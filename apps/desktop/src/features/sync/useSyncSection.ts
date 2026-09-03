import { useEffect, useMemo, useState } from "react";

import type { SyncConflictOperation, SyncProfileDto } from "../../lib/sync";
import type { ConflictChoice } from "./SyncConflictPanel";
import { projectSyncForm } from "./form-values";
import { syncErrorMessage } from "./sync-errors";
import type { ProviderKind, SyncSectionOptions } from "./types";

export function useSyncSection({
  api,
  disabled,
  onBusyChange,
  onSnapshot,
}: SyncSectionOptions) {
  const [profiles, setProfiles] = useState<SyncProfileDto[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [provider, setProvider] = useState<ProviderKind>("webdav");
  const [resourceUrl, setResourceUrl] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [region, setRegion] = useState("us-east-1");
  const [bucket, setBucket] = useState("");
  const [objectKey, setObjectKey] = useState("");
  const [pathStyle, setPathStyle] = useState(false);
  const [username, setUsername] = useState("");
  const [webdavPassword, setWebdavPassword] = useState("");
  const [accessKeyId, setAccessKeyId] = useState("");
  const [secretAccessKey, setSecretAccessKey] = useState("");
  const [sessionToken, setSessionToken] = useState("");
  const [masterPassword, setMasterPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Idle");
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<SyncConflictOperation | null>(null);
  const [confirmChoice, setConfirmChoice] = useState<ConflictChoice | null>(
    null,
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
  }, [api]);

  const selected = useMemo(
    () => profiles.find((profile) => profile.profileId === selectedId) ?? null,
    [profiles, selectedId],
  );
  const { target, credentials, providerConfigComplete, credentialsComplete } =
    projectSyncForm({
      provider,
      resourceUrl,
      endpoint,
      region,
      bucket,
      objectKey,
      pathStyle,
      username,
      webdavPassword,
      accessKeyId,
      secretAccessKey,
      sessionToken,
    });
  const clearSecrets = () => {
    setWebdavPassword("");
    setSecretAccessKey("");
    setSessionToken("");
    setMasterPassword("");
  };
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
      clearSecrets();
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
            masterPassword,
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
            masterPassword,
          );
          onSnapshot(result.snapshot);
          setConflict(null);
          setConfirmChoice(null);
          setStatus("Synchronization complete.");
        });

  function selectProfile(profile: SyncProfileDto) {
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
    setStatus(profile.recoveryRequired ? "Sync recovery required." : "Idle");
  }

  function startNewProfile() {
    setSelectedId(null);
    setConflict(null);
    setConfirmChoice(null);
    setStatus("New profile. Saving creates a new remote relationship.");
  }

  const syncUnavailable =
    disabled ||
    busy ||
    selected === null ||
    !credentialsComplete ||
    masterPassword === "";
  return {
    profiles,
    selectedId,
    provider,
    resourceUrl,
    endpoint,
    region,
    bucket,
    objectKey,
    pathStyle,
    username,
    webdavPassword,
    accessKeyId,
    secretAccessKey,
    sessionToken,
    masterPassword,
    busy,
    status,
    error,
    conflict,
    confirmChoice,
    selected,
    providerConfigComplete,
    credentialsComplete,
    syncUnavailable,
    setProvider,
    setSelectedId,
    setResourceUrl,
    setEndpoint,
    setRegion,
    setBucket,
    setObjectKey,
    setPathStyle,
    setUsername,
    setWebdavPassword,
    setAccessKeyId,
    setSecretAccessKey,
    setSessionToken,
    setMasterPassword,
    setConfirmChoice,
    setConflict,
    selectProfile,
    startNewProfile,
    saveProfile,
    testConnection,
    syncNow,
    resolveConflict,
  };
}
