import type { SyncProfileDto } from "../../lib/sync";

interface SyncProfileSelectProps {
  profiles: SyncProfileDto[];
  selectedId: string | null;
  busy: boolean;
  embedded: boolean;
  onNew: () => void;
  onSelect: (profile: SyncProfileDto) => void;
}

export function SyncProfileSelect({
  profiles,
  selectedId,
  busy,
  embedded,
  onNew,
  onSelect,
}: SyncProfileSelectProps) {
  const select = (
    <select
      aria-label="Saved sync profile"
      value={selectedId ?? ""}
      disabled={busy}
      onChange={(event) => {
        if (event.target.value === "") {
          onNew();
          return;
        }
        const profile = profiles.find(
          (candidate) => candidate.profileId === event.target.value,
        );
        if (profile !== undefined) onSelect(profile);
      }}
    >
      <option value="">New profile</option>
      {profiles.map((profile) => (
        <option key={profile.profileId} value={profile.profileId}>
          {profile.target.provider === "webdav"
            ? "WebDAV"
            : profile.target.provider === "s3"
              ? "S3 / compatible"
              : "Nian Pass Gateway"}
          {profile.available ? "" : " (different vault)"}
        </option>
      ))}
    </select>
  );

  if (embedded) {
    return (
      <label className="form-field sync-profile-picker">
        Sync profile
        {select}
      </label>
    );
  }

  return (
    <div className="section-heading-row">
      <div>
        <p className="eyebrow">Desktop explicit sync</p>
        <h2 id="sync-heading">Sync</h2>
      </div>
      {select}
    </div>
  );
}
