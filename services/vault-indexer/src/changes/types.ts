/**
 * The unit of work the queue carries: a CouchDB doc id (note path proxy
 * after id→path resolution) plus the most-recent change timestamp the
 * debounce timer uses to decide when to fire.
 */
export interface PendingReindex {
  readonly docId: string;
  readonly notePath: string;
  readonly lastSeenMs: number;
}
