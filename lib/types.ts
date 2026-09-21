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

export type TeacherSourceMetadata = {
  fileName: string;
  createdDate: string | null;
  sha256: string;
};

export type ClassLesson = {
  day: string;
  dayIndex: number;
  periodStart: number;
  periodEnd: number;
  subject: string;
  teacherLabel: string;
  teacherId: string;
  teacherFullName: string;
};

export type ClassSchedule = {
  classCode: string;
  grade: number;
  section: number;
  sourcePage: number;
  lessons: ClassLesson[];
};

export type ActivityCategory =
  | "guidance"
  | "teaching"
  | "administration"
  | "visits"
  | "honors"
  | "health"
  | "community"
  | "student-life"
  | "transport"
  | "media";

export type ActivityMedia = {
  type: "image" | "video";
  url: string;
  localPath?: string;
  alt: string;
};

export type SchoolActivity = {
  id: string;
  sourceId: string | null;
  date: string;
  title: string;
  description: string;
  category: ActivityCategory;
  audiences: string[];
  people: string[];
  grades: number[];
  specialist: boolean;
  media: ActivityMedia[];
  sourceUrl: string;
  sourceLabel: string;
  verifiedAt?: string;
};

export type ActivitySourceMetadata = {
  account: string;
  accountUrl: string;
  rangeStart: string;
  rangeEnd: string;
  lastSyncedAt: string;
  syncMethod: string;
  coverage?: "partial";
  reviewedThrough?: string;
  syncStatus?: { state: "success" | "failure"; statusSince: string };
};
