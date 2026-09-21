import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { filterAndRankTeachers } from "../lib/search-core.mjs";

const payload = JSON.parse(
  await readFile(new URL("../data/teachers.generated.json", import.meta.url), "utf8"),
);
const teachers = payload.teachers;

test("matches the independently extracted full PDF record digest", async () => {
  const audit = JSON.parse(await readFile(new URL("../data/teachers-independent-audit.json", import.meta.url), "utf8"));
  const keys = ["sourcePage", "fullName", "grades", "subjects", "lessonCount", "occupiedPeriodCount", "lessons"];
  const lessonKeys = ["day", "dayIndex", "periodStart", "periodEnd", "subject", "classCode", "grade", "section"];
  const records = teachers.map((teacher) => ({
    ...Object.fromEntries(keys.map((key) => [key, teacher[key]])),
    lessons: teacher.lessons.map((lesson) => Object.fromEntries(lessonKeys.map((key) => [key, lesson[key]]))),
  }));
  const sorted = (value) => Array.isArray(value) ? value.map(sorted)
    : value !== null && typeof value === "object"
      ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, sorted(value[key])])) : value;
  const digest = createHash("sha256").update(JSON.stringify(sorted(records))).digest("hex");
  assert.equal(audit.ok, true);
  assert.equal(audit.sourceSha256, payload.sourceSha256);
  assert.deepEqual(audit.discrepancies, []);
  assert.equal(audit.checks.periodTimes, 680);
  assert.equal(audit.checks.dayLabels, 425);
  assert.equal(digest, audit.canonicalTeacherRecordsSha256);
});

test("imports every teacher page and every detected lesson block", () => {
  assert.equal(teachers.length, 85);
  assert.equal(new Set(teachers.map((teacher) => teacher.id)).size, 85);
  assert.equal(new Set(teachers.map((teacher) => teacher.fullName)).size, 85);
  assert.equal(teachers.reduce((sum, teacher) => sum + teacher.lessonCount, 0), 1521);
  assert.equal(teachers.filter((teacher) => teacher.lessonCount === 0).length, 6);
});

test("matches the visually verified first teacher schedule", () => {
  const teacher = teachers[0];
  assert.equal(teacher.fullName, "سعيد عبدالله راشد الراجحى");
  assert.equal(teacher.lessonCount, 10);
  assert.deepEqual(
    teacher.lessons.map((lesson) => [lesson.day, lesson.periodStart, lesson.periodEnd, lesson.classCode]),
    [
      ["الأحد", 4, 4, "6/1"],
      ["الأحد", 5, 5, "6/2"],
      ["الاثنين", 4, 4, "6/1"],
      ["الاثنين", 7, 7, "6/2"],
      ["الثلاثاء", 5, 5, "6/1"],
      ["الثلاثاء", 8, 8, "6/2"],
      ["الأربعاء", 4, 4, "6/2"],
      ["الأربعاء", 5, 5, "6/1"],
      ["الخميس", 6, 6, "6/2"],
      ["الخميس", 8, 8, "6/1"],
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
    day: "الأربعاء",
  });
  assert.deepEqual(matches.map(({ teacher }) => teacher.fullName), ["سعيد البطيني"]);
});

test("preserves merged double periods and source placeholder names", () => {
  const teacher = teachers.find((item) => item.fullName === "خميس سعيد سالم الساعدي");
  assert.ok(teacher);
  assert.ok(teacher.lessons.some((lesson) => lesson.periodStart === 3 && lesson.periodEnd === 4));
  assert.ok(teachers.some((item) => item.fullName === "س س"));
  assert.ok(teachers.some((item) => item.fullName === "ص ص"));
});

test("keeps Thursday in every weekly view and filters a selected day and period", () => {
  assert.equal(payload.days.at(-1), "الخميس");
  assert.equal(teachers[0].lessons.filter((lesson) => lesson.day === "الخميس").length, 2);

  const sundayFirst = filterAndRankTeachers(teachers, { day: "الأحد", period: 1 });
  assert.equal(sundayFirst.length, 39);
  assert.ok(sundayFirst.every(({ teacher }) => teacher.lessons.some((lesson) =>
    lesson.day === "الأحد" && lesson.periodStart <= 1 && lesson.periodEnd >= 1,
  )));

  for (let period = 1; period <= 8; period += 1) {
    assert.equal(filterAndRankTeachers(teachers, { day: "الخميس", period }).length, 39);
  }
});

