export type RunStatus = 'ok' | 'retry' | 'fail';

export type DigestRow = {
  job: string;
  // Owner from the latest event, including an explicitly missing owner.
  owner: string | null;
  // Total valid events for this job; retries are included in runs.
  runs: number;
  retries: number;
  lastStatus: RunStatus;
  // Most recent supplied error; a later success without an error does not clear it.
  lastError: string | null;
  // Earliest/latest event timestamps, preserving the original strings and offsets.
  firstAt: string;
  lastAt: string;
};

export type NightDigest = {
  night: string;
  // One row per job, sorted by job in ascending code-unit order.
  rows: DigestRow[];
  // Nonblank lines rejected because their JSON or event fields are invalid.
  badLines: number;
  // Counts of valid events, not counts of jobs by their final status.
  counts: Record<RunStatus, number>;
};

/**
 * Signature of the synchronous readNight implementation.
 * Reads runsDir/<night>.jsonl; null means the file does not exist.
 * An empty file returns a digest with no rows and zero counts/badLines.
 * Blank lines are ignored; invalid nonblank lines are counted and skipped.
 * Events are ordered by Date.parse(at), with file order breaking timestamp ties.
 * The latest event supplies owner and lastStatus; the latest event with an error
 * supplies lastError. firstAt/lastAt retain the original timestamp strings.
 * Other filesystem errors propagate instead of being reported as missing data.
 */
export type ReadNight = (runsDir: string, night: string) => NightDigest | null;
