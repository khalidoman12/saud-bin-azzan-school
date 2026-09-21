import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("exports the Arabic school directory application", async () => {
  const html = await readFile(new URL("../out/index.html", import.meta.url), "utf8");
  assert.match(html, /<html[^>]*lang="ar"[^>]*dir="rtl"/i);
  assert.match(html, /الدليل المدرسي/);
  assert.match(html, /ابحث عن طالب/);
  assert.match(html, /المعلمون والجداول/);
  assert.match(html, /للاستخدام المدرسي/);
  assert.match(html, /2026-09-19/);
  assert.ok(html.includes("06d051424205541a93d7d67ded76bc335950c6a53dd138b7f5833ee07f300955"), "new teacher source is exported");
  assert.match(html, /جداول الشعب/);
  assert.ok(html.includes("e13841d256eb74765b4dfddf8ec4aaf1ff76f7cd28c5770b59cf7f1fb746b79a"), "verified class source is exported");
});
