"use client";

import { useEffect, useMemo, useState } from "react";
import { BookOpen, CalendarDays, Check, Copy, MapPin, Printer, Search, Star, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TeacherScheduleDialog } from "@/components/teacher-directory";
import { normalizeArabic } from "@/lib/search-core.mjs";
import type { ClassSchedule, TeacherRecord, TeacherSourceMetadata } from "@/lib/types";

type Props = {
  schedules: ClassSchedule[];
  teachers: TeacherRecord[];
  days: string[];
  periodTimes: Record<string, string>;
  source: TeacherSourceMetadata;
  teacherSource: TeacherSourceMetadata;
  initialClassCode: string | null;
};
const GRADES: Record<number, string> = { 5: "الخامس", 6: "السادس", 7: "السابع", 8: "الثامن" };
const PERIODS = Array.from({ length: 8 }, (_, index) => index + 1);
const FAVORITES_KEY = "school-favorite-classes";

export function ClassDirectory({ schedules, teachers, days, periodTimes, source, teacherSource, initialClassCode }: Props) {
  const [grade, setGrade] = useState<number | null>(initialClassCode ? Number(initialClassCode.split("/")[0]) : null);
  const [selectedCode, setSelectedCode] = useState(initialClassCode ?? "");
  const [query, setQuery] = useState("");
  const [day, setDay] = useState(days[0]);
  const [period, setPeriod] = useState(1);
  const [mode, setMode] = useState<"browse" | "map">("browse");
  const [week, setWeek] = useState(false);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const [selectedTeacher, setSelectedTeacher] = useState<TeacherRecord | null>(null);

  useEffect(() => {
    if (!initialClassCode) return;
    const timer = setTimeout(() => document.getElementById("class-timetable")?.scrollIntoView({ block: "start" }), 0);
    return () => clearTimeout(timer);
  }, [initialClassCode]);

  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        const saved: unknown = JSON.parse(localStorage.getItem(FAVORITES_KEY) ?? "[]");
        if (Array.isArray(saved)) setFavorites(saved.filter((code) => typeof code === "string" && schedules.some((s) => s.classCode === code)));
      } catch { /* Browsing remains available if local storage is disabled. */ }
    }, 0);
    return () => clearTimeout(timer);
  }, [schedules]);

  const selected = schedules.find((schedule) => schedule.classCode === selectedCode);
  const teacherById = useMemo(() => new Map(teachers.map((teacher) => [teacher.id, teacher])), [teachers]);
  const normalizedQuery = normalizeArabic(query, { soft: true }).replace(/[٠-٩]/g, (digit: string) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)));
  const matches = schedules.filter((schedule) => {
    if (grade !== null && schedule.grade !== grade) return false;
    const lessons = mode === "map" ? schedule.lessons.filter((lesson) => lesson.day === day && lesson.periodStart <= period && lesson.periodEnd >= period) : schedule.lessons;
    const text = normalizeArabic(`${schedule.classCode} الصف ${GRADES[schedule.grade]} ${lessons.map((lesson) => `${lesson.subject} ${lesson.teacherLabel} ${lesson.teacherFullName}`).join(" ")}`, { soft: true });
    return normalizedQuery.split(/\s+/).every((token: string) => text.includes(token));
  });

  function openClass(code: string) {
    setSelectedCode(code);
    setMode("browse");
    setCopied(false);
    const url = new URL(window.location.href);
    url.hash = `class=${code}`;
    window.history.replaceState(null, "", url);
    window.setTimeout(() => document.getElementById("class-timetable")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  }

  function toggleFavorite(code: string) {
    const next = favorites.includes(code) ? favorites.filter((item) => item !== code) : [...favorites, code];
    setFavorites(next);
    try { localStorage.setItem(FAVORITES_KEY, JSON.stringify(next)); } catch { /* In-memory favorite still works. */ }
  }

  async function copyLink() {
    const url = new URL(window.location.href);
    url.hash = `class=${selectedCode}`;
    try {
      await navigator.clipboard.writeText(url.href);
      setCopied(true); setCopyError("");
    } catch { setCopyError("يمكنك نسخ رابط الشعبة من شريط عنوان المتصفح."); }
  }

  return <section className="class-directory" aria-labelledby="class-directory-heading">
    <div className="search-deck class-controls">
      <div className="deck-heading">
        <div><p className="mb-2 flex items-center gap-2 text-xs font-bold text-primary"><CalendarDays className="size-4" /> جداول الشعب</p><h2 id="class-directory-heading" className="text-2xl font-black sm:text-3xl">كل شعبة، كل حصة، ومعلمها</h2><p className="mt-2 text-sm leading-7 text-muted-foreground">٣٩ شعبة · خمسة أيام · ثماني حصص يوميًا</p></div>
        <div className="class-mode-switch"><Button variant={mode === "browse" ? "default" : "outline"} onClick={() => setMode("browse")}><BookOpen /> جدول شعبة</Button><Button variant={mode === "map" ? "default" : "outline"} onClick={() => setMode("map")}><MapPin /> أين المعلم؟</Button></div>
      </div>
      <div className="relative"><Search className="pointer-events-none absolute right-4 top-1/2 size-5 -translate-y-1/2 text-primary" /><Input value={query} onChange={(event) => setQuery(event.target.value)} className="h-14 rounded-xl bg-background pr-12" placeholder="ابحث بالشعبة 8/3 أو باسم المعلم أو المادة..." aria-label="البحث في جداول الشعب" /></div>
      <div className="grade-chips mt-4" aria-label="اختيار صف جداول الشعب"><Button variant={grade === null ? "default" : "outline"} onClick={() => setGrade(null)}>كل الصفوف</Button>{[5, 6, 7, 8].map((item) => <Button key={item} variant={grade === item ? "default" : "outline"} onClick={() => setGrade(item)}>{GRADES[item]}</Button>)}</div>
      {favorites.length > 0 && <div className="favorite-classes"><span><Star className="size-4" /> شعبك المفضلة</span>{favorites.map((code) => <Button variant="secondary" key={code} onClick={() => openClass(code)}><bdi>{code}</bdi></Button>)}</div>}
      {mode === "map" && <div className="school-slot-picker"><p>اختر اليوم والحصة لعرض المعلم والمادة في كل شعبة.</p><nav className="schedule-day-picker" aria-label="يوم خريطة المدرسة">{days.map((item) => <button key={item} onClick={() => setDay(item)} aria-pressed={day === item}>{item}</button>)}</nav><div className="period-quick-picker" aria-label="حصة خريطة المدرسة">{PERIODS.map((item) => <Button key={item} variant={period === item ? "default" : "outline"} onClick={() => setPeriod(item)}>الحصة {item}</Button>)}</div></div>}
      <p className="mt-4 text-sm text-muted-foreground">{matches.length} شعبة {mode === "map" ? `· ${day} · الحصة ${period}` : "مطابقة"}</p>
      <div className="class-schedule-grid">{matches.map((schedule) => {
        const lesson = schedule.lessons.find((item) => item.day === day && item.periodStart <= period && item.periodEnd >= period);
        return <button className="class-schedule-tile" key={schedule.classCode} data-active={selectedCode === schedule.classCode && mode === "browse"} onClick={() => openClass(schedule.classCode)} aria-label={`فتح جدول الشعبة ${schedule.classCode}`}><strong><bdi>{schedule.classCode}</bdi></strong>{mode === "map" && lesson ? <><span>{lesson.subject}</span><small>{lesson.teacherLabel}</small></> : <><span>الصف {GRADES[schedule.grade]}</span><small>عرض الجدول الأسبوعي</small></>}</button>;
      })}</div>
      {matches.length === 0 && <p className="py-6 text-center text-muted-foreground">لا توجد شعبة مطابقة. جرّب اسمًا آخر أو غيّر الصف.</p>}
    </div>

    {selected && mode === "browse" && <section id="class-timetable" className="results-panel class-timetable" aria-labelledby="class-schedule-heading">
      <div className="class-schedule-header"><div><p className="text-sm text-muted-foreground">الصف {GRADES[selected.grade]}</p><h3 id="class-schedule-heading" className="text-2xl font-black">جدول الشعبة <bdi>{selected.classCode}</bdi></h3><p className="schedule-source-note">نسخة الملف: <bdi>{source.createdDate}</bdi> · صفحة {selected.sourcePage} · مطابق لجدول المعلمين</p></div><div className="class-schedule-actions"><Button variant="outline" onClick={() => toggleFavorite(selected.classCode)} aria-pressed={favorites.includes(selected.classCode)}><Star className={favorites.includes(selected.classCode) ? "fill-current" : ""} /> {favorites.includes(selected.classCode) ? "في المفضلة" : "تثبيت الشعبة"}</Button><Button variant="outline" onClick={copyLink}>{copied ? <Check /> : <Copy />}{copied ? "نُسخ الرابط" : "رابط الشعبة"}</Button><Button variant="outline" onClick={() => window.print()}><Printer /> طباعة</Button></div></div>
      {copyError && <p role="status" className="text-sm">{copyError}</p>}
      <div className="schedule-view-switch class-view-controls"><Button variant={!week ? "default" : "outline"} onClick={() => setWeek(false)}>عرض يومي</Button><Button variant={week ? "default" : "outline"} onClick={() => setWeek(true)}>الأسبوع كاملًا</Button></div>
      <div className={week ? "class-day-view hidden" : "class-day-view"}>
        <nav className="schedule-day-picker" aria-label="يوم جدول الشعبة">{days.map((item) => <button key={item} onClick={() => setDay(item)} aria-pressed={day === item}>{item}</button>)}</nav>
        <div className="class-day-lessons">{PERIODS.map((item) => {
          const lesson = selected.lessons.find((l) => l.day === day && l.periodStart <= item && l.periodEnd >= item);
          return <article className="class-period-card" key={item}><div className="class-period-index">{item}<span>الحصة</span></div>{lesson ? <div className="min-w-0 flex-1"><h4>{lesson.subject}</h4><button className="class-teacher-link" onClick={() => setSelectedTeacher(teacherById.get(lesson.teacherId) ?? null)}><UserRound />{lesson.teacherFullName}</button>{lesson.periodStart !== lesson.periodEnd && <p className="text-xs text-muted-foreground">حصة مزدوجة {lesson.periodStart}–{lesson.periodEnd}</p>}</div> : <p>لا توجد حصة مدرجة</p>}</article>;
        })}</div>
      </div>
      <div className={`weekly-table-scroll class-week-view${week ? "" : " screen-hidden"}`} tabIndex={0} role="region" aria-label="الجدول الأسبوعي للشعبة، قابل للتمرير أفقيًا">
        <table className="weekly-timetable class-weekly-table"><caption>الشعبة {selected.classCode} · المادة والمعلم · اضغط اسم المعلم لعرض جدوله</caption><thead><tr><th scope="col">اليوم</th>{PERIODS.map((item) => <th scope="col" key={item}>الحصة {item}</th>)}</tr></thead><tbody>{days.map((item) => <tr key={item}><th scope="row">{item}</th>{PERIODS.map((p) => {
          const lesson = selected.lessons.find((l) => l.day === item && l.periodStart <= p && l.periodEnd >= p);
          return <td key={p}>{lesson ? <><strong>{lesson.subject}</strong><button title={lesson.teacherFullName} onClick={() => { setDay(item); setSelectedTeacher(teacherById.get(lesson.teacherId) ?? null); }}>{lesson.teacherLabel}</button>{lesson.periodStart !== lesson.periodEnd && <small>مزدوجة {lesson.periodStart}–{lesson.periodEnd}</small>}</> : "—"}</td>;
        })}</tr>)}</tbody></table>
      </div>
      <p className="schedule-source-note">أرقام الحصص حسب الملف المعتمد. اضغط اسم أي معلم للانتقال إلى جدوله.</p>
    </section>}
    {!selected && mode === "browse" && <div className="results-panel empty-state"><CalendarDays className="size-10 text-primary" /><h3>اختر شعبة لفتح جدولها</h3><p>ثبّت الشعب الأكثر استخدامًا، أو انسخ رابط جدول الشعبة لمشاركته مع زملائك.</p></div>}
    {selectedTeacher && <TeacherScheduleDialog key={`${selectedTeacher.id}-${day}`} teacher={selectedTeacher} schoolDays={days} periodTimes={periodTimes} source={teacherSource} initialDay={day} onClose={() => setSelectedTeacher(null)} />}
  </section>;
}
