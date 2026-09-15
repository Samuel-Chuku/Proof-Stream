'use client';

import { useEffect, useRef, useState } from 'react';

/// WHOSE MERGES COUNT FOR THIS STREAM.
///
/// Empty means anyone, which is how every stream behaved before this existed and
/// is the right default: an employer who has not thought about it should not
/// silently get a stream that refuses the person they hired.
///
/// A MODAL, NOT AN INLINE FIELD. Naming accounts is a list-building job — add,
/// check, remove, add again — and it is the one decision on this form that
/// silently withholds someone's pay if it is wrong. Inline it would sit as a
/// comma-separated string among nine other settings and get half-read. Here the
/// employer sees each name on its own line and has to close the dialog to leave.
///
/// LOGINS ONLY, NEVER EMAIL ADDRESSES. The agent compares against the pull
/// request's `user.login`, so an email can never match and would silently block
/// the very person it was meant to allow. Rejected on entry rather than at
/// deploy, because by deploy the reason is four steps away.
export function AuthorAllowlist({
  authors,
  onChange,
}: {
  authors: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" className="ps-button ps-allow-open" onClick={() => setOpen(true)}>
        {authors.length === 0
          ? '[ ANYONE — NAME SPECIFIC ACCOUNTS ]'
          : `[ ${authors.length} ACCOUNT${authors.length === 1 ? '' : 'S'} — EDIT ]`}
      </button>

      {/* The chosen names belong on the form itself, not only behind the
          dialog. A setting this consequential must be readable without
          reopening anything. */}
      {authors.length > 0 && (
        <ul className="ps-allow-summary">
          {authors.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      )}

      {open && <AllowlistDialog authors={authors} onChange={onChange} onClose={() => setOpen(false)} />}
    </>
  );
}

function AllowlistDialog({
  authors,
  onChange,
  onClose,
}: {
  authors: string[];
  onChange: (next: string[]) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  // Focus lands on the input, and Escape leaves. The point of the dialog is
  // that the employer can work through the list without hunting for the field.
  useEffect(() => {
    input.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  /// Accepts one name or several at once, because the obvious thing to do with
  /// a list of collaborators is paste it.
  function add() {
    const parts = draft
      .split(/[\s,]+/)
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length === 0) return;

    const next = [...authors];
    for (const raw of parts) {
      const problem = reject(raw, next);
      if (problem) {
        setProblem(problem);
        return;
      }
      next.push(raw);
    }
    setProblem(null);
    setDraft('');
    onChange(next);
  }

  return (
    <div className="ps-modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="ps-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Whose merges count"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="ps-modal-head">
          <h2 className="ps-label">WHOSE MERGES COUNT</h2>
          <button type="button" className="ps-chip" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="ps-modal-body">
          <p className="ps-body">
            Only merges opened by these GitHub accounts release money from this stream. Leave it
            empty and any author&apos;s merges are judged.
          </p>

          <div className="ps-allow-entry">
            <input
              ref={input}
              className="ps-input"
              value={draft}
              placeholder="[ github-login ]"
              aria-label="GitHub login"
              onChange={(e) => {
                setDraft(e.target.value);
                setProblem(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  add();
                }
              }}
            />
            <button type="button" className="ps-button" onClick={add}>
              [ ADD ]
            </button>
          </div>

          {problem && <p className="ps-allow-problem">{problem}</p>}

          {authors.length > 0 && (
            <ul className="ps-allow-list">
              {authors.map((a) => (
                <li key={a}>
                  <span>{a}</span>
                  <button
                    type="button"
                    className="ps-chip"
                    aria-label={`Remove ${a}`}
                    onClick={() => onChange(authors.filter((x) => x !== a))}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/* Said here rather than in a tooltip, because someone pairing will
              otherwise assume their partner's merges do not count and open the
              pull request under the wrong account. */}
          <p className="ps-caption">
            Co-authors count too: a merge opened by anyone still releases money if one of these
            accounts is named in a <code>Co-authored-by</code> trailer.
          </p>

          <button type="button" className="ps-button" onClick={onClose}>
            [ DONE ]
          </button>
        </div>
      </div>
    </div>
  );
}

/// Why this name cannot be added, or null.
///
/// Mirrors the validation in `web/lib/create-stream.ts`, which is the authority
/// and runs again at deploy. Repeated here so the reason arrives while the
/// employer is looking at the name, rather than as a blocker at the bottom of
/// the form with the offending entry out of sight.
export function reject(name: string, existing: string[]): string | null {
  if (existing.length >= 16) return 'At most 16 accounts can be named.';
  if (existing.some((e) => e.toLowerCase() === name.toLowerCase())) return `${name} is already named.`;

  // An email is the mistake worth catching by name. The agent matches against
  // the pull request's login, so an address can never match and would silently
  // withhold pay from exactly the person it was added to allow.
  if (name.includes('@')) {
    return 'Use the GitHub username, not an email address — an email can never match.';
  }
  if (!/^[A-Za-z0-9-]{1,39}$/.test(name)) {
    return `"${name}" is not a GitHub username: letters, numbers and hyphens only.`;
  }
  return null;
}
