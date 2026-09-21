"use client";

import { useMemo, useState } from "react";
import {
  Award,
  BookOpen,
  Building2,
  BusFront,
  CalendarDays,
  CircleX,
  Clapperboard,
  ExternalLink,
  HandHeart,
  HeartPulse,
  Images,
  Megaphone,
  Search,
  SlidersHorizontal,
  Sparkles,
  UsersRound,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { normalizeArabic } from "@/lib/search-core.mjs";
import type { ActivityCategory, ActivityMedia, ActivitySourceMetadata, SchoolActivity } from "@/lib/types";

type Props = {
  activities: SchoolActivity[];
  categoryCounts: Array<{ category: ActivityCategory; count: number }>;
  audiences: string[];
  source: ActivitySourceMetadata;
};

const CATEGORY_META: Record<ActivityCategory, { label: string; icon: typeof Megaphone }> = {
  guidance: { label: "الإرشاد النفسي والاجتماعي", icon: HandHeart },
  teaching: { label: "التعليم والحصص", icon: BookOpen },
  administration: { label: "الإدارة والتنظيم", icon: Building2 },
  visits: { label: "الزيارات", icon: UsersRound },
  honors: { label: "التكريم والتهنئة", icon: Award },
  health: { label: "الصحة والسلامة", icon: HeartPulse },
  community: { label: "الشراكة المجتمعية", icon: HandHeart },
  "student-life": { label: "المبادرات الطلابية", icon: Sparkles },
  transport: { label: "النقل المدرسي", icon: BusFront },
  media: { label: "التغطيات والملخصات", icon: Clapperboard },
};

const GRADE_LABELS: Record<number, string> = {
  5: "الخامس",
  6: "السادس",
  7: "السابع",
  8: "الثامن",
};

function formatActivityDate(date: string) {
  return new Intl.DateTimeFormat("ar-OM", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));
}

function searchableText(activity: SchoolActivity) {
  const categoryLabel = CATEGORY_META[activity.category].label;
  const gradeText = activity.grades.map((grade) => `الصف ${GRADE_LABELS[grade] ?? grade}`).join(" ");
  return normalizeArabic([
    activity.title,
    activity.description,
    categoryLabel,
    ...activity.audiences,
    ...activity.people,
    gradeText,
    activity.date,
  ].join(" "), { soft: true });
}

function ActivityImage({ media, sourceUrl }: { media: ActivityMedia; sourceUrl: string }) {
  const [failed, setFailed] = useState(false);
  const [fallback, setFallback] = useState(false);
  const localUrl = media.localPath ? `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}${media.localPath}` : media.url;
  const imageUrl = fallback ? media.url : localUrl;
  return <a href={failed || media.type === "video" ? sourceUrl : imageUrl} target="_blank" rel="noreferrer" className="activity-media-item" aria-label={media.type === "video" ? `مشاهدة الفيديو الأصلي: ${media.alt}` : `تكبير الصورة: ${media.alt}`}>
    {failed ? <span className="activity-image-fallback"><Images />تعذر تحميل الصورة · افتح المنشور</span> : <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={imageUrl} alt={media.alt} loading="lazy" referrerPolicy="no-referrer" onError={() => { if (media.localPath && !fallback) setFallback(true); else setFailed(true); }} />
    </>}
    {media.type === "video" && <span className="activity-video-label"><Clapperboard /> مشاهدة الفيديو</span>}
  </a>;
}

function ActivityCard({ activity }: { activity: SchoolActivity }) {
  const meta = CATEGORY_META[activity.category];
  const CategoryIcon = meta.icon;
  const visibleMedia = activity.media;

  return (
    <article className="activity-card">
      {visibleMedia.length > 0 && (
        <div className="activity-media" data-count={Math.min(visibleMedia.length, 4)}>
          {visibleMedia.map((media, index) => <ActivityImage key={`${media.url}-${index}`} media={media} sourceUrl={activity.sourceUrl} />)}
        </div>
      )}

      <div className="activity-card-body">
        <div className="activity-badges">
          <Badge variant="secondary" className="rounded-full"><CategoryIcon /> {meta.label}</Badge>
          {activity.specialist && <Badge className="rounded-full"><HandHeart /> أعمال الأخصائيين</Badge>}
        </div>
        <p className="activity-date"><CalendarDays /> {formatActivityDate(activity.date)}{!activity.verifiedAt && <span> · تاريخ أرشيفي قيد التحقق</span>}</p>
        <h3>{activity.title}</h3>
        <p className="activity-description">{activity.description}</p>

        {(activity.people.length > 0 || activity.grades.length > 0) && (
          <div className="activity-meta-list">
            {activity.people.length > 0 && <p><UsersRound /> <span>{activity.people.join("، ")}</span></p>}
            {activity.grades.length > 0 && (
              <p><BookOpen /> <span>{activity.grades.map((grade) => `الصف ${GRADE_LABELS[grade] ?? grade}`).join("، ")}</span></p>
            )}
          </div>
        )}

        <div className="activity-card-footer">
          <div className="activity-audiences" aria-label="الفئات المستفيدة">
            {activity.audiences.map((audience) => <span key={audience}>{audience}</span>)}
          </div>
          <a href={activity.sourceUrl} target="_blank" rel="noreferrer" className="activity-source-link">
            {activity.sourceLabel}<ExternalLink />
          </a>
        </div>
      </div>
    </article>
  );
}

