import rawStudents from "@/data/students.generated.json";
import type { ClassSummary, StudentRecord } from "@/lib/types";

export const STUDENTS = rawStudents as StudentRecord[];

const classCounter = new Map<string, ClassSummary>();

for (const student of STUDENTS) {
  const key = `${student.grade}-${student.section}`;
  const current = classCounter.get(key);
  if (current) {
    current.count += 1;
  } else {
    classCounter.set(key, {
      grade: student.grade,
      section: student.section,
      count: 1,
    });
  }
}

export const CLASS_SUMMARIES = Array.from(classCounter.values()).sort(
  (a, b) => a.grade - b.grade || a.section - b.section,
);

export const GRADE_COUNTS = [5, 6, 7, 8].map((grade) => ({
  grade,
  count: CLASS_SUMMARIES.filter((item) => item.grade === grade).reduce(
    (sum, item) => sum + item.count,
    0,
  ),
  sections: CLASS_SUMMARIES.filter((item) => item.grade === grade).length,
}));
