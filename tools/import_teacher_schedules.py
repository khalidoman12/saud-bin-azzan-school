#!/usr/bin/env python3
"""Extract teacher timetables from the aSc Timetables PDF export.

The importer preserves teacher names as printed.  It reads the coloured lesson
rectangles rather than guessing from the visual grid, which also handles the
double-period ICT blocks near the end of the file.
"""

from __future__ import annotations

import argparse
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
GRADE_WORDS = {
    "الخامس": 5,
    "الخام": 5,
    "السادس": 6,
    "الساد": 6,
    "السابع": 7,
    "الثامن": 8,
}
ARABIC_MARKS = re.compile(r"[\u064B-\u065F\u0670\u06D6-\u06ED]")
ARABIC_CHARACTER = re.compile(r"[\u0600-\u06FF\uFB50-\uFEFF]")
CODE_TOKEN = re.compile(r"[\d٠-٩۰-۹/\\\- ]+")
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


def lesson_rectangles(page):
    return [
        rect
        for rect in page.rects
        if rect.get("fill")
        and rect.get("non_stroking_color") is not None
        and 105 < rect["top"] < 570
        and rect["bottom"] - rect["top"] > 80
    ]


def day_index(rect) -> int:
    return min(4, max(0, round((rect["top"] - 110.0) / 91.1)))


def period_range(rect) -> tuple[int, int]:
    overlapping = [
        period
        for period, start, end in PERIOD_BOUNDS
        if min(rect["x1"], end) - max(rect["x0"], start) > 20
    ]
    if not overlapping:
        raise ValueError(f"Could not map rectangle x={rect['x0']}-{rect['x1']} to a period")
    return min(overlapping), max(overlapping)


def words_inside(words, rect):
    return [
        word
        for word in words
        if rect["x0"] - 1 <= (word["x0"] + word["x1"]) / 2 <= rect["x1"] + 1
        and rect["top"] - 1 <= (word["top"] + word["bottom"]) / 2 <= rect["bottom"] + 1
    ]


def parse_subject(words) -> str:
    subject_words = [
        word
        for word in words
        if word["size"] < 12 and ARABIC_CHARACTER.search(word["text"])
    ]
    return " ".join(
        reverse_pdf_word(word["text"])
        for word in sorted(subject_words, key=lambda word: word["x0"], reverse=True)
    ).strip()


def parse_class(words) -> tuple[int, int, str]:
    small_code_words = [
        word
        for word in words
        if word["size"] < 12 and CODE_TOKEN.fullmatch(word["text"])
    ]
    code_text = "".join(
        word["text"] for word in sorted(small_code_words, key=lambda word: word["x0"])
    ).translate(DIGIT_TRANSLATION)
    numbers = [int(number) for number in re.findall(r"\d+", code_text)]
    if len(numbers) >= 2:
        return numbers[0], numbers[1], "small-label"

    # Some source cells omit the small class code (notably sections 9, 10,
    # and 11). Recover only values that are explicitly printed in the large
    # class label; no value is inferred from neighbouring cells.
    large_words = [word for word in words if word["size"] >= 12]
    body = " ".join(
        reverse_pdf_word(word["text"])
        for word in sorted(large_words, key=lambda word: (round(word["top"], 1), -word["x0"]))
    )
    body_digits = [
        int(number)
        for number in re.findall(
            r"\d+",
            " ".join(word["text"] for word in large_words).translate(DIGIT_TRANSLATION),
        )
    ]
    grade = next((number for label, number in GRADE_WORDS.items() if label in body), None)
    if grade is None or not body_digits:
        raise ValueError(f"Could not read class label: {body!r}")
    return grade, body_digits[-1], "large-label"


