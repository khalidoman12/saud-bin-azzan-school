import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { normalizeArabic } from "../lib/search-core.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataPath = path.join(root, "data", "activities.generated.json");
const payload = JSON.parse(readFileSync(dataPath, "utf8"));
const activities = payload.activities;

test("activity archive has a consistent documented date range and unique records", () => {
  assert.ok(activities.length >= 30);
  assert.equal(payload.source.account, "@EduGovSsq5302");
  assert.equal(payload.source.rangeStart, "2026-08-30");
  assert.equal(payload.source.rangeEnd, "2026-09-18");
  assert.equal(new Set(activities.map((activity) => activity.id)).size, activities.length);
  assert.ok(activities.every((activity) => activity.date >= "2026-08-30" && activity.date <= "2026-09-18"));
  assert.ok(activities.every((activity) => activity.title && activity.description && activity.sourceUrl));
});

test("specialist archive includes the four documented specialists and searchable Arabic text", () => {
  const specialistRecords = activities.filter((activity) => activity.specialist);
  const text = normalizeArabic(specialistRecords.flatMap((activity) => [activity.title, activity.description, ...activity.people]).join(" "), { soft: true });
  assert.ok(specialistRecords.length >= 10);
  for (const name of ["خالد المشايخي", "حمد الشماخي", "شهاب الهاشمي", "خميس الساعدي"]) {
    assert.ok(text.includes(normalizeArabic(name, { soft: true })), `missing specialist: ${name}`);
  }
  assert.equal(normalizeArabic("الإرشاد النَّفسي", { soft: true }), "الارشاد النفسي");
});

test("activity categories and public media are valid", () => {
  const categories = new Set(["guidance", "teaching", "administration", "visits", "honors", "health", "community", "student-life", "transport", "media"]);
  assert.ok(activities.every((activity) => categories.has(activity.category)));
  assert.ok(activities.some((activity) => activity.media.length > 0));
  assert.ok(activities.flatMap((activity) => activity.media).every((media) => /^https:\/\//.test(media.url)));
});

test("free X synchronizer parses a public post and only appends a new record", () => {
  const temporaryDirectory = mkdtempSync(path.join(tmpdir(), "school-activity-test-"));
  const temporaryData = path.join(temporaryDirectory, "activities.json");
  const temporaryHtml = path.join(temporaryDirectory, "timeline.html");
  writeFileSync(temporaryData, JSON.stringify(payload), "utf8");
  writeFileSync(temporaryHtml, `
    <html><body><article>
      <div data-testid="tweetText">نفذ الأخصائي الاجتماعي حصة إرشادية لطلبة الصف الثامن</div>
      <a href="/EduGovSsq5302/status/2101200000000000000"><time datetime="2026-09-19T07:00:00.000Z">الوقت</time></a>
      <img src="https://pbs.twimg.com/media/TEST_IMAGE.jpg" />
    </article></body></html>
  `, "utf8");
  execFileSync("python3", [path.join(root, "tools", "sync_x_activities.py"), "--data", temporaryData, "--html-file", temporaryHtml], { cwd: root });
  const updated = JSON.parse(readFileSync(temporaryData, "utf8"));
  const added = updated.activities.find((activity) => activity.sourceId === "2101200000000000000");
  assert.equal(updated.activities.length, activities.length + 1);
  assert.equal(added.category, "guidance");
  assert.equal(added.specialist, true);
  assert.deepEqual(added.grades, [8]);
  assert.equal(added.media[0].url, "https://pbs.twimg.com/media/TEST_IMAGE.jpg");

  execFileSync("python3", [path.join(root, "tools", "sync_x_activities.py"), "--data", temporaryData, "--html-file", temporaryHtml], { cwd: root });
  const deduplicated = JSON.parse(readFileSync(temporaryData, "utf8"));
  assert.equal(deduplicated.activities.length, activities.length + 1);
});
