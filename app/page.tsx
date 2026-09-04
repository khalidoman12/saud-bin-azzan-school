import { StudentSearchApp } from "@/components/student-search-app";
import {
  CLASS_SUMMARIES,
  GRADE_COUNTS,
  STUDENTS,
} from "@/lib/student-data.server";

export default function Home() {
  return (
    <StudentSearchApp
      classSummaries={CLASS_SUMMARIES}
      gradeCounts={GRADE_COUNTS}
      students={STUDENTS}
      totalStudents={STUDENTS.length}
    />
  );
}
