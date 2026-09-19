#!/usr/bin/env python3
"""Independently audit an aSc teacher PDF against imported timetable JSON.

Requires PyMuPDF (``pip install pymupdf``); does not import the production
importer. Geometry, native glyph positions and table labels are read afresh.
Exit status is 0 for an exact match, 1 for discrepancies or extraction errors.

The canonical record digest is SHA256 of UTF-8 JSON encoded using
ensure_ascii=False, sort_keys=True, separators=(',', ':'). Records are in page
order; lessons are sorted by (dayIndex, periodStart, periodEnd, classCode,
subject). It covers fullName, sourcePage, grades, subjects, lessonCount,
occupiedPeriodCount, and complete source-backed lesson fields. Generated IDs
and search aliases are deliberately excluded because they are not PDF data.
"""

from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from datetime import datetime
import hashlib
import json
from pathlib import Path
import re
import unicodedata

import fitz


DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس']
GRADE_PREFIXES = [('الخام', 5), ('الساد', 6), ('السابع', 7), ('الثامن', 8)]
RECORD_KEYS = ('sourcePage', 'fullName', 'grades', 'subjects', 'lessonCount',
               'occupiedPeriodCount', 'lessons')
LESSON_KEYS = ('day', 'dayIndex', 'periodStart', 'periodEnd', 'subject',
               'classCode', 'grade', 'section')


def norm(value):
    return unicodedata.normalize('NFKC', value).strip()


def day_key(value):
    return re.sub('[أإآٱ]', 'ا', norm(value))


def lesson_key(lesson):
    return tuple(lesson[k] for k in
                 ('dayIndex', 'periodStart', 'periodEnd', 'classCode', 'subject'))


def canonical_digest(records):
    raw = json.dumps(records, ensure_ascii=False, sort_keys=True,
                     separators=(',', ':')).encode('utf-8')
    return hashlib.sha256(raw).hexdigest()


def candidate_records(candidate):
    records = []
    for teacher in candidate['teachers']:
        record = {key: teacher[key] for key in RECORD_KEYS}
        record['lessons'] = sorted(
            [{key: lesson[key] for key in LESSON_KEYS}
             for lesson in teacher['lessons']], key=lesson_key)
        records.append(record)
    return records


def require(condition, message):
    if not condition:
        raise ValueError(message)


