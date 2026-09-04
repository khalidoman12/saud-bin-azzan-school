import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { filterAndRankStudents } from "../lib/search-core.mjs";

const students = JSON.parse(
  await readFile(new URL("../data/students.generated.json", import.meta.url), "utf8"),
);

test("imports every verified student and class", () => {
  assert.equal(students.length, 1395);
  assert.equal(new Set(students.map((student) => student.id)).size, 1395);
  assert.equal(new Set(students.map((student) => `${student.grade}/${student.section}`)).size, 39);
  assert.deepEqual(
    Object.fromEntries(
      [5, 6, 7, 8].map((grade) => [grade, students.filter((student) => student.grade === grade).length]),
    ),
    { 5: 389, 6: 362, 7: 323, 8: 321 },
  );
});

test("applies Arabic normalization without changing display names", () => {
  assert.equal(filterAndRankStudents(students, { query: "احمد" }).length, 105);
  assert.equal(filterAndRankStudents(students, { query: "هنيد" }).length, 1);
  assert.equal(filterAndRankStudents(students, { query: "صميدة" }).length, 1);
  assert.equal(filterAndRankStudents(students, { query: "الخوذيري" }).length, 6);

  const joined = filterAndRankStudents(students, { query: "عبدالرحمن" })
    .map(({ student }) => student.id)
    .sort();
  const spaced = filterAndRankStudents(students, { query: "عبد الرحمن" })
    .map(({ student }) => student.id)
    .sort();
  assert.deepEqual(joined, spaced);
  assert.equal(joined.length, 21);
});

test("combines search with grade and section filters", () => {
  const matches = filterAndRankStudents(students, { query: "محمد", grade: 8, section: 3 });
  assert.equal(matches.length, 12);
  assert.ok(matches.every(({ student }) => student.grade === 8 && student.section === 3));
});

test("browses a class in roster order", () => {
  const roster = filterAndRankStudents(students, { grade: 8, section: 3 });
  assert.equal(roster.length, 37);
  assert.deepEqual(roster.map(({ student }) => student.rosterOrder), Array.from({ length: 37 }, (_, index) => index + 1));
});
