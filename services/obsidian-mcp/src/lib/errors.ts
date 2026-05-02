// Tagged errors used across the service. Each one carries enough context
// that an MCP client (and the operator reading logs) can tell which layer
// failed. Effect's `Data.TaggedError` gives us discriminated unions and a
// constructor that takes the structured payload.

import { Data } from "effect";

export class CouchDbError extends Data.TaggedError("CouchDbError")<{
  readonly op: string;
  readonly status?: number;
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class NoteNotFoundError extends Data.TaggedError("NoteNotFoundError")<{
  readonly path: string;
}> {}

export class NoteConflictError extends Data.TaggedError("NoteConflictError")<{
  readonly path: string;
  readonly message: string;
}> {}

export class DecryptionError extends Data.TaggedError("DecryptionError")<{
  readonly docId: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class EncryptionError extends Data.TaggedError("EncryptionError")<{
  readonly path: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class AuthError extends Data.TaggedError("AuthError")<{
  readonly reason: string;
  readonly statusCode: 401 | 403;
}> {}

export class ValidationError extends Data.TaggedError("ValidationError")<{
  readonly field: string;
  readonly message: string;
}> {}

export class ChangesFeedError extends Data.TaggedError("ChangesFeedError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}