export function ActivitiesDirectory({ activities, categoryCounts, audiences, source }: Props) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<ActivityCategory | "all">("all");
  const [audience, setAudience] = useState("all");
  const [grade, setGrade] = useState<number | null>(null);
  const [specialistsOnly, setSpecialistsOnly] = useState(false);
  const [visibleCount, setVisibleCount] = useState(12);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [withImages, setWithImages] = useState(false);

  const filteredActivities = useMemo(() => {
    const normalizedQuery = normalizeArabic(query, { soft: true });
    const tokens = normalizedQuery.split(" ").filter(Boolean);
    return activities
      .filter((activity) => category === "all" || activity.category === category)
      .filter((activity) => audience === "all" || activity.audiences.includes(audience))
      .filter((activity) => grade === null || activity.grades.includes(grade))
      .filter((activity) => !specialistsOnly || activity.specialist)
      .filter((activity) => !fromDate || activity.date >= fromDate)
      .filter((activity) => !toDate || activity.date <= toDate)
      .filter((activity) => !withImages || activity.media.length > 0)
      .filter((activity) => {
        if (tokens.length === 0) return true;
        const haystack = searchableText(activity);
        return tokens.every((token) => haystack.includes(token));
      })
      .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  }, [activities, audience, category, grade, query, specialistsOnly, fromDate, toDate, withImages]);

  const visibleActivities = filteredActivities.slice(0, visibleCount);
  const specialistCount = activities.filter((activity) => activity.specialist).length;
  const mediaCount = activities.filter((activity) => activity.media.length > 0).length;
  const hasFilters = query.trim() || category !== "all" || audience !== "all" || grade !== null || specialistsOnly || fromDate || toDate || withImages;

  function resetFilters() {
    setQuery("");
    setCategory("all");
    setAudience("all");
    setGrade(null);
    setSpecialistsOnly(false);
    setVisibleCount(12);
    setFromDate("");
    setToDate("");
    setWithImages(false);
  }

  function selectSpecialists() {
    setSpecialistsOnly((current) => !current);
    setCategory("all");
    setVisibleCount(12);
  }

  return (
    <section aria-labelledby="activities-heading">
      <div className="search-deck activities-deck">
        <div className="deck-heading">
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs font-bold text-primary"><Megaphone className="size-4" /> سجل المدرسة الرقمي</div>
            <h2 id="activities-heading" className="text-2xl font-black tracking-tight text-foreground sm:text-3xl">الأنشطة والبرامج والأعمال المدرسية</h2>
            <p className="mt-2 max-w-2xl text-sm leading-7 text-muted-foreground">ابحث في الفعاليات، أو صفِّ النتائج حسب نوع العمل والفئة المستفيدة والصف.</p>
          </div>
          <div className="activities-stats" aria-label="إحصاءات الأنشطة">
            <div><strong>{activities.length.toLocaleString("ar-OM")}</strong><span>فعالية</span></div>
            <div><strong>{specialistCount.toLocaleString("ar-OM")}</strong><span>للأخصائيين</span></div>
            <div><strong>{mediaCount.toLocaleString("ar-OM")}</strong><span>بصور أو فيديو</span></div>
          </div>
        </div>

        <button type="button" className="specialist-feature" data-active={specialistsOnly} onClick={selectSpecialists}>
          <span className="specialist-feature-icon"><HandHeart /></span>
          <span><strong>أنشطة وأعمال الأخصائيين النفسيين والاجتماعيين</strong><small>جلسات إرشادية، برامج توعوية، متابعات ومبادرات طلابية</small></span>
          <Badge variant={specialistsOnly ? "default" : "secondary"}>{specialistsOnly ? "محدد" : `${specialistCount} عملًا`}</Badge>
        </button>

        <div className="activity-search-wrap">
          <Search />
          <Input
            value={query}
            onChange={(event) => { setQuery(event.target.value); setVisibleCount(12); }}
            placeholder="ابحث بكلمة: إرشاد، تكريم، زيارة، اسم المعلم..."
            className="h-15 rounded-2xl border-border/80 bg-background pr-12 pl-12 text-base shadow-sm placeholder:text-muted-foreground"
            aria-label="البحث في أنشطة المدرسة"
          />
          {query && <Button type="button" variant="ghost" size="icon-sm" onClick={() => setQuery("")} aria-label="مسح البحث"><CircleX /></Button>}
        </div>

        <div className="activity-filters">
          <p className="activity-filter-title"><SlidersHorizontal /> تصفية متقدمة</p>
          <Select value={category} onValueChange={(value) => { setCategory(value as ActivityCategory | "all"); setVisibleCount(12); }} dir="rtl">
            <SelectTrigger className="h-11 rounded-xl bg-background"><SelectValue placeholder="نوع النشاط" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">جميع التصنيفات ({activities.length})</SelectItem>
              {categoryCounts.map((item) => <SelectItem key={item.category} value={item.category}>{CATEGORY_META[item.category].label} ({item.count})</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={audience} onValueChange={(value) => { setAudience(value); setVisibleCount(12); }} dir="rtl">
            <SelectTrigger className="h-11 rounded-xl bg-background"><SelectValue placeholder="الفئة المستفيدة" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل الفئات المستفيدة</SelectItem>
              {audiences.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={grade === null ? "all" : String(grade)} onValueChange={(value) => { setGrade(value === "all" ? null : Number(value)); setVisibleCount(12); }} dir="rtl">
            <SelectTrigger className="h-11 rounded-xl bg-background"><SelectValue placeholder="الصف" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل الصفوف</SelectItem>
              {[5, 6, 7, 8].map((item) => <SelectItem key={item} value={String(item)}>الصف {GRADE_LABELS[item]}</SelectItem>)}
            </SelectContent>
          </Select>
          {hasFilters && <Button type="button" variant="outline" className="h-11 rounded-xl" onClick={resetFilters}><CircleX /> مسح الفلاتر</Button>}
        </div>
        <div className="activity-date-filters">
          <label>من تاريخ<Input type="date" value={fromDate} onChange={(event) => { setFromDate(event.target.value); setVisibleCount(12); }} /></label>
          <label>إلى تاريخ<Input type="date" value={toDate} onChange={(event) => { setToDate(event.target.value); setVisibleCount(12); }} /></label>
          <Button variant={withImages ? "default" : "outline"} aria-pressed={withImages} onClick={() => { setWithImages(!withImages); setVisibleCount(12); }}><Images /> بصور أو فيديو</Button>
        </div>
      </div>

      <div className="activities-results" aria-live="polite">
        <div className="activities-results-heading">
          <div><p>نتائج السجل</p><h3>{filteredActivities.length.toLocaleString("ar-OM")} {filteredActivities.length === 1 ? "فعالية مطابقة" : "فعالية مطابقة"}</h3></div>
          <a href={source.accountUrl} target="_blank" rel="noreferrer">{source.account}<ExternalLink /></a>
        </div>

        {visibleActivities.length > 0 ? (
          <div className="activities-grid">
            {visibleActivities.map((activity) => <ActivityCard key={activity.id} activity={activity} />)}
          </div>
        ) : (
          <div className="empty-state">
            <div className="empty-icon"><Search /></div>
            <h3>لا توجد فعالية مطابقة</h3>
            <p>جرّب كلمة أخرى أو امسح بعض الفلاتر.</p>
          </div>
        )}

        {visibleActivities.length < filteredActivities.length && (
          <Button type="button" variant="outline" size="lg" className="mt-4 h-12 w-full rounded-xl" onClick={() => setVisibleCount((count) => count + 12)}>
            عرض المزيد
          </Button>
        )}

        <p className="activities-sync-note">
          <Images /> الأخبار المتاحة من <bdi>{source.rangeStart}</bdi> إلى <bdi>{source.rangeEnd}</bdi>. الأرشيف غير مكتمل لأن X يعرض جزءًا من المنشورات للزائر. تُضاف الأخبار المتاحة تلقائيًا، ويُفتح الفيديو في منشوره الأصلي.
        </p>
      </div>
    </section>
  );
}
