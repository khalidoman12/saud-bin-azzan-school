import { StudentSearchApp } from "@/components/student-search-app";
import {
  CLASS_SUMMARIES,
  GRADE_COUNTS,
  STUDENTS,
} from "@/lib/student-data.server";
import {
  PERIOD_TIMES,
  SCHOOL_DAYS,
  TEACHERS,
  TEACHER_GRADE_COUNTS,
  TEACHER_SUBJECTS,
} from "@/lib/teacher-data.server";

export default function Home() {
  return (
    <StudentSearchApp
      classSummaries={CLASS_SUMMARIES}
      gradeCounts={GRADE_COUNTS}
      students={STUDENTS}
      totalStudents={STUDENTS.length}
      teachers={TEACHERS}
      teacherGradeCounts={TEACHER_GRADE_COUNTS}
      teacherSubjects={TEACHER_SUBJECTS}
      schoolDays={SCHOOL_DAYS}
      periodTimes={PERIOD_TIMES}
    />
  );
}
