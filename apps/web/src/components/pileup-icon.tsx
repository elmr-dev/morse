// SPDX-FileCopyrightText: 2026 Mark Percival, John Schult
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Pileup mark — three offset stacks of dashes, evoking a crowd of overlapping
// CW signals (a contest pileup). Stroked with currentColor and sized via
// className so it behaves like a lucide icon.
export function PileupIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <line x1="3" y1="5" x2="7" y2="5" />
      <line x1="3" y1="12" x2="7" y2="12" />
      <line x1="3" y1="19" x2="7" y2="19" />
      <line x1="11" y1="6" x2="15" y2="6" />
      <line x1="12" y1="13" x2="16" y2="13" />
      <line x1="10" y1="18" x2="14" y2="18" />
      <line x1="18" y1="4" x2="21" y2="4" />
      <line x1="19" y1="11" x2="22" y2="11" />
      <line x1="17" y1="16" x2="20" y2="16" />
      <line x1="19" y1="21" x2="22" y2="21" />
    </svg>
  );
}
