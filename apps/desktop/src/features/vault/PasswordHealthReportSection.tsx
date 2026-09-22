import { useState } from "react";

import { Button } from "../../components/Button";
import type { DesktopApi } from "../../lib/desktop";
import type {
  PasswordHealthIssueDto,
  PasswordHealthReportDto,
} from "../../types/desktop";
import { Summary } from "./summary";

interface PasswordHealthReportSectionProps {
  api: DesktopApi;
  disabled: boolean;
}

export function PasswordHealthReportSection({
  api,
  disabled,
}: PasswordHealthReportSectionProps) {
  const [report, setReport] = useState<PasswordHealthReportDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const run = async () => {
    if (disabled || loading) return;
    setLoading(true);
    setFailed(false);
    try {
      setReport(await api.getPasswordHealthReport());
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="settings-page" aria-labelledby="settings-report-title">
      <div className="settings-page-heading">
        <p className="eyebrow">Local analysis</p>
        <h3 id="settings-report-title">Password health</h3>
        <p>
          Check active entries for missing, empty, reused, under-policy, or
          locally weak passwords. Password values and reuse fingerprints stay
          inside Rust.
        </p>
      </div>

      <div className="settings-control-card password-health-runner">
        <div>
          <strong>Database report</strong>
          <p>
            Trash is excluded. The 0–4 strength score is a bounded local
            heuristic, not an entropy or crack-time claim, and this check
            contacts no online service.
          </p>
        </div>
        <Button
          size="sm"
          variant="secondary"
          type="button"
          disabled={disabled || loading}
          onClick={() => void run()}
        >
          {loading ? "Checking…" : report === null ? "Run check" : "Run again"}
        </Button>
      </div>

      {failed ? (
        <p role="alert" className="settings-callout">
          Could not build the password health report. You can retry safely.
        </p>
      ) : null}

      {report === null ? null : <PasswordHealthResults report={report} />}
    </section>
  );
}

function PasswordHealthResults({
  report,
}: {
  report: PasswordHealthReportDto;
}) {
  return (
    <div className="password-health-results">
      <dl className="settings-summary-grid">
        <SummaryItem label="Active entries" value={report.totalEntries} />
        <SummaryItem label="With password" value={report.passwordEntries} />
        <SummaryItem label="Entries with issues" value={report.issues.length} />
        <SummaryItem
          label="Length policy"
          value={report.minimumLength}
          suffix="+ chars"
        />
        <SummaryItem
          label="Weak score"
          value={report.weakScoreThreshold}
          suffix="/4 threshold"
        />
      </dl>

      {report.issues.length === 0 ? (
        <p className="settings-callout">
          No local password-health issues were detected by the current checks.
        </p>
      ) : (
        <ul
          className="password-health-list"
          aria-label="Password health issues"
        >
          {report.issues.map((issue) => (
            <li key={issue.entryId}>
              <div className="password-health-entry-title">
                <Summary
                  value={issue.title}
                  missingLabel="Untitled entry"
                  emptyLabel="Empty title"
                />
              </div>
              <div className="password-health-flags">
                {issueLabels(issue, report.minimumLength).map((label) => (
                  <span key={label}>{label}</span>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function issueLabels(
  issue: PasswordHealthIssueDto,
  minimumLength: number,
): string[] {
  const labels: string[] = [];
  if (issue.missingPassword) labels.push("Missing password");
  if (issue.emptyPassword) labels.push("Empty password");
  if (issue.reusedPassword) labels.push("Reused password");
  if (issue.belowMinimumLength)
    labels.push(`Under ${String(minimumLength)} characters`);
  if (issue.weakPassword) labels.push("Weak local score");
  if (issue.strengthScore !== null)
    labels.push(`Local score ${String(issue.strengthScore)}/4`);
  return labels;
}

function SummaryItem({
  label,
  value,
  suffix = "",
}: {
  label: string;
  value: number;
  suffix?: string;
}) {
  return (
    <div className="settings-summary-item">
      <dt>{label}</dt>
      <dd>{`${String(value)}${suffix === "" ? "" : ` ${suffix}`}`}</dd>
    </div>
  );
}
