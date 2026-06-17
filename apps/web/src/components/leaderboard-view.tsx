// SPDX-FileCopyrightText: 2026 Mark Percival, John Schult
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Loader2, Search, ShieldCheck, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { NavLink } from 'react-router-dom';
import type {
  LeaderboardBoard,
  LeaderboardRow,
  LeaderboardRowTag,
  LeaderboardSegment,
} from '@/lib/leaderboard';

interface Props {
  board: LeaderboardBoard;
  ownCallSign: string | null;
  /** Bump to refetch in the background (e.g. after a sync pushed fresh
   *  bests up to the server). */
  reloadToken?: number;
}

// Hard cap. No "Show more" — the leaderboard shows the top N, with a pinned
// own-row above when the viewer is below it. Search broadens visibility for
// finding a specific callsign past the cap.
const TOP_N = 25;
const SEARCH_DEBOUNCE_MS = 200;

export default function LeaderboardView({
  board,
  ownCallSign,
  reloadToken = 0,
}: Props) {
  const segments = board.segments;
  const initialSeg = board.defaultSegmentId ?? segments?.[0]?.id;
  const [activeSegmentId, setActiveSegmentId] = useState<string | undefined>(
    initialSeg
  );

  // Live input vs the debounced query that actually drives fetches.
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  useEffect(() => {
    const id = window.setTimeout(
      () => setSearch(searchInput.trim()),
      SEARCH_DEBOUNCE_MS
    );
    return () => window.clearTimeout(id);
  }, [searchInput]);

  return (
    <div className="flex flex-col gap-4">
      <SearchInput value={searchInput} onChange={setSearchInput} />
      {segments && (
        <SegmentSelector
          segments={segments}
          activeId={activeSegmentId}
          onChange={setActiveSegmentId}
        />
      )}
      <PagedList
        board={board}
        segmentId={activeSegmentId}
        search={search}
        ownCallSign={ownCallSign}
        reloadToken={reloadToken}
        segments={segments}
      />
    </div>
  );
}

function SearchInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="relative">
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search callsign"
        aria-label="Search callsign"
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        className="w-full rounded-lg border border-border bg-background px-9 py-2 font-mono text-[14px] uppercase tracking-wider outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Clear search"
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

function SegmentSelector({
  segments,
  activeId,
  onChange,
}: {
  segments: LeaderboardSegment[];
  activeId: string | undefined;
  onChange: (id: string) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Board segment"
      className="grid grid-cols-2 sm:grid-cols-5 gap-2"
    >
      {segments.map((seg) => {
        const active = seg.id === activeId;
        const Icon = seg.icon;
        return (
          // biome-ignore lint/a11y/useSemanticElements: segmented single-select; role="radio" buttons give the right "1 of N selected" semantics without native radio styling
          <button
            key={seg.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(seg.id)}
            style={
              active && seg.accent
                ? {
                    borderColor: seg.accent,
                    boxShadow: `0 0 0 1px ${seg.accent}`,
                    backgroundColor: `color-mix(in oklch, ${seg.accent} 8%, transparent)`,
                  }
                : undefined
            }
            className={`inline-flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-[13px] font-medium transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${
              active
                ? 'text-foreground'
                : 'border-border/50 bg-background text-muted-foreground hover:border-border hover:bg-muted/30 hover:text-foreground'
            }`}
          >
            {Icon && (
              <Icon
                className="size-4 shrink-0"
                style={seg.accent ? { color: seg.accent } : undefined}
              />
            )}
            {seg.label}
          </button>
        );
      })}
    </div>
  );
}

function PagedList({
  board,
  segmentId,
  search,
  ownCallSign,
  reloadToken,
  segments,
}: {
  board: LeaderboardBoard;
  segmentId: string | undefined;
  search: string;
  ownCallSign: string | null;
  reloadToken: number;
  segments?: LeaderboardSegment[];
}) {
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [ownRow, setOwnRow] = useState<LeaderboardRow | null>(null);
  const [loading, setLoading] = useState(true);

  // Mirror row count into a ref so we can choose cold-load vs silent-refetch
  // without listing it as a dep (we don't want changes to rows to retrigger).
  const requestSeqRef = useRef(0);
  const hasRowsRef = useRef(false);
  hasRowsRef.current = rows.length > 0;

  useEffect(() => {
    // reloadToken is read for its trigger value only — bumping it (e.g.
    // after a sync) re-runs this effect even though we don't use the value.
    void reloadToken;
    const seq = ++requestSeqRef.current;
    if (!hasRowsRef.current) setLoading(true);
    board
      .load({ segmentId, search, offset: 0, limit: TOP_N })
      .then((page) => {
        if (seq !== requestSeqRef.current) return;
        setRows(page.rows);
      })
      .catch(() => {
        if (seq !== requestSeqRef.current) return;
        setRows([]);
      })
      .finally(() => {
        if (seq !== requestSeqRef.current) return;
        setLoading(false);
      });
  }, [board, segmentId, search, reloadToken]);

  // Own-row lookup runs independently. Only fires when we have a callsign
  // and the adapter supports it; skipped during search (the rows themselves
  // are filtered to the viewer's match).
  useEffect(() => {
    if (!ownCallSign || !board.findRow || search) {
      setOwnRow(null);
      return;
    }
    // reloadToken: refresh own row alongside the list after a sync.
    void reloadToken;
    let cancelled = false;
    void board.findRow(ownCallSign, segmentId).then((r) => {
      if (cancelled) return;
      setOwnRow(r);
    });
    return () => {
      cancelled = true;
    };
  }, [board, ownCallSign, segmentId, search, reloadToken]);

  const activeSegment = segments?.find((s) => s.id === segmentId);

  // Pin the own-row above the list only when it isn't already in the visible
  // top-N. An inline highlight is enough when it is.
  const ownVisible =
    ownRow !== null &&
    rows.some((r) => r.callSign === ownRow.callSign && r.rank === ownRow.rank);
  const pinnedRow = ownRow && !ownVisible ? ownRow : null;

  return (
    <div className="flex flex-col gap-3">
      {activeSegment?.context && !search && (
        <p className="text-center text-[12px] text-muted-foreground">
          {activeSegment.context}
        </p>
      )}
      {loading ? (
        <Spinner label="Loading standings" />
      ) : (
        <Rows
          rows={rows}
          ownCallSign={ownCallSign}
          searchActive={!!search}
          pinnedRow={pinnedRow}
        />
      )}
      {!loading && !search && ownCallSign && !ownRow && (
        <UnrankedNudge segmentId={segmentId} />
      )}
    </div>
  );
}