def extract_page(page, page_number):
    spans = []
    for block in page.get_text('rawdict')['blocks']:
        for line in block.get('lines', []):
            for span in line['spans']:
                span['text'] = ''.join(c['c'] for c in span['chars'])
                spans.append(span)
    headings = [s for s in spans if s['bbox'][1] < 50 and s['size'] > 20]
    require(len(headings) == 1, 'Expected exactly one teacher heading')
    # Glyph order, not span order: native span order mishandles some RTL names
    # containing combining marks. Preserve those marks and all printed letters.
    heading = norm(''.join(c['c'] for c in sorted(
        headings[0]['chars'], key=lambda c: c['bbox'][0], reverse=True)))
    require(heading.startswith('المعلم'), 'Teacher heading prefix missing')
    name = re.sub(r'^المعلم\s*', '', heading)

    day_spans = sorted([s for s in spans if s['bbox'][2] < 95 and
                        s['size'] > 18 and s['bbox'][1] > 100],
                       key=lambda s: s['bbox'][1])
    require(len(day_spans) == 5, 'Expected five printed day labels')
    source_days = [norm(s['text']) for s in day_spans]
    require([day_key(d) for d in source_days] == [day_key(d) for d in DAYS],
            f'Unexpected printed day labels/order: {source_days}')

    period_spans = [s for s in spans if re.fullmatch('[1-8]', s['text']) and
                    60 < s['bbox'][1] < 100]
    periods = {int(s['text']): (s['bbox'][0]+s['bbox'][2])/2
               for s in period_spans}
    require(len(period_spans) == len(periods) == 8,
            'Expected exactly eight unique printed period labels')
    time_spans = [s for s in spans if 99 < s['bbox'][1] < 109 and
                  re.fullmatch(r'\d{1,2}:\d{2} - \d{1,2}:\d{2}', s['text'])]
    require(len(time_spans) == 9, 'Expected eight period times and recess time')
    period_times = {}
    for period, center in periods.items():
        nearest = min(time_spans, key=lambda s:
                      abs((s['bbox'][0]+s['bbox'][2])/2-center))
        require(abs((nearest['bbox'][0]+nearest['bbox'][2])/2-center) < 2,
                f'Time label misaligned for period {period}')
        period_times[str(period)] = nearest['text']

    lines = [it for drawing in page.get_drawings() for it in drawing['items']
             if it[0] == 'l']
    horiz = sorted(set(round(it[1].y, 2) for it in lines
                       if abs(it[1].y-it[2].y) < .01))
    lessons, issues, allocated = [], [], set()
    table_tops, table_bottoms, table_lefts = [], [], []
    for day_index, day_span in enumerate(day_spans):
        center = (day_span['bbox'][1]+day_span['bbox'][3])/2
        y0 = max(y for y in horiz if y < center)
        y1 = min(y for y in horiz if y > center)
        xs = sorted(set(round(it[1].x, 2) for it in lines
                        if abs(it[1].x-it[2].x) < .01 and
                        min(it[1].y, it[2].y) < center < max(it[1].y, it[2].y)))
        require(len(xs) >= 4, f'Insufficient row geometry for day {day_index}')
        table_tops.append(y0)
        table_bottoms.append(y1)
        table_lefts.append(max(x for x in xs if x < min(periods.values())))
        for x0, x1 in zip(xs, xs[1:]):
            ps = sorted(p for p, x in periods.items() if x0 < x < x1)
            if not ps:
                continue
            inside = [(i, s) for i, s in enumerate(spans)
                      if x0 < (s['bbox'][0]+s['bbox'][2])/2 < x1 and
                      y0 < (s['bbox'][1]+s['bbox'][3])/2 < y1]
            if not inside:
                continue
            allocated.update(i for i, s in inside)
            # Class uses the largest cell font, including centered merged cells.
            maxsize = max(s['size'] for i, s in inside)
            class_spans = [s for i, s in inside if abs(s['size']-maxsize) < .01]
            subject_spans = [s for i, s in inside
                             if abs(s['size']-maxsize) >= .01 and
                             'حاسوب' not in s['text'] and
                             any(c.isalpha() for c in s['text'])]
            subject = ' '.join(norm(s['text']) for s in sorted(
                subject_spans, key=lambda s: (round(s['bbox'][1], 1), -s['bbox'][0])))
            class_text = ' '.join(norm(s['text']) for s in class_spans)
            grade = next((g for k, g in GRADE_PREFIXES if k in class_text), None)
            # Read digits left-to-right by glyph position, independently of the
            # native span's reversed Arabic-digit order (e.g. ٠١ -> section 10).
            digits = [c for s in class_spans for c in s['chars'] if c['c'].isdigit()]
            section_text = ''.join(c['c'] for c in sorted(digits,
                                                         key=lambda c: c['bbox'][0]))
            if not grade or not section_text or not subject:
                issues.append({'type': 'incompleteCell', 'page': page_number,
                               'dayIndex': day_index, 'periods': ps,
                               'subject': subject, 'classText': class_text})
                continue
            section = int(section_text)
            lessons.append({'day': DAYS[day_index], 'dayIndex': day_index,
                            'periodStart': min(ps), 'periodEnd': max(ps),
                            'classCode': f'{grade}/{section}', 'grade': grade,
                            'section': section, 'subject': subject})
    unallocated = [s['text'] for i, s in enumerate(spans)
                   if i not in allocated and
                   (s['bbox'][0]+s['bbox'][2])/2 > min(table_lefts) and
                   min(table_tops) < (s['bbox'][1]+s['bbox'][3])/2 < max(table_bottoms)]
    if unallocated:
        issues.append({'type': 'unallocatedCellText', 'page': page_number,
                       'text': unallocated})
    lessons.sort(key=lesson_key)
    record = {'sourcePage': page_number, 'fullName': name,
              'grades': sorted(set(l['grade'] for l in lessons)),
              'subjects': sorted(set(l['subject'] for l in lessons)),
              'lessonCount': len(lessons),
              'occupiedPeriodCount': sum(l['periodEnd']-l['periodStart']+1
                                         for l in lessons),
              'lessons': lessons}
    footer_chars = [c for s in spans if s['bbox'][1] > max(table_bottoms)
                    for c in s['chars'] if c['bbox'][0] < 58 and
                    (c['c'].isdigit() or c['c'] == '/')]
    footer = ''.join(c['c'] for c in sorted(footer_chars,
                                           key=lambda c: c['bbox'][0]))
    require(re.fullmatch(r'\d{2}/\d{2}/\d{4}', footer) is not None,
            f'Creation-date footer not recognized: {footer!r}')
    ascii_date = ''.join(str(int(c)) if c.isdigit() else c for c in footer)
    created_date = datetime.strptime(ascii_date, '%d/%m/%Y').date().isoformat()
    return record, period_times, created_date, source_days, issues


