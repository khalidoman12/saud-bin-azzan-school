"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  ChevronLeft,
  CircleX,
  ListFilter,
  Moon,
  Search,
  ShieldCheck,
  Sun,
  UserRound,
  UsersRound,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { filterAndRankStudents } from "@/lib/search-core.mjs";
import type { ClassSummary, StudentRecord, StudentResult } from "@/lib/types";

type GradeCount = { grade: number; count: number; sections: number };
type Props = {
  classSummaries: ClassSummary[];
  gradeCounts: GradeCount[];
  students: StudentRecord[];
  totalStudents: number;
};

const GRADE_LABELS: Record<number, string> = {
  5: "الخامس",
  6: "السادس",
  7: "السابع",
  8: "الثامن",
};

function gradeLabel(grade: number) {
  return GRADE_LABELS[grade] ?? String(grade);
}

function StudentCard({ student, onSelect }: { student: StudentResult; onSelect: (student: StudentResult) => void }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(student)}
      className="student-card group w-full text-right focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/20"
      aria-label={`فتح تفاصيل الطالب ${student.fullName}`}
    >
      <span className="student-avatar" aria-hidden="true">{student.fullName.trim().charAt(0)}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-base font-bold leading-7 text-card-foreground sm:text-[1.05rem]">
          {student.fullName}
        </span>
        <span className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span>الصف {gradeLabel(student.grade)}</span>
          <span className="size-1 rounded-full bg-border" aria-hidden="true" />
          <span>الشعبة {student.section}</span>
          <span className="size-1 rounded-full bg-border" aria-hidden="true" />
          <span>الترتيب {student.rosterOrder}</span>
        </span>
      </span>
      <span className="student-chevron" aria-hidden="true"><ChevronLeft /></span>
    </button>
  );
}

function ResultsList({
  results,
  total,
  hasMore,
  ready,
  onSelect,
  onLoadMore,
}: {
  results: StudentResult[];
  total: number;
  hasMore: boolean;
  ready: boolean;
  onSelect: (student: StudentResult) => void;
  onLoadMore: () => void;
}) {
  if (!ready) {
    return (
      <div className="empty-state">
        <div className="empty-icon"><Search /></div>
        <h3>اكتب اسم الطالب</h3>
        <p>يمكنك البحث بالاسم الأول أو بأي جزء من الاسم، مع اختيار الصف والشعبة عند الحاجة.</p>
      </div>
    );
  }

  if (results.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-icon"><UserRound /></div>
        <h3>لا توجد نتائج مطابقة</h3>
        <p>جرّب جزءًا آخر من الاسم أو أزل أحد الفلاتر.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-foreground">
          {total.toLocaleString("ar-OM")} {total === 1 ? "نتيجة" : "نتائج"}
        </p>
        {results.length < total && <p className="text-xs text-muted-foreground">معروض {results.length.toLocaleString("ar-OM")}</p>}
      </div>
      <div className="space-y-3">
        {results.map((student) => <StudentCard key={student.id} student={student} onSelect={onSelect} />)}
      </div>
      {hasMore && (
        <Button type="button" variant="outline" size="lg" className="mt-4 h-12 w-full rounded-xl" onClick={onLoadMore}>
          عرض المزيد
        </Button>
      )}
    </div>
  );
}

function toResult(student: StudentRecord): StudentResult {
  return {
    id: student.id,
    fullName: student.fullName,
    grade: student.grade,
    section: student.section,
    rosterOrder: student.rosterOrder,
    enrollmentNumber: student.enrollmentNumber,
    academicYear: student.academicYear,
  };
}