// "All" is a synthetic segment — there's no specific tier to drop the user
// into, so the CTA just deep-links to the BtB page with no override.
const ALL_SEGMENT_ID = 'all';

function UnrankedNudge({ segmentId }: { segmentId: string | undefined }) {
  const isTier = segmentId && segmentId !== ALL_SEGMENT_ID;
  const to = isTier ? `/beat-the-bot?tier=${segmentId}` : '/beat-the-bot';
  return (
    <p className="text-center text-[12px] text-muted-foreground">
      You haven't ranked here yet —{' '}
      <NavLink
        to={to}
        className="text-foreground underline-offset-2 hover:underline"
      >
        play a round
      </NavLink>
      .
    </p>
  );
}

function Spinner({ label }: { label: string }) {
  return (
    <div
      className="flex items-center justify-center py-8 text-muted-foreground"
      role="status"
      aria-label={label}
    >
      <Loader2 className="size-5 animate-spin" aria-hidden="true" />
    </div>
  );
}

function Rows({
  rows,
  ownCallSign,
  searchActive,
  pinnedRow,
}: {
  rows: LeaderboardRow[];
  ownCallSign: string | null;
  searchActive: boolean;
  pinnedRow: LeaderboardRow | null;
}) {
  if (rows.length === 0 && !pinnedRow) {
    if (searchActive) {
      return (
        <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          No callsigns match.
        </div>
      );
    }
    return (
      <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
        No entries yet —{' '}
        <NavLink
          to="/beat-the-bot"
          className="text-foreground underline-offset-2 hover:underline"
        >
          be the first
        </NavLink>
        .
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {pinnedRow && (
        <ol className="list-none p-0 m-0" aria-label="Your rank (pinned)">
          <Row row={pinnedRow} isOwn pinned />
        </ol>
      )}
      <ol className="list-none p-0 m-0 flex flex-col gap-1">
        {rows.map((row) => (
          <Row
            key={`${row.callSign}-${row.rank}-${row.updatedAt}`}
            row={row}
            isOwn={row.callSign === ownCallSign}
          />
        ))}
      </ol>
    </div>
  );
}

function TagPill({ tag }: { tag: LeaderboardRowTag }) {
  const Icon = tag.icon;
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium"
      style={
        tag.accent
          ? {
              borderColor: `color-mix(in oklch, ${tag.accent} 40%, transparent)`,
              backgroundColor: `color-mix(in oklch, ${tag.accent} 10%, transparent)`,
              color: tag.accent,
            }
          : undefined
      }
    >
      {Icon && <Icon className="size-3" />}
      <span className="hidden sm:inline">{tag.label}</span>
    </span>
  );
}

function Row({
  row,
  isOwn = false,
  pinned = false,
}: {
  row: LeaderboardRow;
  isOwn?: boolean;
  pinned?: boolean;
}) {
  return (
    <li
      aria-label={`${pinned ? 'You, ' : ''}rank ${row.rank}, ${row.callSign}${
        row.tag ? `, ${row.tag.label}` : ''
      }${row.verified ? ', verified' : ''}, ${row.scoreLabel}`}
      className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${
        isOwn
          ? 'border-primary/60 bg-primary/5 ring-1 ring-primary/30'
          : 'border-border/50 bg-background'
      }`}
    >
      <span
        className={`shrink-0 text-right font-mono text-[13px] tabular-nums ${
          pinned ? 'text-primary w-auto' : 'text-muted-foreground w-10'
        }`}
      >
        {pinned ? `You · #${row.rank}` : `#${row.rank}`}
      </span>
      <span className="flex-1 min-w-0 inline-flex items-center gap-1.5 font-mono text-[15px] font-medium text-foreground">
        <span className="truncate">{row.callSign}</span>
        {row.verified && (
          <ShieldCheck
            className="size-4 shrink-0 text-primary"
            aria-hidden="true"
          />
        )}
      </span>
      {row.tag && <TagPill tag={row.tag} />}
      <span className="w-14 shrink-0 text-right font-mono text-[16px] font-semibold tabular-nums text-foreground">
        {row.scoreLabel}
      </span>
    </li>
  );
}
