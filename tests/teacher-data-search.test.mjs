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
  assert.equal(teachers.reduce((sum, teacher) => sum + teacher.lessonCount, 0), 1520);
  assert.equal(teachers.filter((teacher) => teacher.lessonCount === 0).length, 6);
});

test("matches the visually verified first teacher schedule", () => {
  const teacher = teachers[0];
  assert.equal(teacher.fullName, "سعيد عبدالله راشد الراجحى");
  assert.equal(teacher.lessonCount, 10);
  assert.deepEqual(
    teacher.lessons.map((lesson) => [lesson.day, lesson.periodStart, lesson.periodEnd, lesson.classCode]),
    [
      ["الأحد", 3, 3, "6/1"],
      ["الأحد", 5, 5, "6/1"],
      ["الأحد", 7, 7, "6/2"],
      ["الاثنين", 3, 3, "6/1"],
      ["الاثنين", 5, 5, "6/2"],
      ["الثلاثاء", 6, 6, "6/1"],
      ["الثلاثاء", 8, 8, "6/2"],
      ["الأربعاء", 3, 3, "6/2"],
      ["الأربعاء", 5, 5, "6/2"],
      ["الأربعاء", 7, 7, "6/1"],
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
  assert.ok(teacher.lessons.some((lesson) => lesson.periodStart === 3 && lesson.periodEnd === 4));
  assert.ok(teachers.some((item) => item.fullName === "س س"));
  assert.ok(teachers.some((item) => item.fullName === "ص ص"));
});

test("keeps Thursday in every weekly view and filters a selected day and period", () => {
  assert.equal(payload.days.at(-1), "الخميس");
  assert.equal(teachers[0].lessons.filter((lesson) => lesson.day === "الخميس").length, 0);

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
  const teacher = teachers.find((item) => item.fullName === "على عبدالله على المشايخى");
  assert.ok(teacher.lessons.some((lesson) =>
    lesson.day === "الأحد" && lesson.periodStart === 1 && lesson.periodEnd === 2,
  ));
  assert.ok(filterAndRankTeachers([teacher], { day: "الأحد", period: 1 }).length === 1);
  assert.ok(filterAndRankTeachers([teacher], { day: "الأحد", period: 2 }).length === 1);
});

test("indexes every occupied teacher slot across all five days and eight periods", () => {
  const searchableSlots = payload.days.reduce((dayTotal, day) =>
    dayTotal + Array.from({ length: 8 }, (_, index) => index + 1).reduce(
      (periodTotal, period) => periodTotal + filterAndRankTeachers(teachers, { day, period }).length,
      0,
    ), 0);
  const occupiedPeriods = teachers.reduce((sum, teacher) => sum + teacher.occupiedPeriodCount, 0);
  assert.equal(searchableSlots, occupiedPeriods);
  assert.equal(searchableSlots, 1558);
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
