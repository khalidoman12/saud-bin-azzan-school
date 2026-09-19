import rawTeacherData from "@/data/teachers.generated.json";
import type { TeacherRecord, TeacherSourceMetadata } from "@/lib/types";

export const TEACHERS = rawTeacherData.teachers as TeacherRecord[];
export const SCHOOL_DAYS = rawTeacherData.days as string[];
export const PERIOD_TIMES = rawTeacherData.periodTimes as Record<string, string>;
export const TEACHER_SOURCE: TeacherSourceMetadata = {
  fileName: rawTeacherData.sourceFile,
  createdDate: rawTeacherData.sourceCreatedDate,
  sha256: rawTeacherData.sourceSha256,
};

export const TEACHER_GRADE_COUNTS = [5, 6, 7, 8].map((grade) => ({
  grade,
  count: TEACHERS.filter((teacher) => teacher.grades.includes(grade)).length,
}));

export const TEACHER_SUBJECTS = Array.from(
  new Set(TEACHERS.flatMap((teacher) => teacher.subjects)),
).sort((a, b) => a.localeCompare(b, "ar"));
