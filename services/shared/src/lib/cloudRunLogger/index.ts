import { HashMap, List, LogLevel, Logger } from "effect";

type Severity = "DEBUG" | "INFO" | "WARNING" | "ERROR" | "CRITICAL";

const severityFor = (level: LogLevel.LogLevel): Severity => {
  switch (level._tag) {
    case "Debug":
    case "Trace":
      return "DEBUG";
    case "Info":
      return "INFO";
    case "Warning":
      return "WARNING";
    case "Error":
      return "ERROR";
    case "Fatal":
      return "CRITICAL";
    default:
      return "INFO";
  }
};

/**
 * An Effect Logger that emits one JSON object per log line in the format
 * Cloud Logging consumes natively. Each line carries a `severity` field
 * so Cloud Logging colourises and filters correctly without an explicit
 * sink configuration.
 *
 * Wire it into a runtime with `Logger.replace(Logger.defaultLogger, cloudRunLogger)`.
 */
export const cloudRunLogger = Logger.make(({ logLevel, message, annotations, spans }) => {
  const payload: Record<string, unknown> = {
    severity: severityFor(logLevel),
    message: Array.isArray(message) ? message.join(" ") : String(message),
    timestamp: new Date().toISOString(),
  };
  const annotationCount = HashMap.size(annotations);
  if (annotationCount > 0) {
    const obj: Record<string, unknown> = {};
    HashMap.forEach(annotations, (v, k) => {
      obj[k] = v;
    });
    payload.annotations = obj;
  }
  const spanArr = Array.from(List.toArray(spans));
  if (spanArr.length > 0) {
    payload.spans = spanArr.map((s) => ({ label: s.label, startTime: s.startTime }));
  }
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(payload));
});