export function StudentSearchApp({ classSummaries, gradeCounts, students, totalStudents }: Props) {
  const [activeTab, setActiveTab] = useState("search");
  const [query, setQuery] = useState("");
  const [searchGrade, setSearchGrade] = useState<number | null>(null);
  const [searchSection, setSearchSection] = useState<number | null>(null);
  const [browseGrade, setBrowseGrade] = useState<number | null>(null);
  const [browseSection, setBrowseSection] = useState<number | null>(null);
  const [results, setResults] = useState<StudentResult[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState<StudentResult | null>(null);

  const searchSections = useMemo(() => classSummaries.filter((item) => item.grade === searchGrade), [classSummaries, searchGrade]);
  const browseSections = useMemo(() => classSummaries.filter((item) => item.grade === browseGrade), [classSummaries, browseGrade]);
  const isSearchReady = query.trim().length > 0 || (searchGrade !== null && searchSection !== null);
  const isBrowseReady = browseGrade !== null && browseSection !== null;

  const findStudents = useCallback(({ append = false, browse = false }: { append?: boolean; browse?: boolean } = {}) => {
    const currentQuery = browse ? "" : query.trim();
    const grade = browse ? browseGrade : searchGrade;
    const section = browse ? browseSection : searchSection;
    const ready = currentQuery.length > 0 || (grade !== null && section !== null);

    if (!ready) {
      setResults([]);
      setTotal(0);
      setHasMore(false);
      return;
    }

    const ranked = filterAndRankStudents(students, {
      query: currentQuery,
      grade,
      section,
    }) as Array<{ student: StudentRecord; score: number }>;
    const offset = append ? results.length : 0;
    const limit = browse ? 100 : 40;
    const nextResults = ranked.slice(offset, offset + limit).map(({ student }) => toResult(student));

    setResults((current) => append ? [...current, ...nextResults] : nextResults);
    setTotal(ranked.length);
    setHasMore(offset + nextResults.length < ranked.length);
  }, [browseGrade, browseSection, query, results.length, searchGrade, searchSection, students]);

  useEffect(() => {
    if (activeTab !== "search") return;
    const timer = window.setTimeout(() => findStudents(), 120);
    return () => window.clearTimeout(timer);
  }, [activeTab, query, searchGrade, searchSection]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (activeTab !== "browse" || !isBrowseReady) return;
    const timer = window.setTimeout(() => findStudents({ browse: true }), 0);
    return () => window.clearTimeout(timer);
  }, [activeTab, browseGrade, browseSection]); // eslint-disable-line react-hooks/exhaustive-deps

  function toggleTheme() {
    const nextTheme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = nextTheme;
    window.localStorage.setItem("student-search-theme", nextTheme);
  }

  function selectSearchGrade(grade: number | null) {
    setSearchGrade(grade);
    setSearchSection(null);
  }

  function selectBrowseGrade(grade: number) {
    setBrowseGrade(grade);
    setBrowseSection(null);
    setResults([]);
    setTotal(0);
  }

  function openBrowseSection(section: number) {
    setBrowseSection(section);
    setResults([]);
    setTotal(0);
  }

  const currentReady = activeTab === "browse" ? isBrowseReady : isSearchReady;

  return (
    <main className="app-shell min-h-screen">
      <div className="mx-auto w-full max-w-6xl px-4 pb-10 pt-4 sm:px-6 sm:pt-6 lg:px-8">
        <header className="topbar">
          <div className="flex min-w-0 items-center gap-3">
            <div className="brand-mark" aria-hidden="true">س</div>
            <div className="min-w-0">
              <h1 className="truncate text-base font-black text-foreground sm:text-xl">نظام البحث عن الطلبة</h1>
              <p className="truncate text-xs text-muted-foreground sm:text-sm">مدرسة سعود بن عزان للتعليم الأساسي (5–8)</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="hidden h-9 gap-2 rounded-full border-primary/20 bg-primary/5 px-3 text-primary sm:flex">
              <UsersRound className="size-3.5" /> للاستخدام المدرسي
            </Badge>
            <Button type="button" variant="outline" size="icon-lg" className="rounded-full border-border/80 bg-card/80" onClick={toggleTheme} aria-label="تبديل الوضع الفاتح والداكن">
              <Sun className="theme-icon-dark" /><Moon className="theme-icon-light" />
            </Button>
          </div>
        </header>

        <section className="search-deck" aria-labelledby="search-heading">
          <div className="deck-heading">
            <div>
              <div className="mb-2 flex items-center gap-2 text-xs font-bold text-primary"><BookOpen className="size-4" /> قوائم المدرسة</div>
              <h2 id="search-heading" className="text-2xl font-black tracking-tight text-foreground sm:text-3xl">الوصول إلى الطالب خلال ثوانٍ</h2>
            </div>
            <div className="stats-strip" aria-label="إحصاءات القوائم">
              <div><strong>{totalStudents.toLocaleString("ar-OM")}</strong><span>طالبًا</span></div>
              <div><strong>{classSummaries.length.toLocaleString("ar-OM")}</strong><span>شعبة</span></div>
            </div>
          </div>

          <Tabs value={activeTab} onValueChange={(value) => { setActiveTab(value); setResults([]); setTotal(0); }} dir="rtl">
            <TabsList className="mb-5 h-12 w-full rounded-xl bg-secondary/70 p-1 sm:w-auto">
              <TabsTrigger value="search" className="h-10 rounded-lg px-5 text-sm sm:min-w-40"><Search /> البحث بالاسم</TabsTrigger>
              <TabsTrigger value="browse" className="h-10 rounded-lg px-5 text-sm sm:min-w-40"><BookOpen /> تصفح الفصول</TabsTrigger>
            </TabsList>

            <TabsContent value="search" className="space-y-5">
              <div className="relative">
                <Search className="pointer-events-none absolute right-4 top-1/2 size-5 -translate-y-1/2 text-primary" />
                <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ابحث عن طالب..." className="h-15 rounded-2xl border-border/80 bg-background pr-12 pl-12 text-base shadow-sm placeholder:text-muted-foreground sm:h-16 sm:text-lg" autoComplete="off" spellCheck={false} aria-label="البحث عن طالب" />
                {query && (
                  <Button type="button" variant="ghost" size="icon-sm" className="absolute left-4 top-1/2 -translate-y-1/2 rounded-full" onClick={() => setQuery("")} aria-label="مسح البحث"><CircleX /></Button>
                )}
              </div>

              <div className="filter-row">
                <div className="flex items-center gap-2 text-sm font-bold text-foreground"><ListFilter className="size-4 text-primary" /> الصف</div>
                <div className="grade-chips" aria-label="تصفية حسب الصف">
                  <Button type="button" variant={searchGrade === null ? "default" : "outline"} onClick={() => selectSearchGrade(null)}>الكل</Button>
                  {[5, 6, 7, 8].map((grade) => (
                    <Button type="button" key={grade} variant={searchGrade === grade ? "default" : "outline"} onClick={() => selectSearchGrade(grade)}>{gradeLabel(grade)}</Button>
                  ))}
                </div>
                <Select value={searchSection === null ? "all" : String(searchSection)} onValueChange={(value) => setSearchSection(value === "all" ? null : Number(value))} disabled={searchGrade === null} dir="rtl">
                  <SelectTrigger className="h-11 w-full rounded-xl bg-background sm:w-44"><SelectValue placeholder="اختر الشعبة" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">كل الشعب</SelectItem>
                    {searchSections.map((item) => <SelectItem key={item.section} value={String(item.section)}>الشعبة {item.section}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </TabsContent>

            <TabsContent value="browse" className="space-y-5">
              <div>
                <p className="mb-3 text-sm font-bold text-foreground">اختر الصف</p>
                <div className="grade-browser-grid">
                  {gradeCounts.map((item) => (
                    <button type="button" key={item.grade} className="grade-browser-card" data-active={browseGrade === item.grade} onClick={() => selectBrowseGrade(item.grade)}>
                      <span className="grade-number">{item.grade}</span>
                      <span className="min-w-0 text-right"><strong>الصف {gradeLabel(item.grade)}</strong><small>{item.sections} شعب • {item.count} طالبًا</small></span>
                    </button>
                  ))}
                </div>
              </div>

              {browseGrade !== null && (
                <div className="class-picker">
                  <p className="mb-3 text-sm font-bold text-foreground">اختر الشعبة</p>
                  <div className="class-chips">
                    {browseSections.map((item) => (
                      <button type="button" key={item.section} data-active={browseSection === item.section} onClick={() => openBrowseSection(item.section)}>
                        <strong>{item.grade}/{item.section}</strong><span>{item.count} طالبًا</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </section>

        <section className="results-panel" aria-live="polite">
          {activeTab === "browse" && isBrowseReady && (
            <div className="mb-5 flex flex-wrap items-end justify-between gap-3 border-b border-border/70 pb-4">
              <div><p className="text-sm text-muted-foreground">قائمة الفصل</p><h2 className="text-xl font-black text-foreground">الصف {gradeLabel(browseGrade)} — {browseGrade}/{browseSection}</h2></div>
              <Badge variant="secondary" className="rounded-full px-3 py-1.5"><UsersRound className="size-3.5" /> {total || browseSections.find((item) => item.section === browseSection)?.count || 0} طالبًا</Badge>
            </div>
          )}
          <ResultsList results={results} total={total} hasMore={hasMore} ready={currentReady} onSelect={setSelectedStudent} onLoadMore={() => findStudents({ append: true, browse: activeTab === "browse" })} />
        </section>

        <footer className="mt-8 flex flex-col items-center justify-between gap-2 border-t border-border/60 pt-5 text-center text-xs text-muted-foreground sm:flex-row sm:text-right">
          <span>البيانات مخصصة للاستخدام المدرسي المصرح به فقط.</span><span>العام الدراسي 2026/2027م</span>
        </footer>
      </div>

      <Dialog open={selectedStudent !== null} onOpenChange={(open) => !open && setSelectedStudent(null)}>
        <DialogContent dir="rtl" showCloseButton={false} className="rounded-3xl border-border/80 p-0 sm:max-w-xl">
          {selectedStudent && (
            <>
              <DialogHeader className="detail-header text-right sm:text-right">
                <div className="detail-avatar" aria-hidden="true">{selectedStudent.fullName.trim().charAt(0)}</div>
                <div><DialogDescription className="mb-1 text-primary">بيانات الطالب</DialogDescription><DialogTitle className="text-xl font-black leading-8 sm:text-2xl">{selectedStudent.fullName}</DialogTitle></div>
              </DialogHeader>
              <div className="grid gap-3 px-5 sm:grid-cols-2 sm:px-6">
                <Card className="detail-field"><CardHeader><CardDescription>الصف</CardDescription><CardTitle>{gradeLabel(selectedStudent.grade)}</CardTitle></CardHeader></Card>
                <Card className="detail-field"><CardHeader><CardDescription>الشعبة</CardDescription><CardTitle>{selectedStudent.grade}/{selectedStudent.section}</CardTitle></CardHeader></Card>
                <Card className="detail-field"><CardHeader><CardDescription>الترتيب في كشف الفصل</CardDescription><CardTitle>{selectedStudent.rosterOrder}</CardTitle></CardHeader></Card>
                <Card className="detail-field"><CardHeader><CardDescription>العام الدراسي</CardDescription><CardTitle>{selectedStudent.academicYear}م</CardTitle></CardHeader></Card>
              </div>
              <Card className="mx-5 border-primary/15 bg-primary/5 shadow-none sm:mx-6"><CardContent className="flex gap-3 p-4 text-sm leading-6 text-muted-foreground"><ShieldCheck className="mt-0.5 size-5 shrink-0 text-primary" /><p>لا يتضمن السجل رقم قيد؛ الرقم الظاهر هو ترتيب الطالب داخل كشف الفصل فقط.</p></CardContent></Card>
              <DialogFooter className="px-5 pb-5 pt-1 sm:px-6 sm:pb-6"><DialogClose asChild><Button type="button" size="lg" className="h-11 w-full rounded-xl">إغلاق</Button></DialogClose></DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </main>
  );
}
