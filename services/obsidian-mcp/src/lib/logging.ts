// Cloud Run reads stdout as JSON when each line is a JSON object with a
// `severity` field. We emit single-line JSON; correlations like the Cloud
// Trace header are picked up automatically by Cloud Logging when present.

import { HashMap, List, Logger, LogLevel } from "effect";

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

export { LogLevel };
