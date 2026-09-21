import { StudentSearchApp } from "@/components/student-search-app";
import { CLASS_SCHEDULES, CLASS_SOURCE } from "@/lib/class-data.server";
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
  TEACHER_SOURCE,
} from "@/lib/teacher-data.server";
import {
  ACTIVITIES,
  ACTIVITY_AUDIENCES,
  ACTIVITY_CATEGORY_COUNTS,
  ACTIVITY_SOURCE,
} from "@/lib/activity-data.server";

export default function Home() {
  return (
    <StudentSearchApp
      classSummaries={CLASS_SUMMARIES}
      classSchedules={CLASS_SCHEDULES}
      classSource={CLASS_SOURCE}
      gradeCounts={GRADE_COUNTS}
      students={STUDENTS}
      totalStudents={STUDENTS.length}
      teachers={TEACHERS}
      teacherGradeCounts={TEACHER_GRADE_COUNTS}
      teacherSubjects={TEACHER_SUBJECTS}
      schoolDays={SCHOOL_DAYS}
      periodTimes={PERIOD_TIMES}
      teacherSource={TEACHER_SOURCE}
      activities={ACTIVITIES}
      activityAudiences={ACTIVITY_AUDIENCES}
      activityCategoryCounts={ACTIVITY_CATEGORY_COUNTS}
      activitySource={ACTIVITY_SOURCE}
    />
  );
}