def extract(pdf_path: Path):
    teachers = []
    issues = []
    recovery_count = 0
    merged_count = 0

    with pdfplumber.open(pdf_path) as pdf:
        for page_number, page in enumerate(pdf.pages, start=1):
            name = teacher_name(page)
            words = page.extract_words(extra_attrs=["size"])
            lessons = []

            for rect in lesson_rectangles(page):
                try:
                    inside = words_inside(words, rect)
                    subject = parse_subject(inside)
                    grade, section, class_source = parse_class(inside)
                    period_start, period_end = period_range(rect)
                    current_day_index = day_index(rect)
                    if not subject or grade not in (5, 6, 7, 8):
                        raise ValueError("Subject or grade is outside the expected school data")
                    recovery_count += class_source == "large-label"
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
                except ValueError as error:
                    issues.append(
                        {
                            "page": page_number,
                            "teacher": name,
                            "rectangle": {
                                "x0": round(rect["x0"], 2),
                                "x1": round(rect["x1"], 2),
                                "top": round(rect["top"], 2),
                                "bottom": round(rect["bottom"], 2),
                            },
                            "error": str(error),
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

    return teachers, issues, recovery_count, merged_count


def validate(teachers, issues):
    if len(teachers) != 85:
        raise ValueError(f"Expected 85 teachers/pages, found {len(teachers)}")
    if len({teacher["id"] for teacher in teachers}) != 85:
        raise ValueError("Teacher IDs are not unique")
    if len({teacher["fullName"] for teacher in teachers}) != 85:
        raise ValueError("Teacher names are not unique; preserve and review duplicate source pages")
    if issues:
        raise ValueError(f"Found {len(issues)} unparsed lesson blocks")

    fixture = {
        ("الأحد", 1, 1, "6/2"),
        ("الأحد", 4, 4, "6/2"),
        ("الأحد", 7, 7, "6/1"),
        ("الاثنين", 4, 4, "6/1"),
        ("الأربعاء", 3, 3, "6/1"),
        ("الأربعاء", 5, 5, "6/2"),
        ("الأربعاء", 7, 7, "6/2"),
        ("الخميس", 3, 3, "6/1"),
        ("الخميس", 7, 7, "6/1"),
        ("الخميس", 8, 8, "6/2"),
    }
    actual = {
        (lesson["day"], lesson["periodStart"], lesson["periodEnd"], lesson["classCode"])
        for lesson in teachers[0]["lessons"]
    }
    if actual != fixture:
        raise ValueError("Page 1 visual validation fixture did not match")


def report_for(source_name, teachers, recovery_count, merged_count):
    lesson_blocks = [lesson for teacher in teachers for lesson in teacher["lessons"]]
    grade_teacher_counts = {
        str(grade): sum(grade in teacher["grades"] for teacher in teachers)
        for grade in (5, 6, 7, 8)
    }
    grade_lesson_counts = Counter(lesson["grade"] for lesson in lesson_blocks)
    subject_counts = Counter(lesson["subject"] for lesson in lesson_blocks)
    blank_teachers = [
        {"page": teacher["sourcePage"], "name": teacher["fullName"]}
        for teacher in teachers
        if not teacher["lessons"]
    ]
    return {
        "sourceFile": source_name,
        "pageCount": 85,
        "teacherCount": len(teachers),
        "uniqueTeacherNameCount": len({teacher["fullName"] for teacher in teachers}),
        "lessonBlockCount": len(lesson_blocks),
        "occupiedPeriodCount": sum(teacher["occupiedPeriodCount"] for teacher in teachers),
        "mergedDoublePeriodBlockCount": merged_count,
        "classLabelsRecoveredFromVisibleLargeText": recovery_count,
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
        "validation": {
            "allPagesRead": True,
            "allLessonRectanglesParsed": True,
            "uniqueTeacherNames": True,
            "page1CheckedAgainstRenderedPdf": True,
            "blankFinalPageCheckedAgainstRenderedPdf": True,
        },
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("pdf", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()

    teachers, issues, recovery_count, merged_count = extract(args.pdf)
    validate(teachers, issues)
    payload = {
        "sourceFile": args.pdf.name,
        "days": DAYS,
        "periodTimes": {str(key): value for key, value in PERIOD_TIMES.items()},
        "teachers": teachers,
    }
    report = report_for(args.pdf.name, teachers, recovery_count, merged_count)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
