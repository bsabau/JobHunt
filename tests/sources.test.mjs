import assert from "node:assert/strict";
import { test } from "node:test";
import { groupBySource, sourceHost } from "../src/lib/sources.ts";

test("the host is lower-cased, without www., port or path", () => {
  assert.equal(sourceHost("https://WWW.Example-Jobs.com/job/123?x=1"), "example-jobs.com");
  assert.equal(sourceHost("http://careers.northwind.test:8080/apply"), "careers.northwind.test");
  assert.equal(sourceHost("https://www2.example.com/"), "www2.example.com", "only a leading 'www.' goes");
});

test("no link, a link without a host, or one that does not parse has no host", () => {
  assert.equal(sourceHost(null), null);
  assert.equal(sourceHost(""), null);
  assert.equal(sourceHost("mailto:jobs@example.com"), null);
  assert.equal(sourceHost("not a url"), null);
});

const app = (sourceUrl, responded = false, interviewed = false, offered = false) => ({ sourceUrl, responded, interviewed, offered });

test("hosts with fewer than 3 go to Other; no link to Unknown; both last", () => {
  const groups = groupBySource([
    app("https://jobs.example.com/1", true),
    app("https://jobs.example.com/2", true, true),
    app("https://jobs.example.com/3"),
    app("https://board.example.org/1", true),
    app("https://board.example.org/2"),
    app("https://solo.example.net/1", true, true, true),
    app(null),
    app("garbage", true)
  ]);
  assert.deepEqual(groups, [
    { source: "jobs.example.com", sent: 3, responded: 2, interviewed: 1, offered: 0 },
    { source: "Other", sent: 3, responded: 2, interviewed: 1, offered: 1 },
    { source: "Unknown", sent: 2, responded: 1, interviewed: 0, offered: 0 }
  ]);
});

test("exactly 3 applications is a group of its own; groups sort by count, then name", () => {
  const three = (host) => [1, 2, 3].map((n) => app(`https://${host}/${n}`));
  const groups = groupBySource([...three("b.example.com"), ...three("a.example.com"), ...three("c.example.com"), app("https://c.example.com/4")]);
  assert.deepEqual(groups.map((group) => [group.source, group.sent]), [["c.example.com", 4], ["a.example.com", 3], ["b.example.com", 3]]);
});

test("the groups add up to every application, and nothing gives nothing", () => {
  const applications = [app("https://x.example.com/1"), app(null), app("https://y.example.com/1")];
  assert.equal(groupBySource(applications).reduce((sum, group) => sum + group.sent, 0), 3);
  assert.deepEqual(groupBySource([]), []);
});
