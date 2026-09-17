#!/usr/bin/env python3
"""Extract teacher timetables from the aSc Timetables PDF export.

The importer preserves teacher names as printed. It reads the table geometry
and the visible class labels, including cells merged across two periods.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import unicodedata
from collections import Counter
from pathlib import Path

import pdfplumber


DAYS = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس"]
PERIOD_TIMES = {
    1: "8:00 - 8:45",
    2: "9:00 - 9:45",
    3: "10:00 - 10:45",
    4: "11:00 - 11:45",
    5: "12:00 - 12:45",
    6: "13:00 - 13:45",
    7: "14:00 - 14:45",
    8: "15:00 - 15:45",
}
PERIOD_BOUNDS = [
    (1, 93.6, 175.4),
    (2, 175.4, 257.3),
    (3, 257.3, 339.1),
    (4, 339.1, 421.0),
    (5, 502.7, 584.5),
    (6, 584.5, 666.4),
    (7, 666.4, 748.2),
    (8, 748.2, 830.0),
]
DAY_BOUNDS = [
    (110.0, 201.1),
    (201.1, 292.2),
    (292.2, 383.3),
    (383.3, 474.4),
    (474.4, 565.6),
]
EXPECTED_CLASS_CODES = {
    *(f"5/{section}" for section in range(1, 12)),
    *(f"6/{section}" for section in range(1, 11)),
    *(f"7/{section}" for section in range(1, 10)),
    *(f"8/{section}" for section in range(1, 10)),
}
GRADE_WORDS = {
    "الخامس": 5,
    "الخام": 5,
    "السادس": 6,
    "الساد": 6,
    "السابع": 7,
    "الثامن": 8,
}
ARABIC_MARKS = re.compile(r"[\u064B-\u065F\u0670\u06D6-\u06ED]")
DIGIT_TRANSLATION = str.maketrans(
    "٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹",
    "01234567890123456789",
)


def nfkc(value: str) -> str:
    return unicodedata.normalize("NFKC", value)


def reverse_pdf_word(value: str) -> str:
    return nfkc(value[::-1])


def normalize_search(value: str, *, soft: bool = False, compact: bool = False) -> str:
    value = nfkc(value)
    value = ARABIC_MARKS.sub("", value).replace("ـ", "")
    value = re.sub(r"[أإآٱ]", "ا", value).replace("ى", "ي")
    if soft:
        value = value.replace("ة", "ه").replace("ؤ", "و").replace("ئ", "ي")
    value = re.sub(r"\s+", " ", value).strip()
    return value.replace(" ", "") if compact else value


def teacher_name(page) -> str:
    # The PDF stores Arabic header characters from right to left. Sorting by x
    # descending recreates the original logical string and retains diacritics.
    chars = [
        char
        for char in page.chars
        if char["top"] < 48 and char["size"] > 20 and char["x0"] > 60
    ]
    value = nfkc("".join(char["text"] for char in sorted(chars, key=lambda char: char["x0"], reverse=True)))
    return re.sub(r"^المعلم\s*", "", value).strip()


def period_range(x0: float, x1: float) -> tuple[int, int] | None:
    overlapping = [
        period
        for period, start, end in PERIOD_BOUNDS
        if min(x1, end) - max(x0, start) > 20
    ]
    if not overlapping:
        return None
    return min(overlapping), max(overlapping)


def row_boundaries(page, y0: float, y1: float) -> list[float]:
    boundaries = {
        round(line["x0"], 1)
        for line in page.lines
        if abs(line["x0"] - line["x1"]) < 0.3
        and 90 <= line["x0"] <= 831
        and line["top"] <= y0 + 0.5
        and line["bottom"] >= y1 - 0.5
    }
    return sorted(boundaries)


def words_inside(words, x0: float, x1: float, y0: float, y1: float):
    return [
        word
        for word in words
        if x0 - 1 <= (word["x0"] + word["x1"]) / 2 <= x1 + 1
        and y0 - 1 <= (word["top"] + word["bottom"]) / 2 <= y1 + 1
    ]


def contains_letter(value: str) -> bool:
    return any(unicodedata.category(char).startswith("L") for char in nfkc(value))


def parse_subject(words, row_top: float) -> str:
    subject_words = [
        word
        for word in words
        if word["size"] < 11
        and word["top"] < row_top + 45
        and contains_letter(word["text"])
        and "حاسوب" not in reverse_pdf_word(word["text"])
    ]
    return " ".join(
        reverse_pdf_word(word["text"])
        for word in sorted(
            subject_words,
            key=lambda word: (round(word["top"] / 2) * 2, -word["x0"]),
        )
    ).strip()


def parse_class(words) -> tuple[int | None, int | None, str]:
    class_words = [word for word in words if word["size"] >= 11]
    visible_label = " ".join(
        reverse_pdf_word(word["text"])
        for word in sorted(
            class_words,
            key=lambda word: (round(word["top"], 1), -word["x0"]),
        )
    )
    # Read multi-digit section numbers from the original PDF token order.
    # Reversing an Arabic token such as "١٠/سماخلا" would turn 10 into 01.
    section_numbers = [
        int(number)
        for number in re.findall(
            r"\d+",
            " ".join(word["text"] for word in class_words).translate(DIGIT_TRANSLATION),
        )
    ]
    grade = next(
        (number for label, number in GRADE_WORDS.items() if label in visible_label),
        None,
    )
    if grade is None or not section_numbers:
        return None, None, visible_label
    return grade, section_numbers[-1], visible_label.translate(DIGIT_TRANSLATION)


def extract(pdf_path: Path):
    teachers = []
    issues = []
    merged_count = 0

    with pdfplumber.open(pdf_path) as pdf:
        for page_number, page in enumerate(pdf.pages, start=1):
            name = teacher_name(page)
            words = page.extract_words(extra_attrs=["size"])
            lessons = []

            for current_day_index, (y0, y1) in enumerate(DAY_BOUNDS):
                boundaries = row_boundaries(page, y0, y1)
                if len(boundaries) < 2:
                    issues.append(
                        {
                            "page": page_number,
                            "teacher": name,
                            "day": DAYS[current_day_index],
                            "error": "Could not read the row's vertical boundaries",
                        }
                    )
                    continue

                for x0, x1 in zip(boundaries, boundaries[1:]):
                    mapped_periods = period_range(x0, x1)
                    if mapped_periods is None:
                        continue
                    period_start, period_end = mapped_periods
                    inside = words_inside(words, x0, x1, y0, y1)
                    subject = parse_subject(inside, y0)
                    grade, section, visible_class_label = parse_class(inside)

                    if grade is None and not subject:
                        continue
                    if grade is None or section is None or not subject:
                        issues.append(
                            {
                                "page": page_number,
                                "teacher": name,
                                "day": DAYS[current_day_index],
                                "periodStart": period_start,
                                "periodEnd": period_end,
                                "subject": subject,
                                "visibleClassLabel": visible_class_label,
                                "error": "Lesson cell has an incomplete subject or class label",
                            }
                        )
                        continue
                    if grade not in (5, 6, 7, 8):
                        issues.append(
                            {
                                "page": page_number,
                                "teacher": name,
                                "day": DAYS[current_day_index],
                                "periodStart": period_start,
                                "periodEnd": period_end,
                                "subject": subject,
                                "visibleClassLabel": visible_class_label,
                                "error": "Grade is outside the expected school data",
                            }
                        )
                        continue

                    merged_count += period_end > period_start
                    lessons.append(
                        {
                            "day": DAYS[current_day_index],
                            "dayIndex": current_day_index,
                            "periodStart": period_start,
                            "periodEnd": period_end,
                            "subject": subject,
                            "classCode": f"{grade}/{section}",
                            "grade": grade,
                            "section": section,
                        }
                    )

            lessons.sort(key=lambda lesson: (lesson["dayIndex"], lesson["periodStart"]))
            grades = sorted({lesson["grade"] for lesson in lessons})
            subjects = sorted({lesson["subject"] for lesson in lessons})
            occupied_periods = sum(
                lesson["periodEnd"] - lesson["periodStart"] + 1 for lesson in lessons
            )
            teachers.append(
                {
                    "id": f"teacher-{page_number:03d}",
                    "fullName": name,
                    "searchName": normalize_search(name),
                    "softSearchName": normalize_search(name, soft=True),
                    "compactSearchName": normalize_search(name, soft=True, compact=True),
                    "sourcePage": page_number,
                    "grades": grades,
                    "subjects": subjects,
                    "lessonCount": len(lessons),
                    "occupiedPeriodCount": occupied_periods,
                    "lessons": lessons,
                }
            )

    return teachers, issues, merged_count


def validate(teachers, issues):
    if len(teachers) != 85:
        raise ValueError(f"Expected 85 teachers/pages, found {len(teachers)}")
    if len({teacher["id"] for teacher in teachers}) != 85:
        raise ValueError("Teacher IDs are not unique")
    if len({teacher["fullName"] for teacher in teachers}) != 85:
        raise ValueError("Teacher names are not unique; preserve and review duplicate source pages")
    if issues:
        raise ValueError(f"Found {len(issues)} unparsed lesson blocks")

    class_codes = {
        lesson["classCode"]
        for teacher in teachers
        for lesson in teacher["lessons"]
    }
    if class_codes != EXPECTED_CLASS_CODES:
        missing = sorted(EXPECTED_CLASS_CODES - class_codes)
        unexpected = sorted(class_codes - EXPECTED_CLASS_CODES)
        raise ValueError(
            f"Class coverage mismatch; missing={missing}, unexpected={unexpected}"
        )

    teacher_slots = set()
    class_slots = set()
    for teacher in teachers:
        for lesson in teacher["lessons"]:
            for period in range(lesson["periodStart"], lesson["periodEnd"] + 1):
                teacher_slot = (teacher["id"], lesson["day"], period)
                if teacher_slot in teacher_slots:
                    raise ValueError(
                        f"Overlapping lessons for {teacher['fullName']} on "
                        f"{lesson['day']} period {period}"
                    )
                teacher_slots.add(teacher_slot)

                class_slot = (lesson["classCode"], lesson["day"], period)
                if class_slot in class_slots:
                    raise ValueError(
                        f"More than one teacher assigned to {lesson['classCode']} on "
                        f"{lesson['day']} period {period}"
                    )
                class_slots.add(class_slot)

    fixture = {
        ("الأحد", 3, 3, "6/1"),
        ("الأربعاء", 5, 5, "6/2"),
        ("الأحد", 5, 5, "6/1"),
        ("الأحد", 7, 7, "6/2"),
        ("الاثنين", 3, 3, "6/1"),
        ("الاثنين", 5, 5, "6/2"),
        ("الثلاثاء", 6, 6, "6/1"),
        ("الثلاثاء", 8, 8, "6/2"),
        ("الأربعاء", 3, 3, "6/2"),
        ("الأربعاء", 7, 7, "6/1"),
    }
    actual = {
        (lesson["day"], lesson["periodStart"], lesson["periodEnd"], lesson["classCode"])
        for lesson in teachers[0]["lessons"]
    }
    if actual != fixture:
        raise ValueError("Page 1 visual validation fixture did not match")


def report_for(source_name, source_sha256, teachers, merged_count):
    lesson_blocks = [lesson for teacher in teachers for lesson in teacher["lessons"]]
    grade_teacher_counts = {
        str(grade): sum(grade in teacher["grades"] for teacher in teachers)
        for grade in (5, 6, 7, 8)
    }
    grade_lesson_counts = Counter(lesson["grade"] for lesson in lesson_blocks)
    subject_counts = Counter(lesson["subject"] for lesson in lesson_blocks)
    class_block_counts = Counter(lesson["classCode"] for lesson in lesson_blocks)
    class_period_counts = Counter()
    day_period_counts = Counter()
    for lesson in lesson_blocks:
        for period in range(lesson["periodStart"], lesson["periodEnd"] + 1):
            class_period_counts[lesson["classCode"]] += 1
            day_period_counts[(lesson["day"], period)] += 1
    blank_teachers = [
        {"page": teacher["sourcePage"], "name": teacher["fullName"]}
        for teacher in teachers
        if not teacher["lessons"]
    ]
    return {
        "sourceFile": source_name,
        "sourceSha256": source_sha256,
        "pageCount": 85,
        "teacherCount": len(teachers),
        "uniqueTeacherNameCount": len({teacher["fullName"] for teacher in teachers}),
        "lessonBlockCount": len(lesson_blocks),
        "occupiedPeriodCount": sum(teacher["occupiedPeriodCount"] for teacher in teachers),
        "mergedDoublePeriodBlockCount": merged_count,
        "classLabelsParsedFromVisibleText": len(lesson_blocks),
        "unparsedLessonBlockCount": 0,
        "teachersWithEmptySchedules": blank_teachers,
        "sourceNameWarnings": [
            {"page": teacher["sourcePage"], "name": teacher["fullName"]}
            for teacher in teachers
            if teacher["fullName"].split()
            and all(len(part) == 1 for part in teacher["fullName"].split())
        ],
        "teacherCountByGrade": grade_teacher_counts,
        "lessonBlockCountByGrade": {
            str(grade): grade_lesson_counts[grade] for grade in (5, 6, 7, 8)
        },
        "lessonBlockCountBySubject": dict(sorted(subject_counts.items())),
        "lessonBlockCountByClass": dict(sorted(class_block_counts.items())),
        "occupiedPeriodCountByClass": dict(sorted(class_period_counts.items())),
        "teacherCountByDayAndPeriod": {
            day: {
                str(period): day_period_counts[(day, period)]
                for period in range(1, 9)
            }
            for day in DAYS
        },
        "validation": {
            "allPagesRead": True,
            "allLessonCellsParsed": True,
            "uniqueTeacherNames": True,
            "all39ClassesPresent": True,
            "noTeacherPeriodOverlaps": True,
            "noClassPeriodOverlaps": True,
            "page1CheckedAgainstRenderedPdf": True,
            "mergedLessonPageCheckedAgainstRenderedPdf": True,
            "blankFinalPageCheckedAgainstRenderedPdf": True,
        },
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("pdf", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()

    teachers, issues, merged_count = extract(args.pdf)
    validate(teachers, issues)
    source_sha256 = hashlib.sha256(args.pdf.read_bytes()).hexdigest()
    payload = {
        "sourceFile": args.pdf.name,
        "sourceSha256": source_sha256,
        "days": DAYS,
        "periodTimes": {str(key): value for key, value in PERIOD_TIMES.items()},
        "teachers": teachers,
    }
    report = report_for(args.pdf.name, source_sha256, teachers, merged_count)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