def source_warnings(records):
    warnings = []
    blank = [r['sourcePage'] for r in records if not r['lessons']]
    if blank:
        warnings.append({'type': 'blankSchedules', 'pages': blank})
    placeholders = [{'page': r['sourcePage'], 'fullName': r['fullName']}
                    for r in records if len(r['fullName'].split()) >= 2 and
                    all(len(w) == 1 for w in r['fullName'].split())]
    if placeholders:
        warnings.append({'type': 'placeholderNames', 'teachers': placeholders})
    slots = defaultdict(list)
    it_classes = set()
    for record in records:
        for lesson in record['lessons']:
            if lesson['subject'] == 'تقنية المعلومات':
                it_classes.add(lesson['classCode'])
            for period in range(lesson['periodStart'], lesson['periodEnd']+1):
                slots[lesson['classCode'], lesson['dayIndex'], period].append(record['sourcePage'])
    classes = sorted(set(k[0] for k in slots))
    gaps = [{'classCode': c, 'dayIndex': d, 'day': DAYS[d], 'period': p}
            for c in classes for d in range(5) for p in range(1, 9)
            if (c, d, p) not in slots]
    if gaps:
        warnings.append({'type': 'unassignedClassPeriods', 'slots': gaps})
    without_it = sorted(set(classes)-it_classes)
    if without_it:
        warnings.append({'type': 'classesWithoutIT', 'classCodes': without_it})
    conflicts = [{'classCode': c, 'dayIndex': d, 'period': p, 'pages': pages}
                 for (c, d, p), pages in slots.items() if len(pages) > 1]
    if conflicts:
        warnings.append({'type': 'sourceClassConflicts', 'slots': conflicts})
    return warnings


