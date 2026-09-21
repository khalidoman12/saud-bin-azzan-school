import data from "@/data/classes.generated.json";
import type { ClassSchedule, TeacherSourceMetadata } from "@/lib/types";

export const CLASS_SCHEDULES = data.classes as ClassSchedule[];
export const CLASS_SOURCE = data.source as TeacherSourceMetadata;
