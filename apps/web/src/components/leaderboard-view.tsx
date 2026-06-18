// SPDX-FileCopyrightText: 2026 Mark Percival, John Schult
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Loader2, Search, ShieldCheck, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type {
  LeaderboardBoard,
  LeaderboardRow,
  LeaderboardRowTag,
  LeaderboardSegment,
} from '@/lib/leaderboard';

const qrzUrl = (call: string) =>
  `https://www.qrz.com/db/${encodeURIComponent(call)}`;

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
        className="w-full rounded-lg border border-border bg-card px-9 py-2 font-mono text-[14px] uppercase tracking-wider outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
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
  const activeLabel = segments.find((s) => s.id === activeId)?.label;
  return (
    <div
      role="radiogroup"
      aria-label="Board segment"
      className="flex w-full items-center gap-1 rounded-lg border border-border bg-muted p-1"
    >
      <div className="flex items-stretch gap-1 sm:flex-1">
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
              aria-label={seg.label}
              onClick={() => onChange(seg.id)}
              className={`sm:flex-1 inline-flex min-h-11 sm:min-h-9 items-center justify-center gap-1.5 rounded-md px-3 py-2 text-[13px] font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${
                active
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {Icon && (
                <Icon
                  className="size-4 shrink-0"
                  style={seg.accent ? { color: seg.accent } : undefined}
                />
              )}
              <span className="hidden sm:inline">{seg.label}</span>
            </button>
          );
        })}
      </div>
      {activeLabel && (
        <span
          aria-hidden="true"
          className="sm:hidden ml-auto pr-3 pl-1 text-[13px] font-medium text-foreground"
        >
          {activeLabel}
        </span>
      )}
    </div>
  );
}

function PagedList({
  board,
  segmentId,
  search,
  ownCallSign,
  reloadToken,
}: {
  board: LeaderboardBoard;
  segmentId: string | undefined;
  search: string;
  ownCallSign: string | null;
  reloadToken: number;
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

  // Pin the own-row above the list only when it isn't already in the visible
  // top-N. An inline highlight is enough when it is.
  const ownVisible =
    ownRow !== null &&
    rows.some((r) => r.callSign === ownRow.callSign && r.rank === ownRow.rank);
  const pinnedRow = ownRow && !ownVisible ? ownRow : null;

  return (
    <div className="flex flex-col gap-3">
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
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-16 text-muted-foreground text-[11px] font-medium uppercase tracking-wide">
              Rank
            </TableHead>
            <TableHead className="text-muted-foreground text-[11px] font-medium uppercase tracking-wide">
              Callsign
            </TableHead>
            <TableHead className="text-muted-foreground text-[11px] font-medium uppercase tracking-wide">
              Tier
            </TableHead>
            <TableHead className="w-20 text-right text-muted-foreground text-[11px] font-medium uppercase tracking-wide">
              Score
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {pinnedRow && <Row row={pinnedRow} isOwn pinned />}
          {rows.map((row) => (
            <Row
              key={`${row.callSign}-${row.rank}-${row.updatedAt}`}
              row={row}
              isOwn={
                !!ownCallSign &&
                row.callSign.toUpperCase() === ownCallSign.toUpperCase()
              }
            />
          ))}
        </TableBody>
      </Table>
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
    <TableRow
      aria-label={`${pinned ? 'You, ' : ''}rank ${row.rank}, ${row.callSign}${
        row.tag ? `, ${row.tag.label}` : ''
      }${row.verified ? ', verified' : ''}, ${row.scoreLabel}`}
      data-own={isOwn ? 'true' : undefined}
      className={
        isOwn
          ? 'bg-primary/15 hover:bg-primary/20 data-[own=true]:border-b-primary/20'
          : undefined
      }
    >
      <TableCell
        className={`font-mono text-[13px] tabular-nums ${
          pinned ? 'text-primary font-semibold' : 'text-muted-foreground'
        }`}
      >
        {pinned ? `You · #${row.rank}` : `#${row.rank}`}
      </TableCell>
      <TableCell>
        <span className="inline-flex items-center gap-1.5 font-mono text-[15px] font-medium text-foreground">
          {row.verified ? (
            <a
              href={qrzUrl(row.callSign)}
              target="_blank"
              rel="noreferrer"
              className="truncate outline-none rounded-sm hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
              title={`View ${row.callSign} on QRZ`}
            >
              {row.callSign}
            </a>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={`${row.callSign} — not verified`}
                  className="truncate text-left font-mono font-medium text-foreground outline-none rounded-sm decoration-dotted decoration-muted-foreground/60 underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  {row.callSign}
                </button>
              </TooltipTrigger>
              <TooltipContent>
                <span>
                  This callsign hasn't been verified yet.{' '}
                  <Link
                    to="/faq#verified-badge"
                    className="underline underline-offset-2"
                  >
                    Learn more
                  </Link>
                  .
                </span>
              </TooltipContent>
            </Tooltip>
          )}
          {row.verified && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label="Verified callsign"
                  className="shrink-0 inline-flex outline-none rounded-sm text-verified focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  <ShieldCheck className="size-4.5" aria-hidden="true" />
                </button>
              </TooltipTrigger>
              <TooltipContent>
                <span>
                  Verified callsign via QRZ bio.{' '}
                  <Link
                    to="/faq#verified-badge"
                    className="underline underline-offset-2"
                  >
                    Learn more
                  </Link>
                  .
                </span>
              </TooltipContent>
            </Tooltip>
          )}
        </span>
      </TableCell>
      <TableCell>{row.tag && <TagPill tag={row.tag} />}</TableCell>
      <TableCell className="text-right font-mono text-[16px] font-semibold tabular-nums text-foreground">
        {row.scoreLabel}
      </TableCell>
    </TableRow>
  );
}
