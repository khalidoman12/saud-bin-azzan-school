import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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
  assert.ok(payload.source.rangeEnd >= "2026-09-21");
  assert.equal(payload.source.coverage, "partial");
  assert.equal(new Set(activities.map((activity) => activity.id)).size, activities.length);
  assert.ok(activities.every((activity) => activity.date >= "2026-08-30" && activity.date <= payload.source.rangeEnd));
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


test("cached activity images exist and are safe local paths", () => {
  for (const media of activities.flatMap((a) => a.media)) {
    if (media.localPath) {
      assert.match(media.localPath, /^\/activity-media\/[a-f0-9]+\.(jpg|png|webp)$/);
      assert.ok(existsSync(path.join(root, "public", media.localPath)));
    }
  }
});

test("new public X markup retains complete text and video cover", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "school-x-markup-"));
  const data = path.join(dir, "data.json");
  const html = path.join(dir, "post.html");
  writeFileSync(data, JSON.stringify(payload));
  writeFileSync(html, `<article><a href="/EduGovSsq5302/status/2102000000000000001"><time datetime="2026-09-21T10:00:00Z"></time></a><div dir="auto" class="whitespace-pre-wrap">قدّم أ. سالم <span>درسًا للصف الخامس</span></div><img src="https://pbs.twimg.com/amplify_video_thumb/123/img/test?format=webp"></article>`);
  execFileSync("python3", [path.join(root, "tools/sync_x_activities.py"), "--data", data, "--html-file", html]);
  const added = JSON.parse(readFileSync(data)).activities.find((a) => a.sourceId === "2102000000000000001");
  assert.equal(added.description, "قدّم أ. سالم درسًا للصف الخامس");
  assert.equal(added.title, added.description);
  assert.equal(added.media[0].type, "video");
  assert.deepEqual(added.grades, [5]);
  writeFileSync(html, "<html>Sign in to X</html>");
  const saved = readFileSync(data, "utf8");
  assert.throws(() => execFileSync("python3", [path.join(root, "tools/sync_x_activities.py"), "--data", data, "--html-file", html], { stdio: "pipe" }));
  assert.equal(readFileSync(data, "utf8"), saved);
});
