import activityData from "@/data/activities.generated.json";
import type { ActivityCategory, ActivitySourceMetadata, SchoolActivity } from "@/lib/types";

export const ACTIVITIES = activityData.activities as SchoolActivity[];
export const ACTIVITY_SOURCE = activityData.source as ActivitySourceMetadata;

export const ACTIVITY_CATEGORY_COUNTS = Object.entries(
  ACTIVITIES.reduce<Record<string, number>>((counts, activity) => {
    counts[activity.category] = (counts[activity.category] ?? 0) + 1;
    return counts;
  }, {}),
).map(([category, count]) => ({ category: category as ActivityCategory, count }));

export const ACTIVITY_AUDIENCES = Array.from(
  new Set(ACTIVITIES.flatMap((activity) => activity.audiences)),
).sort((a, b) => a.localeCompare(b, "ar"));