test("counts a double-period lesson in either selected period", () => {
  const teacher = teachers.find((item) => item.fullName === "خميس سعيد سالم الساعدي");
  assert.ok(teacher.lessons.some((lesson) =>
    lesson.day === "الأحد" && lesson.periodStart === 3 && lesson.periodEnd === 4 && lesson.classCode === "5/1",
  ));
  assert.ok(filterAndRankTeachers([teacher], { day: "الأحد", period: 3 }).length === 1);
  assert.ok(filterAndRankTeachers([teacher], { day: "الأحد", period: 4 }).length === 1);
});

test("identifies the September 19 source instead of the superseded PDF", () => {
  assert.equal(payload.sourceFile, "جدول المعلمين .pdf");
  assert.equal(payload.sourceCreatedDate, "2026-09-19");
  assert.equal(payload.sourceSha256, "06d051424205541a93d7d67ded76bc335950c6a53dd138b7f5833ee07f300955");
});

test("matches grade, subject, day and period on one lesson for every timetable combination", () => {
  for (const grade of [5, 6, 7, 8]) {
    for (const day of payload.days) {
      for (let period = 1; period <= 8; period += 1) {
        for (const subject of [null, ...new Set(teachers.flatMap((teacher) => teacher.subjects))]) {
          const actual = filterAndRankTeachers(teachers, { grade, subject, day, period }).map(({ teacher }) => teacher.id);
          const expected = teachers.filter((teacher) => teacher.lessons.some((lesson) =>
            lesson.grade === grade && lesson.day === day
            && (subject === null || lesson.subject === subject)
            && lesson.periodStart <= period && lesson.periodEnd >= period,
          )).map((teacher) => teacher.id);
          assert.deepEqual(actual, expected, `${grade}|${day}|${period}|${subject}`);
        }
      }
    }
  }
});

test("does not combine one grade with a different grade's lesson at the selected time", () => {
  const teacher = teachers.find((item) => item.grades.length > 1);
  const lesson = teacher.lessons[0];
  const otherGrade = teacher.grades.find((grade) => grade !== lesson.grade);
  assert.equal(filterAndRankTeachers([teacher], { grade: otherGrade, day: lesson.day, period: lesson.periodStart }).length, 0);
});

test("indexes every occupied teacher slot across all five days and eight periods", () => {
  const searchableSlots = payload.days.reduce((dayTotal, day) =>
    dayTotal + Array.from({ length: 8 }, (_, index) => index + 1).reduce(
      (periodTotal, period) => periodTotal + filterAndRankTeachers(teachers, { day, period }).length,
      0,
    ), 0);
  const occupiedPeriods = teachers.reduce((sum, teacher) => sum + teacher.occupiedPeriodCount, 0);
  assert.equal(searchableSlots, occupiedPeriods);
  assert.equal(searchableSlots, 1560);
});

test("covers every school class without teacher or class timetable collisions", () => {
  const expectedClasses = new Set([
    ...Array.from({ length: 11 }, (_, index) => `5/${index + 1}`),
    ...Array.from({ length: 10 }, (_, index) => `6/${index + 1}`),
    ...Array.from({ length: 9 }, (_, index) => `7/${index + 1}`),
    ...Array.from({ length: 9 }, (_, index) => `8/${index + 1}`),
  ]);
  const actualClasses = new Set(teachers.flatMap((teacher) =>
    teacher.lessons.map((lesson) => lesson.classCode),
  ));
  assert.deepEqual(actualClasses, expectedClasses);

  const teacherSlots = new Set();
  const classSlots = new Set();
  for (const teacher of teachers) {
    for (const lesson of teacher.lessons) {
      for (let period = lesson.periodStart; period <= lesson.periodEnd; period += 1) {
        const teacherSlot = `${teacher.id}|${lesson.day}|${period}`;
        const classSlot = `${lesson.classCode}|${lesson.day}|${period}`;
        assert.equal(teacherSlots.has(teacherSlot), false, `teacher collision: ${teacherSlot}`);
        assert.equal(classSlots.has(classSlot), false, `class collision: ${classSlot}`);
        teacherSlots.add(teacherSlot);
        classSlots.add(classSlot);
      }
    }
  }
});
