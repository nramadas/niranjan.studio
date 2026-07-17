// Cross-cutting types for the transcript-digest module.

/** One action item extracted from a transcript. */
export interface DigestTodo {
  /** Short imperative sentence, self-contained enough to act on later. */
  readonly text: string;
  /** True when the discussion signalled time pressure; sorts to the top. */
  readonly urgent: boolean;
}

/** Durable facts learned about one meeting participant. */
export interface DigestPerson {
  readonly name: string;
  /** Concerns, priorities, things they care about — 1-5 short strings. */
  readonly facts: ReadonlyArray<string>;
}

/** Everything the digest model pulls out of one transcript. */
export interface TranscriptDigest {
  readonly todos: ReadonlyArray<DigestTodo>;
  readonly people: ReadonlyArray<DigestPerson>;
}
