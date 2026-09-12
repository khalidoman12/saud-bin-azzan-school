import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { filterAndRankTeachers } from "../lib/search-core.mjs";

const payload = JSON.parse(
  await readFile(new URL("../data/teachers.generated.json", import.meta.url), "utf8"),
);
const teachers = payload.teachers;

test("imports every teacher page and every detected lesson block", () => {
  assert.equal(teachers.length, 85);
  assert.equal(new Set(teachers.map((teacher) => teacher.id)).size, 85);
  assert.equal(new Set(teachers.map((teacher) => teacher.fullName)).size, 85);
  assert.equal(teachers.reduce((sum, teacher) => sum + teacher.lessonCount, 0), 1510);
  assert.equal(teachers.filter((teacher) => teacher.lessonCount === 0).length, 6);
});

test("matches the visually verified first teacher schedule", () => {
  const teacher = teachers[0];
  assert.equal(teacher.fullName, "سعيد عبدالله راشد الراجحى");
  assert.equal(teacher.lessonCount, 10);
  assert.deepEqual(
    teacher.lessons.map((lesson) => [lesson.day, lesson.periodStart, lesson.periodEnd, lesson.classCode]),
    [
      ["الأحد", 1, 1, "6/2"],
      ["الأحد", 4, 4, "6/2"],
      ["الأحد", 7, 7, "6/1"],
      ["الاثنين", 4, 4, "6/1"],
      ["الأربعاء", 3, 3, "6/1"],
      ["الأربعاء", 5, 5, "6/2"],
      ["الأربعاء", 7, 7, "6/2"],
      ["الخميس", 3, 3, "6/1"],
      ["الخميس", 7, 7, "6/1"],
      ["الخميس", 8, 8, "6/2"],
    ],
  );
});

test("searches Arabic teacher names tolerantly and ranks exact matches first", () => {
  const matches = filterAndRankTeachers(teachers, { query: "خميس سعيد سالم الساعدى" });
  assert.equal(matches[0].teacher.fullName, "خميس سعيد سالم الساعدي");
  assert.ok(matches[0].score >= 700);
});

test("combines teacher name, grade, subject, and day filters", () => {
  const matches = filterAndRankTeachers(teachers, {
    query: "سعيد",
    grade: 7,
    subject: "تقنية المعلومات",
    day: "الأحد",
  });
  assert.deepEqual(matches.map(({ teacher }) => teacher.fullName), ["سعيد البطيني"]);
});

test("preserves merged double periods and source placeholder names", () => {
  const teacher = teachers.find((item) => item.fullName === "خميس سعيد سالم الساعدي");
  assert.ok(teacher);
  assert.ok(teacher.lessons.some((lesson) => lesson.periodStart === 2 && lesson.periodEnd === 3));
  assert.ok(teachers.some((item) => item.fullName === "س س"));
  assert.ok(teachers.some((item) => item.fullName === "ص ص"));
});
