import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("exports the Arabic student-search application", async () => {
  const html = await readFile(new URL("../out/index.html", import.meta.url), "utf8");
  assert.match(html, /<html[^>]*lang="ar"[^>]*dir="rtl"/i);
  assert.match(html, /نظام البحث عن الطلبة/);
  assert.match(html, /ابحث عن طالب/);
  assert.match(html, /للاستخدام المدرسي/);
});
