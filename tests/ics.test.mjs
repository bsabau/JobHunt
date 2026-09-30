import assert from "node:assert/strict";
import { test } from "node:test";
import { escapeText, foldLine, interviewCalendar } from "../src/lib/ics.ts";

const base = { uid: "application-7@jobs.example.com", stamp: new Date("2026-09-30T12:00:00Z"), summary: "Interview: Acme, Engineer", url: null };

test("an all-day event on the interview date, ending the next day", () => {
  const ics = interviewCalendar({ ...base, when: { date: "2026-12-31" } });
  assert.match(ics, /\r\nDTSTART;VALUE=DATE:20261231\r\nDTEND;VALUE=DATE:20270101\r\n/);
});

test("a timed event starts at the UTC instant and lasts the given minutes", () => {
  const ics = interviewCalendar({ ...base, url: "https://jobs.example.com/7", when: { start: new Date("2026-10-26T13:30:00Z"), minutes: 60 } });
  assert.match(ics, /\r\nDTSTART:20261026T133000Z\r\nDURATION:PT60M\r\n/);
  assert.match(ics, /\r\nURL:https:\/\/jobs\.example\.com\/7\r\n/);
  assert.match(ics, /\r\nDTSTAMP:20260930T120000Z\r\n/);
});

test("every line ends in CRLF, and there is no bare LF", () => {
  const ics = interviewCalendar({ ...base, when: { date: "2026-10-05" } });
  assert.ok(ics.endsWith("END:VCALENDAR\r\n"));
  assert.equal(ics.replace(/\r\n/g, "").includes("\n"), false);
});

test("text escapes backslash, semicolon, comma and line breaks", () => {
  // Checked character by character, so an escape that does nothing in a JS
  // string ("\;" is just ";") cannot pass unnoticed.
  const B = String.fromCharCode(92); // one backslash
  assert.deepEqual([...escapeText("a" + B + "b;c,d\ne")], ["a", B, B, "b", B, ";", "c", B, ",", "d", B, "n", "e"]);
  const ics = interviewCalendar({ ...base, summary: "Interview: Smith, Jones; Partners", when: { date: "2026-10-05" } });
  assert.ok(ics.includes("SUMMARY:Interview: Smith" + B + ", Jones" + B + "; Partners"), ics);
});

test("long lines fold at 75 octets, never inside a multi-byte character", () => {
  const long = "SUMMARY:" + "é".repeat(60) + "日本".repeat(10);
  const folded = foldLine(long);
  const lines = folded.split("\r\n");
  const encoder = new TextEncoder();
  for (const line of lines) assert.ok(encoder.encode(line).length <= 75, `line of ${encoder.encode(line).length} octets`);
  for (const line of lines.slice(1)) assert.ok(line.startsWith(" "));
  assert.equal(lines.map((line, index) => (index === 0 ? line : line.slice(1))).join(""), long, "unfolding gives the line back");
  assert.equal(foldLine("SHORT"), "SHORT");
});
