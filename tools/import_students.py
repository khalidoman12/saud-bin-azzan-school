from __future__ import annotations

import argparse
import json
import re
import unicodedata
from collections import Counter
from pathlib import Path

import xlrd


ARABIC_GRADES = {"خامس": 5, "سادس": 6, "سابع": 7, "ثامن": 8}


def normalize(value: str, *, soft: bool = False, compact: bool = False) -> str:
    value = unicodedata.normalize("NFKC", value)
    value = re.sub(r"[\u064b-\u065f\u0670\u06d6-\u06ed]", "", value)
    value = value.translate(
        str.maketrans(
            {
                "أ": "ا",
                "إ": "ا",
                "آ": "ا",
                "ٱ": "ا",
                "ى": "ي",
                "ـ": "",
            }
        )
    )
    if soft:
        value = value.translate(str.maketrans({"ة": "ه", "ؤ": "و", "ئ": "ي"}))
    value = re.sub(r"\s+", " ", value).strip()
    return value.replace(" ", "") if compact else value


def parse_class(sheet: xlrd.sheet.Sheet) -> tuple[int, int]:
    header = " ".join(str(sheet.cell_value(row, 0)) for row in range(min(5, sheet.nrows)))
    match = re.search(r"([5-8])\s*[\\/]\s*([0-9]{1,2})", header)
    if match:
        return int(match.group(1)), int(match.group(2))

    compact_name = re.sub(r"\s+", "", sheet.name)
    for label, grade in ARABIC_GRADES.items():
        match = re.search(re.escape(label) + r"([0-9]{1,2})", compact_name)
        if match:
            return grade, int(match.group(1))
    raise ValueError(f"تعذر تحديد الصف والشعبة من الورقة: {sheet.name}")


def extract(source: Path) -> tuple[list[dict], dict]:
    workbook = xlrd.open_workbook(source)
    students: list[dict] = []
    skipped_blank_numbered_rows = 0
    formatting_issues: list[dict] = []

    for sheet in workbook.sheets():
        grade, section = parse_class(sheet)
        expected_sequence = 1
        for row_index in range(sheet.nrows):
            sequence_value = sheet.cell_value(row_index, 0)
            if not isinstance(sequence_value, float) or not sequence_value.is_integer():
                continue

            sequence = int(sequence_value)
            original_name = str(sheet.cell_value(row_index, 1)) if sheet.ncols > 1 else ""
            name = original_name.strip()
            if not name:
                skipped_blank_numbered_rows += 1
                continue
            if sequence != expected_sequence:
                raise ValueError(
                    f"تسلسل غير متصل في {sheet.name}: المتوقع {expected_sequence} ووجد {sequence}"
                )
            expected_sequence += 1

            if re.search(r"\s{2,}", original_name):
                formatting_issues.append(
                    {
                        "sheet": sheet.name,
                        "excelRow": row_index + 1,
                        "issue": "multiple_spaces",
                    }
                )

            students.append(
                {
                    "id": f"2026-{grade}-{section}-{sequence}",
                    "fullName": original_name,
                    "searchName": normalize(original_name),
                    "softSearchName": normalize(original_name, soft=True),
                    "compactSearchName": normalize(original_name, soft=True, compact=True),
                    "grade": grade,
                    "section": section,
                    "rosterOrder": sequence,
                    "enrollmentNumber": None,
                    "sourceSheet": sheet.name,
                    "sourceRow": row_index + 1,
                    "academicYear": "2026/2027",
                }
            )

    duplicate_names = [name for name, count in Counter(s["searchName"] for s in students).items() if count > 1]
    if duplicate_names:
        raise ValueError(f"وجدت أسماء مكررة بعد التطبيع: {len(duplicate_names)}")

    class_counts = Counter((s["grade"], s["section"]) for s in students)
    report = {
        "sourceFile": source.name,
        "sheetCount": workbook.nsheets,
        "studentCount": len(students),
        "classCount": len(class_counts),
        "skippedBlankNumberedRows": skipped_blank_numbered_rows,
        "formattingIssueCount": len(formatting_issues),
        "formattingIssues": formatting_issues,
        "gradeCounts": {
            str(grade): sum(count for (g, _), count in class_counts.items() if g == grade)
            for grade in range(5, 9)
        },
        "classCounts": [
            {"grade": grade, "section": section, "count": count}
            for (grade, section), count in sorted(class_counts.items())
        ],
    }
    return students, report


def main() -> None:
    parser = argparse.ArgumentParser(description="استيراد قوائم الطلبة من ملف Excel")
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("report", type=Path)
    args = parser.parse_args()

    students, report = extract(args.source)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(students, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    if report["studentCount"] != 1395 or report["classCount"] != 39:
        raise SystemExit("فشل التحقق من الأعداد المتوقعة")
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