def audit(pdf_path, candidate_path):
    candidate = json.loads(candidate_path.read_text(encoding='utf-8'))
    require(isinstance(candidate, dict), 'Candidate must be a JSON object')
    sha = hashlib.sha256(pdf_path.read_bytes()).hexdigest()
    discrepancies, records, printed_days = [], [], []
    checked_times, checked_dates = 0, 0
    for field, source in [('sourceFile', pdf_path.name), ('sourceSha256', sha),
                          ('days', DAYS)]:
        if candidate.get(field) != source:
            discrepancies.append({'type': 'metadataMismatch', 'field': field,
                                  'source': source, 'candidate': candidate.get(field)})
    with fitz.open(pdf_path) as document:
        page_count = len(document)
        for page_number, page in enumerate(document, 1):
            try:
                record, times, date, days, issues = extract_page(page, page_number)
                records.append(record)
                printed_days.append(days)
                discrepancies.extend(issues)
                for period, source_time in times.items():
                    checked_times += 1
                    target_time = candidate.get('periodTimes', {}).get(period)
                    if target_time != source_time:
                        discrepancies.append({'type': 'periodTimeMismatch',
                                              'page': page_number, 'period': int(period),
                                              'source': source_time, 'candidate': target_time})
                checked_dates += 1
                if candidate.get('sourceCreatedDate') != date:
                    discrepancies.append({'type': 'creationDateMismatch',
                                          'page': page_number, 'source': date,
                                          'candidate': candidate.get('sourceCreatedDate')})
            except (ValueError, KeyError, TypeError) as error:
                discrepancies.append({'type': 'pageExtractionError',
                                      'page': page_number, 'error': str(error)})
    if checked_times != page_count*8 or checked_dates != page_count:
        discrepancies.append({'type': 'incompleteHeaderChecks',
                              'periodTimesChecked': checked_times,
                              'creationDatesChecked': checked_dates})
    if set(candidate.get('periodTimes', {})) != set(map(str, range(1, 9))):
        discrepancies.append({'type': 'invalidPeriodTimeKeys'})
    projected = candidate_records(candidate)
    if len(projected) != page_count:
        discrepancies.append({'type': 'teacherCountMismatch', 'source': page_count,
                              'candidate': len(projected)})
    by_page = {r['sourcePage']: r for r in projected}
    if len(by_page) != len(projected) or set(by_page) != set(range(1, page_count+1)):
        discrepancies.append({'type': 'invalidCandidateSourcePages'})
    if [r['sourcePage'] for r in projected] != list(range(1, page_count+1)):
        discrepancies.append({'type': 'candidateTeacherOrderMismatch'})
    for source in records:
        target = by_page.get(source['sourcePage'])
        if target is None:
            continue
        for key in RECORD_KEYS:
            if source[key] != target[key]:
                if key == 'lessons':
                    encode = lambda item: json.dumps(item, ensure_ascii=False, sort_keys=True)
                    a, b = Counter(map(encode, source[key])), Counter(map(encode, target[key]))
                    detail = {'sourceOnly': [json.loads(s) for s in (a-b).elements()],
                              'candidateOnly': [json.loads(s) for s in (b-a).elements()]}
                else:
                    detail = {'source': source[key], 'candidate': target[key]}
                discrepancies.append({'type': 'teacherRecordMismatch',
                                      'page': source['sourcePage'], 'field': key, **detail})
    counts = {'pages': page_count, 'teachers': len(records),
              'lessonBlocks': sum(r['lessonCount'] for r in records),
              'occupiedPeriods': sum(r['occupiedPeriodCount'] for r in records),
              'doublePeriodBlocks': sum(l['periodEnd']-l['periodStart'] == 1
                                        for r in records for l in r['lessons'])}
    source_digest = canonical_digest(records)
    target_digest = canonical_digest(projected)
    if source_digest != target_digest and not discrepancies:
        discrepancies.append({'type': 'canonicalRecordDigestMismatch'})
    return {'auditVersion': 1, 'ok': not discrepancies, 'sourceFile': pdf_path.name,
            'sourceSha256': sha, 'counts': counts,
            'checks': {'periodTimes': checked_times, 'creationDates': checked_dates,
                       'dayLabels': len(printed_days)*5},
            'canonicalTeacherRecordsSha256': source_digest,
            'candidateTeacherRecordsSha256': target_digest,
            'canonicalSerialization': 'UTF-8 JSON; ensure_ascii=False; sort_keys=True; separators=(",", ":")',
            'discrepancies': discrepancies, 'sourceWarnings': source_warnings(records)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('pdf', type=Path)
    parser.add_argument('candidate', type=Path)
    parser.add_argument('--report', required=True, type=Path)
    args = parser.parse_args()
    try:
        report = audit(args.pdf, args.candidate)
    except (OSError, ValueError, KeyError, TypeError, AttributeError,
            IndexError, fitz.FileDataError) as error:
        report = {'auditVersion': 1, 'ok': False,
                  'discrepancies': [{'type': 'auditError', 'error': str(error)}]}
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n',
                           encoding='utf-8')
    print(json.dumps({'ok': report['ok'], 'counts': report.get('counts'),
                      'discrepancies': len(report['discrepancies']),
                      'report': str(args.report)}, ensure_ascii=False))
    return 0 if report['ok'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
