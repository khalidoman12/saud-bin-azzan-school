import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (name) => JSON.parse(readFileSync(new URL(`../data/${name}.json`, import.meta.url)));
const { classes, source } = read("classes.generated");
const teachers = read("teachers.generated");
const audit = read("classes-cross-audit");

test("both independent PDF imports agree on all 1,560 weekly class periods", () => {
  assert.equal(audit.ok, true);
  assert.deepEqual(audit.discrepancies, []);
  assert.equal(audit.source.sha256, source.sha256);
  assert.equal(audit.teacherSourceSha256, teachers.sourceSha256);
  assert.equal(classes.length, 39);
  assert.equal(new Set(classes.map((c) => c.classCode)).size, 39);
  let checked = 0;
  for (const schedule of classes) {
    for (const day of teachers.days) {
      for (let period = 1; period <= 8; period++) {
        const lessons = schedule.lessons.filter((l) => l.day === day && l.periodStart <= period && l.periodEnd >= period);
        assert.equal(lessons.length, 1, `${schedule.classCode}/${day}/${period}`);
        const lesson = lessons[0];
        const teacher = teachers.teachers.find((t) => t.id === lesson.teacherId);
        assert.equal(teacher.fullName, lesson.teacherFullName);
        assert.ok(teacher.lessons.some((l) => l.classCode === schedule.classCode && l.day === day && l.periodStart <= period && l.periodEnd >= period && l.subject === lesson.subject));
        checked++;
      }
    }
  }
  assert.equal(checked, 1560);
});

test("first class Sunday matches the visually inspected PDF, including double IT periods", () => {
  const sunday = classes.find((c) => c.classCode === "5/1").lessons.filter((l) => l.day === "الأحد");
  assert.deepEqual(sunday.map((l) => [l.periodStart, l.periodEnd, l.subject]), [
    [1, 1, "الرياضيات"], [2, 2, "اللغة العربية"], [3, 4, "تقنية المعلومات"],
    [5, 5, "العلوم"], [6, 6, "الرياضيات"], [7, 7, "التربية الاسلامية"], [8, 8, "اللغة الانجليزية"],
  ]);
});
