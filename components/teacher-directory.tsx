"use client";

import { useMemo, useState } from "react";
import {
  CalendarDays,
  ChevronLeft,
  CircleX,
  Clock3,
  GraduationCap,
  Search,
  SlidersHorizontal,
  UserRoundCheck,
  UsersRound,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { filterAndRankTeachers } from "@/lib/search-core.mjs";
import type { TeacherLesson, TeacherRecord, TeacherSourceMetadata } from "@/lib/types";

type GradeCount = { grade: number; count: number };

type Props = {
  teachers: TeacherRecord[];
  teacherGradeCounts: GradeCount[];
  teacherSubjects: string[];
  schoolDays: string[];
  periodTimes: Record<string, string>;
  source: TeacherSourceMetadata;
};

const GRADE_LABELS: Record<number, string> = {
  5: "الخامس",
  6: "السادس",
  7: "السابع",
  8: "الثامن",
};

function arabicNumber(value: number) {
  return value.toLocaleString("ar-OM");
}

function periodLabel(lesson: TeacherLesson) {
  if (lesson.periodStart === lesson.periodEnd) {
    return `الحصة ${arabicNumber(lesson.periodStart)}`;
  }
  return `الحصتان ${arabicNumber(lesson.periodStart)}–${arabicNumber(lesson.periodEnd)}`;
}

function TeacherCard({
  teacher,
  onSelect,
  matchDay,
  matchPeriod,
}: {
  teacher: TeacherRecord;
  onSelect: (teacher: TeacherRecord) => void;
  matchDay?: string | null;
  matchPeriod?: number | null;
}) {
  const matchingLesson = matchDay && matchPeriod
    ? teacher.lessons.find((lesson) =>
      lesson.day === matchDay
      && lesson.periodStart <= matchPeriod
      && lesson.periodEnd >= matchPeriod,
    )
    : null;

  return (
    <button
      type="button"
      className="teacher-card group"
      onClick={() => onSelect(teacher)}
      aria-label={`فتح جدول المعلم ${teacher.fullName}`}
    >
      <span className="teacher-avatar" aria-hidden="true"><UserRoundCheck /></span>
      <span className="min-w-0 flex-1">
        <span className="block text-base font-black leading-7 text-card-foreground">{teacher.fullName}</span>
        <span className="mt-2 flex flex-wrap items-center gap-1.5">
          {teacher.grades.map((grade) => (
            <Badge key={grade} variant="secondary" className="rounded-full">الصف {GRADE_LABELS[grade]}</Badge>
          ))}
          {teacher.subjects.map((subject) => (
            <Badge key={subject} variant="outline" className="rounded-full">{subject}</Badge>
          ))}
          {teacher.lessonCount === 0 && (
            <Badge variant="outline" className="rounded-full text-muted-foreground">لا توجد حصص مدرجة</Badge>
          )}
        </span>
        {matchingLesson && (
          <span className="teacher-slot-match">
            <CalendarDays />
            <span>{matchDay}، الحصة {arabicNumber(matchPeriod ?? matchingLesson.periodStart)}:</span>
            <strong>{matchingLesson.subject}</strong>
            <Badge dir="ltr">{matchingLesson.classCode}</Badge>
          </span>
        )}
      </span>
      <span className="teacher-card-count">
        <strong>{arabicNumber(teacher.occupiedPeriodCount)}</strong>
        <small>حصة أسبوعيًا</small>
      </span>
      <span className="student-chevron" aria-hidden="true"><ChevronLeft /></span>
    </button>
  );
}

function DaySchedule({ day, dayIndex, lessons, periodTimes }: { day: string; dayIndex: number; lessons: TeacherLesson[]; periodTimes: Record<string, string> }) {
  return (
    <section id={`teacher-schedule-day-${dayIndex}`} className="day-schedule" aria-label={`جدول يوم ${day}`}>
      <div className="day-schedule-title"><CalendarDays /><h3>{day}</h3><Badge variant="secondary">{arabicNumber(lessons.reduce((total, lesson) => total + lesson.periodEnd - lesson.periodStart + 1, 0))} حصص</Badge></div>
      <div className="day-lessons">
        {Array.from({ length: 8 }, (_, index) => index + 1).map((period) => {
          const lesson = lessons.find((item) => item.periodStart <= period && item.periodEnd >= period);
          return <article key={period} className={`lesson-card period-row${lesson ? "" : " period-unassigned"}`}>
            <div className="period-number"><strong>الحصة {arabicNumber(period)}</strong><small dir="ltr">{periodTimes[String(period)]}</small></div>
            {lesson ? <div className="period-content">
            <div className="flex items-start justify-between gap-2">
              <strong>{lesson.subject}</strong>
              <Badge dir="ltr" className="shrink-0 rounded-lg">{lesson.classCode}</Badge>
            </div>
            {lesson.periodStart !== lesson.periodEnd && <small>حصة مزدوجة · {periodLabel(lesson)}</small>}
            </div> : <span className="text-sm text-muted-foreground">لا توجد حصة مدرجة</span>}
          </article>;
        })}
      </div>
    </section>
  );
}

function WeeklySchedule({ teacher, schoolDays }: { teacher: TeacherRecord; schoolDays: string[] }) {
  return <div className="weekly-table-scroll" tabIndex={0} role="region" aria-label="الجدول الأسبوعي، قابل للتمرير أفقيًا">
    <table className="weekly-timetable">
      <caption>جميع أيام الأسبوع والحصص الثماني · الأرقام على صورة الصف / الشعبة</caption>
      <thead><tr><th scope="col">اليوم</th>{Array.from({ length: 8 }, (_, index) => <th scope="col" key={index}>الحصة {arabicNumber(index + 1)}</th>)}</tr></thead>
      <tbody>{schoolDays.map((day) => <tr key={day}><th scope="row">{day}</th>{Array.from({ length: 8 }, (_, index) => {
        const period = index + 1;
        const lesson = teacher.lessons.find((item) => item.day === day && item.periodStart <= period && item.periodEnd >= period);
        return <td key={period} data-occupied={Boolean(lesson)}>{lesson ? <><strong dir="ltr">{lesson.classCode}</strong><span>{lesson.subject}</span>{lesson.periodStart !== lesson.periodEnd && <small>مزدوجة {arabicNumber(lesson.periodStart)}–{arabicNumber(lesson.periodEnd)}</small>}</> : <span className="text-muted-foreground">—<span className="sr-only">لا توجد حصة مدرجة</span></span>}</td>;
      })}</tr>)}</tbody>
    </table>
  </div>;
}

function TeacherScheduleDialog({
  teacher,
  schoolDays,
  periodTimes,
  source,
  initialDay,
  onClose,
}: {
  teacher: TeacherRecord | null;
  schoolDays: string[];
  periodTimes: Record<string, string>;
  source: TeacherSourceMetadata;
  initialDay: string | null;
  onClose: () => void;
}) {
  const [selectedDay, setSelectedDay] = useState(initialDay ?? schoolDays[0]);
  const [view, setView] = useState("day");
  return (
    <Dialog open={teacher !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent dir="rtl" showCloseButton={false} className="teacher-dialog rounded-3xl border-border/80 p-0 sm:max-w-6xl">
        {teacher && (
          <>
            <DialogHeader className="teacher-detail-header text-right sm:text-right">
              <div className="teacher-detail-icon" aria-hidden="true"><CalendarDays /></div>
              <div className="min-w-0 flex-1">
                <DialogDescription className="mb-1 text-primary">الجدول الأسبوعي للمعلم</DialogDescription>
                <DialogTitle className="text-xl font-black leading-8 sm:text-2xl">{teacher.fullName}</DialogTitle>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {teacher.subjects.map((subject) => <Badge key={subject} variant="outline" className="rounded-full">{subject}</Badge>)}
                  {teacher.grades.map((grade) => <Badge key={grade} variant="secondary" className="rounded-full">الصف {GRADE_LABELS[grade]}</Badge>)}
                </div>
              </div>
              <div className="teacher-detail-total"><strong>{arabicNumber(teacher.occupiedPeriodCount)}</strong><span>حصة أسبوعيًا</span></div>
            </DialogHeader>

            <div className="teacher-schedule-scroll">
              <p className="schedule-source-note">نسخة الملف: <bdi>{source.createdDate ?? source.fileName}</bdi> · صفحة المصدر {arabicNumber(teacher.sourcePage)} · تُحتسب الحصة المزدوجة حصتين.</p>
              {teacher.lessons.length === 0 ? (
                <div className="empty-state teacher-empty">
                  <div className="empty-icon"><CalendarDays /></div>
                  <h3>لا توجد حصص مدرجة لهذا المعلم</h3>
                  <p>الصفحة الخاصة به موجودة في الملف الأصلي، لكن جدولها الأسبوعي خالٍ.</p>
                </div>
              ) : (
                <>
                  <div className="schedule-view-switch" aria-label="طريقة عرض الجدول">
                    <Button variant={view === "day" ? "default" : "outline"} onClick={() => setView("day")} aria-pressed={view === "day"}>عرض يومي</Button>
                    <Button variant={view === "week" ? "default" : "outline"} onClick={() => setView("week")} aria-pressed={view === "week"}>الأسبوع كاملًا</Button>
                  </div>
                  {view === "day" ? <>
                  <nav className="schedule-day-picker" aria-label="اختيار يوم جدول المعلم">
                    {schoolDays.map((day) => (
                      <button
                        key={day}
                        type="button"
                        aria-pressed={selectedDay === day}
                        onClick={() => setSelectedDay(day)}
                      >
                        {day}
                      </button>
                    ))}
                  </nav>
                    <DaySchedule
                      day={selectedDay}
                      dayIndex={schoolDays.indexOf(selectedDay)}
                      lessons={teacher.lessons.filter((lesson) => lesson.day === selectedDay)}
                      periodTimes={periodTimes}
                    />
                  </> : <WeeklySchedule teacher={teacher} schoolDays={schoolDays} />}
                  <p className="schedule-source-note">الأوقات من ترويسة الملف الأصلي. الخانة الفارغة تعني عدم إدراج حصة، ولا تعني أن المعلم متاح للاحتياط.</p>
                </>
              )}
            </div>

            <DialogFooter className="border-t border-border/70 px-5 py-4 sm:px-6">
              <DialogClose asChild><Button type="button" size="lg" className="h-11 w-full rounded-xl sm:w-36">إغلاق</Button></DialogClose>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function TeacherDirectory({ teachers, teacherGradeCounts, teacherSubjects, schoolDays, periodTimes, source }: Props) {
  const [activeTab, setActiveTab] = useState("search");
  const [query, setQuery] = useState("");
  const [grade, setGrade] = useState<number | null>(null);
  const [subject, setSubject] = useState<string | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [period, setPeriod] = useState<number | null>(null);
  const [browseGrade, setBrowseGrade] = useState<number | null>(null);
  const [selectedTeacher, setSelectedTeacher] = useState<TeacherRecord | null>(null);

  const searchResults = useMemo(
    () => filterAndRankTeachers(teachers, { query, grade, subject, day, period }).map(({ teacher }) => teacher as TeacherRecord),
    [day, grade, period, query, subject, teachers],
  );
  const gradeResults = useMemo(
    () => browseGrade === null ? [] : teachers.filter((teacher) => teacher.grades.includes(browseGrade)),
    [browseGrade, teachers],
  );
  const displayedTeachers = activeTab === "grades" ? gradeResults : searchResults;
  const lessonTotal = useMemo(() => teachers.reduce((sum, teacher) => sum + teacher.occupiedPeriodCount, 0), [teachers]);

  function clearFilters() {
    setQuery("");
    setGrade(null);
    setSubject(null);
    setDay(null);
    setPeriod(null);
  }

  return (
    <>
      <section className="search-deck teacher-deck" aria-labelledby="teacher-heading">
        <div className="deck-heading">
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs font-bold text-primary"><CalendarDays className="size-4" /> جداول الهيئة التدريسية</div>
            <h2 id="teacher-heading" className="text-2xl font-black tracking-tight text-foreground sm:text-3xl">الوصول إلى جدول المعلم خلال ثوانٍ</h2>
            <p className="mt-2 max-w-2xl text-sm leading-7 text-muted-foreground">ابحث بالاسم، أو اختر الصف والمادة واليوم والحصة. تنطبق الفلاتر على الحصة نفسها؛ اضغط على المعلم لعرض جدوله.</p>
            <p className="schedule-source-note" data-source-sha256={source.sha256}>المصدر: {source.fileName} · تاريخ نسخة الملف: <bdi>{source.createdDate ?? "غير مدرج"}</bdi></p>
          </div>
          <div className="stats-strip" aria-label="إحصاءات جداول المعلمين">
            <div><strong>{arabicNumber(teachers.length)}</strong><span>معلمًا</span></div>
            <div><strong>{arabicNumber(lessonTotal)}</strong><span>حصة أسبوعية</span></div>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} dir="rtl">
          <TabsList className="mb-5 h-12 w-full rounded-xl bg-secondary/70 p-1 sm:w-auto">
            <TabsTrigger value="search" className="h-10 rounded-lg px-5 text-sm sm:min-w-44"><Search /> البحث المتقدم</TabsTrigger>
            <TabsTrigger value="grades" className="h-10 rounded-lg px-5 text-sm sm:min-w-44"><GraduationCap /> المعلمون حسب الصف</TabsTrigger>
          </TabsList>

          <TabsContent value="search" className="space-y-4">
            <div className="relative">
              <Search className="pointer-events-none absolute right-4 top-1/2 size-5 -translate-y-1/2 text-primary" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="ابحث عن معلم..."
                className="h-15 rounded-2xl border-border/80 bg-background pr-12 pl-12 text-base shadow-sm placeholder:text-muted-foreground sm:h-16 sm:text-lg"
                list="teacher-names"
                autoComplete="off"
                spellCheck={false}
                aria-label="البحث عن معلم"
              />
              <datalist id="teacher-names">{teachers.map((teacher) => <option key={teacher.id} value={teacher.fullName} />)}</datalist>
              {query && <Button type="button" variant="ghost" size="icon-sm" className="absolute left-4 top-1/2 -translate-y-1/2 rounded-full" onClick={() => setQuery("")} aria-label="مسح اسم المعلم"><CircleX /></Button>}
            </div>

            <div className="teacher-filter-grid">
              <div className="teacher-filter-label"><SlidersHorizontal /> تصفية متقدمة</div>
              <div className="grade-chips" aria-label="تصفية المعلمين حسب الصف">
                <Button type="button" variant={grade === null ? "default" : "outline"} onClick={() => setGrade(null)}>كل الصفوف</Button>
                {[5, 6, 7, 8].map((item) => <Button type="button" key={item} variant={grade === item ? "default" : "outline"} onClick={() => setGrade(item)}>الصف {GRADE_LABELS[item]}</Button>)}
              </div>
              <Select value={subject ?? "all"} onValueChange={(value) => setSubject(value === "all" ? null : value)} dir="rtl">
                <SelectTrigger aria-label="المادة" className="h-11 rounded-xl bg-background"><SelectValue placeholder="المادة" /></SelectTrigger>
                <SelectContent><SelectItem value="all">كل المواد</SelectItem>{teacherSubjects.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={day ?? "all"} onValueChange={(value) => { setDay(value === "all" ? null : value); setPeriod(null); }} dir="rtl">
                <SelectTrigger aria-label="اليوم" className="h-11 rounded-xl bg-background"><SelectValue placeholder="اليوم" /></SelectTrigger>
                <SelectContent><SelectItem value="all">كل الأيام</SelectItem>{schoolDays.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={period === null ? "all" : String(period)} onValueChange={(value) => setPeriod(value === "all" ? null : Number(value))} disabled={day === null} dir="rtl">
                <SelectTrigger aria-label="رقم الحصة" className="h-11 rounded-xl bg-background"><SelectValue placeholder="رقم الحصة" /></SelectTrigger>
                <SelectContent><SelectItem value="all">كل الحصص</SelectItem>{Array.from({ length: 8 }, (_, index) => index + 1).map((item) => <SelectItem key={item} value={String(item)}>الحصة {arabicNumber(item)}</SelectItem>)}</SelectContent>
              </Select>
              {(query || grade !== null || subject || day || period !== null) && <Button type="button" variant="ghost" className="h-11 rounded-xl" onClick={clearFilters}><CircleX /> مسح الفلاتر</Button>}
            </div>
            {day && <div className="period-quick-picker" aria-label="اختيار الحصة مباشرة">
              <span>حصص {day}</span>
              {Array.from({ length: 8 }, (_, index) => index + 1).map((item) => <Button key={item} variant={period === item ? "default" : "outline"} aria-pressed={period === item} aria-label={`عرض معلمي الحصة ${item} يوم ${day}`} onClick={() => setPeriod(period === item ? null : item)}>{arabicNumber(item)}</Button>)}
            </div>}
          </TabsContent>

          <TabsContent value="grades" className="space-y-5">
            <div>
              <p className="mb-3 text-sm font-bold text-foreground">اختر المرحلة لعرض جميع معلميها</p>
              <div className="grade-browser-grid">
                {teacherGradeCounts.map((item) => (
                  <button type="button" key={item.grade} className="grade-browser-card" data-active={browseGrade === item.grade} onClick={() => setBrowseGrade(item.grade)}>
                    <span className="grade-number">{item.grade}</span>
                    <span className="min-w-0 text-right"><strong>معلمو الصف {GRADE_LABELS[item.grade]}</strong><small>{arabicNumber(item.count)} معلمًا</small></span>
                  </button>
                ))}
              </div>
            </div>
            {browseGrade !== null && (
              <div className="selected-grade-note"><UsersRound /><span>قائمة معلمي الصف <strong>{GRADE_LABELS[browseGrade]}</strong></span><Badge>{arabicNumber(gradeResults.length)} معلمًا</Badge></div>
            )}
          </TabsContent>
        </Tabs>
      </section>

      <section className="results-panel teacher-results" aria-live="polite">
        {activeTab === "grades" && browseGrade === null ? (
          <div className="empty-state"><div className="empty-icon"><GraduationCap /></div><h3>اختر أحد الصفوف</h3><p>ستظهر هنا قائمة المعلمين الذين لديهم حصة واحدة على الأقل لذلك الصف.</p></div>
        ) : displayedTeachers.length === 0 ? (
          <div className="empty-state"><div className="empty-icon"><UserRoundCheck /></div><h3>لا توجد نتائج مطابقة</h3><p>جرّب جزءًا آخر من الاسم أو أزل أحد الفلاتر.</p></div>
        ) : (
          <div>
            {activeTab === "search" && day && period !== null && (
              <div className="slot-results-heading">
                <Clock3 />
                <span>معلمو <strong>{day}</strong> في الحصة <strong>{arabicNumber(period)}</strong></span>
                <Badge>{arabicNumber(displayedTeachers.length)} معلمًا</Badge>
              </div>
            )}
            <div className="mb-3 flex items-center justify-between gap-3"><p className="text-sm font-semibold">{arabicNumber(displayedTeachers.length)} معلمًا</p><span className="text-xs text-muted-foreground">اضغط على الاسم لفتح الجدول</span></div>
            <div className="space-y-3">{displayedTeachers.map((teacher) => <TeacherCard key={teacher.id} teacher={teacher} onSelect={setSelectedTeacher} matchDay={activeTab === "search" ? day : null} matchPeriod={activeTab === "search" ? period : null} />)}</div>
          </div>
        )}
      </section>

      <TeacherScheduleDialog key={selectedTeacher?.id ?? "closed"} teacher={selectedTeacher} schoolDays={schoolDays} periodTimes={periodTimes} source={source} initialDay={activeTab === "search" ? day : null} onClose={() => setSelectedTeacher(null)} />
    </>
  );
}
