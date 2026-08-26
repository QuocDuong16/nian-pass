import { useEffect, useMemo, useRef, useState } from "react";

import type {
  EntryDetailDto,
  GroupDto,
  SelectedVaultDto,
  VaultSnapshotDto,
} from "../../types/desktop";
import type { MobileApi } from "../../types/mobile";
import { EntryList } from "../vault/EntryList";
import { GroupTree } from "../vault/GroupTree";
import { MobileEntryDetail } from "./MobileEntryDetail";
import { MobileLockedView } from "./MobileLockedView";

interface MobileVaultAppProps {
  api: MobileApi;
}

type Phase = "no_selection" | "selected_locked" | "unlocking" | "unlocked";

export function MobileVaultApp({ api }: MobileVaultAppProps) {
  const [phase, setPhase] = useState<Phase>("no_selection");
  const [selected, setSelected] = useState<SelectedVaultDto | null>(null);
  const [password, setPassword] = useState("");
  const [snapshot, setSnapshot] = useState<VaultSnapshotDto | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [detail, setDetail] = useState<EntryDetailDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hidden, setHidden] = useState(document.hidden);
  const detailGeneration = useRef(0);

  useEffect(() => {
    const onVisibility = () => {
      setHidden(document.hidden);
      if (document.hidden) {
        detailGeneration.current += 1;
        setSelectedEntryId(null);
        setDetail(null);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      detailGeneration.current += 1;
      setPassword("");
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  const groupsById = useMemo(
    () => new Map(snapshot?.groups.map((group) => [group.id, group]) ?? []),
    [snapshot],
  );
  const selectedGroup: GroupDto | undefined = groupsById.get(selectedGroupId);
  const entries = useMemo(() => {
    if (snapshot === null || selectedGroup === undefined) return [];
    const ids = new Set(selectedGroup.entryIds);
    return snapshot.entries.filter((entry) => ids.has(entry.id));
  }, [selectedGroup, snapshot]);

  const choose = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const next = await api.selectVault();
      if (next !== null) {
        detailGeneration.current += 1;
        setSelected(next);
        setPassword("");
        setSnapshot(null);
        setDetail(null);
        setSelectedEntryId(null);
        setPhase("selected_locked");
      }
    } catch {
      setError("Could not open the Android document picker.");
    } finally {
      setBusy(false);
    }
  };

  const unlock = async () => {
    if (busy || password.length === 0) return;
    const attempt = password;
    setPassword("");
    setBusy(true);
    setError(null);
    setPhase("unlocking");
    try {
      const next = await api.unlockVault(attempt);
      setSnapshot(next);
      setSelectedGroupId(next.rootGroupId);
      setSelectedEntryId(null);
      setDetail(null);
      setPhase("unlocked");
    } catch {
      setPhase("selected_locked");
      setError(
        "Could not unlock this vault. Check the password or choose another vault.",
      );
    } finally {
      setBusy(false);
    }
  };

  const openEntry = async (entryId: string) => {
    const generation = detailGeneration.current + 1;
    detailGeneration.current = generation;
    setSelectedEntryId(entryId);
    setDetail(null);
    setError(null);
    try {
      const next = await api.getEntryDetail(entryId);
      if (detailGeneration.current === generation) setDetail(next);
    } catch {
      if (detailGeneration.current === generation) {
        setSelectedEntryId(null);
        setError("Could not load that entry.");
      }
    }
  };

  const lock = async () => {
    if (busy) return;
    detailGeneration.current += 1;
    setBusy(true);
    setError(null);
    try {
      await api.lockVault();
      setPassword("");
      setSelected(null);
      setSnapshot(null);
      setSelectedGroupId("");
      setSelectedEntryId(null);
      setDetail(null);
      setPhase("no_selection");
    } catch {
      setError("Could not lock the vault.");
    } finally {
      setBusy(false);
    }
  };

  if (
    phase === "no_selection" ||
    phase === "selected_locked" ||
    phase === "unlocking"
  ) {
    return (
      <MobileLockedView
        selected={selected}
        password={password}
        busy={busy}
        unlocking={phase === "unlocking"}
        error={error}
        onPassword={setPassword}
        onChoose={() => void choose()}
        onUnlock={() => void unlock()}
      />
    );
  }

  if (snapshot === null || selected === null || selectedGroup === undefined)
    return null;
  if (hidden) {
    return (
      <main className="security-shield">
        <section className="security-card">
          <h1>Vault hidden</h1>
          <p>Return to Nian Pass to continue browsing.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="mobile-vault-shell">
      <header className="top-bar mobile-top-bar">
        <div className="product-lockup">
          <div className="brand-mark small" aria-hidden="true">
            N
          </div>
          <div>
            <p className="eyebrow">Android · Read only</p>
            <h1>Nian Pass</h1>
            <p className="mobile-file-name">{selected.fileName}</p>
          </div>
        </div>
        <button
          className="secondary-button lock-button"
          type="button"
          disabled={busy}
          onClick={() => void lock()}
        >
          Lock
        </button>
      </header>
      {error === null ? null : (
        <p className="shell-error" role="alert">
          {error}
        </p>
      )}
      <div className="mobile-vault-layout">
        <GroupTree
          rootGroupId={snapshot.rootGroupId}
          groupsById={groupsById}
          selectedGroupId={selectedGroupId}
          onSelect={(groupId) => {
            detailGeneration.current += 1;
            setSelectedGroupId(groupId);
            setSelectedEntryId(null);
            setDetail(null);
          }}
        />
        <EntryList
          group={selectedGroup}
          entries={entries}
          selectedEntryId={selectedEntryId}
          onSelect={(entryId) => void openEntry(entryId)}
        />
        {detail === null ? (
          <section className="detail-pane detail-empty">
            Select an entry to inspect secret-free metadata.
          </section>
        ) : (
          <MobileEntryDetail detail={detail} />
        )}
      </div>
    </main>
  );
}
