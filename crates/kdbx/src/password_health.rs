use std::collections::HashMap;

use keepass::db::fields;
use sha2::{Digest, Sha256};
use vault_core::{EntryId, GroupId, SummaryText};

use crate::{
    KdbxDocument, project_summary_text,
    recycle_bin::{group_is_in_recycle_bin, recycle_bin_id},
};

/// Minimum password length used by the local policy report.
///
/// This remains a separate policy rule from the bounded local strength heuristic.
pub const PASSWORD_POLICY_MIN_LENGTH: usize = 12;

/// Scores below this value are reported as weak by the local 0-4 heuristic.
pub const PASSWORD_STRENGTH_WEAK_BELOW: u8 = 3;

/// Secret-free password-health metadata for one entry.
#[derive(Clone, Eq, PartialEq)]
pub struct PasswordHealthIssue {
    entry_id: EntryId,
    group_id: GroupId,
    title: SummaryText,
    missing_password: bool,
    empty_password: bool,
    reused_password: bool,
    below_minimum_length: bool,
    weak_password: bool,
    strength_score: Option<u8>,
}

impl PasswordHealthIssue {
    #[must_use]
    pub const fn entry_id(&self) -> &EntryId {
        &self.entry_id
    }

    #[must_use]
    pub const fn group_id(&self) -> &GroupId {
        &self.group_id
    }

    #[must_use]
    pub const fn title(&self) -> &SummaryText {
        &self.title
    }

    #[must_use]
    pub const fn missing_password(&self) -> bool {
        self.missing_password
    }

    #[must_use]
    pub const fn empty_password(&self) -> bool {
        self.empty_password
    }

    #[must_use]
    pub const fn reused_password(&self) -> bool {
        self.reused_password
    }

    #[must_use]
    pub const fn below_minimum_length(&self) -> bool {
        self.below_minimum_length
    }

    #[must_use]
    pub const fn weak_password(&self) -> bool {
        self.weak_password
    }

    /// Returns the bounded local strength score when a password field exists.
    ///
    /// This is a heuristic score, not an entropy measurement or crack-time promise.
    #[must_use]
    pub const fn strength_score(&self) -> Option<u8> {
        self.strength_score
    }
}

/// Database-local password-health analysis with no password or fingerprint in
/// the public result.
#[derive(Clone, Eq, PartialEq)]
pub struct PasswordHealthReport {
    total_entries: usize,
    password_entries: usize,
    issues: Vec<PasswordHealthIssue>,
}

impl PasswordHealthReport {
    #[must_use]
    pub const fn total_entries(&self) -> usize {
        self.total_entries
    }

    #[must_use]
    pub const fn password_entries(&self) -> usize {
        self.password_entries
    }

    #[must_use]
    pub fn issues(&self) -> &[PasswordHealthIssue] {
        &self.issues
    }
}

struct Candidate {
    entry_id: EntryId,
    group_id: GroupId,
    title: SummaryText,
    missing_password: bool,
    empty_password: bool,
    below_minimum_length: bool,
    weak_password: bool,
    strength_score: Option<u8>,
    fingerprint: Option<[u8; 32]>,
}

fn local_password_strength_score(password: &str, user_inputs: [&str; 3]) -> u8 {
    if password.is_empty() {
        return 0;
    }

    let length = password.chars().count();
    let mut score: u8 = match length {
        0..=7 => 0,
        8..=11 => 1,
        12..=15 => 2,
        16..=19 => 3,
        _ => 4,
    };

    let mut lower = false;
    let mut upper = false;
    let mut digit = false;
    let mut other = false;
    for character in password.chars() {
        lower |= character.is_lowercase();
        upper |= character.is_uppercase();
        digit |= character.is_numeric();
        other |= !character.is_alphanumeric();
    }
    let classes = u8::from(lower) + u8::from(upper) + u8::from(digit) + u8::from(other);
    if length >= 12 && classes >= 3 {
        score = score.saturating_add(1).min(4);
    }

    const COMMON: [&str; 10] = [
        "password",
        "password1",
        "12345678",
        "123456789",
        "qwerty",
        "qwerty123",
        "letmein",
        "welcome",
        "admin",
        "iloveyou",
    ];
    if COMMON
        .iter()
        .any(|common| password.eq_ignore_ascii_case(common))
        || is_single_repeated_character(password)
    {
        return 0;
    }

    if has_short_repeating_period(password) || is_ascii_sequence(password) {
        score = score.min(1);
    }
    if classes <= 1 {
        score = score.min(2);
    }
    if user_inputs
        .into_iter()
        .any(|input| input.chars().count() >= 4 && contains_case_insensitive(password, input))
    {
        score = score.saturating_sub(1).min(2);
    }
    score
}

