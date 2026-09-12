export type StudentRecord = {
  id: string;
  fullName: string;
  searchName: string;
  softSearchName: string;
  compactSearchName: string;
  grade: number;
  section: number;
  rosterOrder: number;
  enrollmentNumber: string | null;
  sourceSheet: string;
  sourceRow: number;
  academicYear: string;
};

export type StudentResult = Pick<
  StudentRecord,
  | "id"
  | "fullName"
  | "grade"
  | "section"
  | "rosterOrder"
  | "enrollmentNumber"
  | "academicYear"
>;

export type ClassSummary = {
  grade: number;
  section: number;
  count: number;
};

export type TeacherLesson = {
  day: string;
  dayIndex: number;
  periodStart: number;
  periodEnd: number;
  subject: string;
  classCode: string;
  grade: number;
  section: number;
};

export type TeacherRecord = {
  id: string;
  fullName: string;
  searchName: string;
  softSearchName: string;
  compactSearchName: string;
  sourcePage: number;
  grades: number[];
  subjects: string[];
  lessonCount: number;
  occupiedPeriodCount: number;
  lessons: TeacherLesson[];
};
