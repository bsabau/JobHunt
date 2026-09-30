// Writes an iCalendar file (RFC 5545) for one interview. Pure, so
// tests/ics.test.mjs loads it straight from Node.

export interface InterviewEvent {
  // Stable per application and host, so a second download updates the same
  // calendar entry instead of adding another.
  uid: string;
  // When the file was made (the request's clock).
  stamp: Date;
  summary: string;
  url: string | null;
  // A whole day ("YYYY-MM-DD") when no time is set, else the start and length.
  when: { date: string } | { start: Date; minutes: number };
}

// Text values escape backslash, semicolon, comma and line breaks.
export function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

// Lines longer than 75 octets continue on lines that start with a space. The
// limit is in bytes of UTF-8, and a character is never split across lines.
export function foldLine(line: string): string {
  const encoder = new TextEncoder();
  const parts: string[] = [];
  let current = "";
  let currentBytes = 0;
  let limit = 75;
  for (const char of line) {
    const bytes = encoder.encode(char).length;
    if (currentBytes + bytes > limit) {
      parts.push(current);
      current = "";
      currentBytes = 0;
      limit = 74; // the leading space takes one octet
    }
    current += char;
    currentBytes += bytes;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

function utcStamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

// "2026-10-05" as "20261005", and the day after for an all-day DTEND, by
// UTC arithmetic on the parts (never new Date(string) on a date).
function dateValue(date: string, addDays = 0): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + addDays)).toISOString().slice(0, 10).replace(/-/g, "");
}

export function interviewCalendar(event: InterviewEvent): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//JobHunt//Interview//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${event.uid}`,
    `DTSTAMP:${utcStamp(event.stamp)}`,
    ...("date" in event.when
      ? [`DTSTART;VALUE=DATE:${dateValue(event.when.date)}`, `DTEND;VALUE=DATE:${dateValue(event.when.date, 1)}`]
      : [`DTSTART:${utcStamp(event.when.start)}`, `DURATION:PT${event.when.minutes}M`]),
    `SUMMARY:${escapeText(event.summary)}`,
    ...(event.url ? [`URL:${event.url}`] : []),
    "END:VEVENT",
    "END:VCALENDAR"
  ];
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