fn is_single_repeated_character(value: &str) -> bool {
    let mut characters = value.chars();
    let Some(first) = characters.next() else {
        return false;
    };
    characters.all(|character| character == first)
}

fn has_short_repeating_period(value: &str) -> bool {
    let bytes = value.as_bytes();
    (1..=4).any(|period| {
        bytes.len() >= period * 3
            && bytes
                .iter()
                .enumerate()
                .all(|(index, byte)| *byte == bytes[index % period])
    })
}

fn is_ascii_sequence(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() < 4 || !bytes.iter().all(u8::is_ascii_alphanumeric) {
        return false;
    }
    bytes
        .windows(2)
        .all(|pair| pair[1] == pair[0].wrapping_add(1))
        || bytes
            .windows(2)
            .all(|pair| pair[0] == pair[1].wrapping_add(1))
}

fn contains_case_insensitive(value: &str, needle: &str) -> bool {
    if needle.is_ascii() && value.is_ascii() {
        let needle = needle.as_bytes();
        return value.as_bytes().windows(needle.len()).any(|window| {
            window
                .iter()
                .zip(needle)
                .all(|(left, right)| left.eq_ignore_ascii_case(right))
        });
    }
    value.contains(needle)
}

impl KdbxDocument {
    /// Analyzes active entries entirely inside the KDBX boundary.
    ///
    /// Recycled entries are excluded. Password plaintext and reuse fingerprints
    /// never leave this function; the result contains only navigation metadata,
    /// bounded local strength scores, and issue categories.
    #[must_use]
    pub fn password_health_report(&self) -> PasswordHealthReport {
        let recycle_id = recycle_bin_id(&self.database);
        let mut candidates = Vec::new();
        let mut fingerprint_counts = HashMap::<[u8; 32], usize>::new();
        let mut password_entries = 0;

        for entry in self.database.iter_all_entries() {
            let parent_id = entry.parent().id();
            if recycle_id
                .is_some_and(|recycle| group_is_in_recycle_bin(&self.database, parent_id, recycle))
            {
                continue;
            }

            let password = entry.fields.get(fields::PASSWORD).map(|value| value.get());
            let missing_password = password.is_none();
            let empty_password = password.is_some_and(|value| value.is_empty());
            let below_minimum_length = password.is_some_and(|value| {
                !value.is_empty() && value.chars().count() < PASSWORD_POLICY_MIN_LENGTH
            });
            let strength_score = password.map(|value| {
                local_password_strength_score(
                    value,
                    [
                        entry
                            .fields
                            .get(fields::TITLE)
                            .map_or("", |field| field.get()),
                        entry
                            .fields
                            .get(fields::USERNAME)
                            .map_or("", |field| field.get()),
                        entry
                            .fields
                            .get(fields::URL)
                            .map_or("", |field| field.get()),
                    ],
                )
            });
            let weak_password = password.is_some_and(|value| {
                !value.is_empty()
                    && strength_score.is_some_and(|score| score < PASSWORD_STRENGTH_WEAK_BELOW)
            });
            let fingerprint = password.filter(|value| !value.is_empty()).map(|value| {
                let digest = Sha256::digest(value.as_bytes());
                <[u8; 32]>::from(digest)
            });
            if password.is_some() {
                password_entries += 1;
            }
            if let Some(fingerprint) = fingerprint {
                *fingerprint_counts.entry(fingerprint).or_default() += 1;
            }
            candidates.push(Candidate {
                entry_id: EntryId::new(entry.id().to_string()),
                group_id: GroupId::new(parent_id.to_string()),
                title: project_summary_text(entry.fields.get(fields::TITLE)),
                missing_password,
                empty_password,
                below_minimum_length,
                weak_password,
                strength_score,
                fingerprint,
            });
        }

        let total_entries = candidates.len();
        let issues = candidates
            .into_iter()
            .filter_map(|candidate| {
                let reused_password = candidate
                    .fingerprint
                    .is_some_and(|fingerprint| fingerprint_counts[&fingerprint] > 1);
                if !candidate.missing_password
                    && !candidate.empty_password
                    && !candidate.below_minimum_length
                    && !candidate.weak_password
                    && !reused_password
                {
                    return None;
                }
                Some(PasswordHealthIssue {
                    entry_id: candidate.entry_id,
                    group_id: candidate.group_id,
                    title: candidate.title,
                    missing_password: candidate.missing_password,
                    empty_password: candidate.empty_password,
                    reused_password,
                    below_minimum_length: candidate.below_minimum_length,
                    weak_password: candidate.weak_password,
                    strength_score: candidate.strength_score,
                })
            })
            .collect();

        PasswordHealthReport {
            total_entries,
            password_entries,
            issues,
        }
    }
}

#[cfg(test)]
mod tests {
    use keepass::db::fields;
    use vault_core::{EntryId, SummaryText};

