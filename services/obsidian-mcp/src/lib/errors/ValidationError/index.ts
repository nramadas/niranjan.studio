import { Data } from "effect";

/**
 * Surfaced when a tool input fails schema validation, or when a function
 * is asked to operate on a structurally invalid input that the type
 * system couldn't catch at compile time.
 *
 * @property field   The field that failed validation.
 * @property message Human-readable detail.
 */
export class ValidationError extends Data.TaggedError("ValidationError")<{
  readonly field: string;
  readonly message: string;
}> {}