    use super::{
        PASSWORD_POLICY_MIN_LENGTH, PASSWORD_STRENGTH_WEAK_BELOW, PasswordHealthIssue,
        local_password_strength_score,
    };
    use crate::KdbxDocument;

    fn add_entry(
        document: &mut KdbxDocument,
        title: &str,
        password: Option<&str>,
        protected_title: bool,
    ) -> EntryId {
        let id = {
            let mut root = document.database.root_mut();
            let mut entry = root.add_entry();
            if protected_title {
                entry.set_protected(fields::TITLE, title);
            } else {
                entry.set_unprotected(fields::TITLE, title);
            }
            if let Some(password) = password {
                entry.set_protected(fields::PASSWORD, password);
            }
            entry.id()
        };
        EntryId::new(id.to_string())
    }

    fn issue<'a>(issues: &'a [PasswordHealthIssue], id: &EntryId) -> &'a PasswordHealthIssue {
        issues
            .iter()
            .find(|issue| issue.entry_id() == id)
            .expect("expected health issue")
    }

    #[test]
    fn local_strength_score_is_bounded_context_aware_and_pattern_sensitive() {
        assert_eq!(
            local_password_strength_score("aaaaaaaaaaaaaaaaaaaa", ["", "", ""]),
            0
        );
        assert_eq!(
            local_password_strength_score("abcabcabcabcabcabc", ["", "", ""]),
            1
        );
        assert_eq!(
            local_password_strength_score("M8&vQ2!zR7#kL4@pX9", ["", "", ""]),
            4
        );
        assert!(
            local_password_strength_score(
                "alice-account-2026!",
                ["Alice account", "alice", "https://example.test"],
            ) < PASSWORD_STRENGTH_WEAK_BELOW
        );
    }

    #[test]
    fn report_is_secret_free_distinguishes_local_issues_and_excludes_trash() {
        let mut document = KdbxDocument::new("Health report");
        let strong = add_entry(
            &mut document,
            "Strong",
            Some("unique-password-that-is-long"),
            false,
        );
        let reused_a = add_entry(
            &mut document,
            "Reuse A",
            Some("shared-password-value"),
            false,
        );
        let reused_b = add_entry(
            &mut document,
            "Reuse B",
            Some("shared-password-value"),
            false,
        );
        let short = add_entry(&mut document, "Protected short", Some("tiny-pass"), true);
        let weak_long = add_entry(
            &mut document,
            "Weak pattern",
            Some("aaaaaaaaaaaaaaaaaaaa"),
            false,
        );
        let empty = add_entry(&mut document, "Empty", Some(""), false);
        let missing = add_entry(&mut document, "Missing", None, false);
        let recycled = add_entry(&mut document, "Recycled", Some("tiny"), false);
        document
            .trash_entry(&recycled)
            .expect("fixture entry should move to trash");

        let report = document.password_health_report();
        assert_eq!(PASSWORD_POLICY_MIN_LENGTH, 12);
        assert_eq!(report.total_entries(), 7);
        assert_eq!(report.password_entries(), 6);
        assert_eq!(report.issues().len(), 6);
        assert!(
            !report
                .issues()
                .iter()
                .any(|candidate| candidate.entry_id() == &strong)
        );
        assert!(
            !report
                .issues()
                .iter()
                .any(|candidate| candidate.entry_id() == &recycled)
        );

        for id in [&reused_a, &reused_b] {
            let reused = issue(report.issues(), id);
            assert!(reused.reused_password());
            assert!(!reused.missing_password());
            assert!(!reused.empty_password());
            assert!(!reused.below_minimum_length());
            assert!(reused.strength_score().is_some());
        }

        let short_issue = issue(report.issues(), &short);
        assert!(short_issue.below_minimum_length());
        assert!(matches!(short_issue.title(), SummaryText::Protected));
        assert!(!short_issue.reused_password());
        assert!(short_issue.weak_password());
        assert!(short_issue.strength_score().is_some_and(|score| score < 3));

        let weak_long_issue = issue(report.issues(), &weak_long);
        assert!(weak_long_issue.weak_password());
        assert_eq!(weak_long_issue.strength_score(), Some(0));
        assert!(!weak_long_issue.below_minimum_length());

        let empty_issue = issue(report.issues(), &empty);
        assert!(empty_issue.empty_password());
        assert!(!empty_issue.below_minimum_length());
        assert!(!empty_issue.reused_password());
        assert!(!empty_issue.weak_password());
        assert_eq!(empty_issue.strength_score(), Some(0));

        let missing_issue = issue(report.issues(), &missing);
        assert!(missing_issue.missing_password());
        assert!(!missing_issue.empty_password());
        assert!(!missing_issue.below_minimum_length());
        assert!(!missing_issue.reused_password());
        assert!(!missing_issue.weak_password());
        assert_eq!(missing_issue.strength_score(), None);
    }
}
