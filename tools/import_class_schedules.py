#!/usr/bin/env python3
"""Read every class-PDF cell independently and reconcile with the teacher export.

PyMuPDF geometry/glyph extraction is independent of the teacher importer.
Short printed teacher names are retained; full names are linked by matching the
class/day/period/subject AND checking the short name against the teacher name.
No fuzzy name matches are silently accepted.
"""
import argparse
from collections import defaultdict
from datetime import datetime
import hashlib
import json
from pathlib import Path
import re
import unicodedata
import fitz

DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس']
GRADE_WORDS = {'الخامس': 5, 'السادس': 6, 'السابع': 7, 'الثامن': 8}

def norm(s):
    return unicodedata.normalize('NFKC', s).strip()

def key(s):
    s = re.sub('[\u064b-\u065f\u0670]', '', norm(s))
    return re.sub(r'\s+', '', re.sub('[أإآٱ]', 'ا', s).replace('ى', 'ي').replace('ة', 'ه').replace('ـ', ''))

def read_page(page, number):
    spans = [s for b in page.get_text('rawdict')['blocks'] for l in b.get('lines', []) for s in l['spans']]
    for s in spans:
        s['text'] = norm(''.join(c['c'] for c in s['chars']))
    heading_chars = [c for s in spans if s['bbox'][1] < 50 and s['size'] > 20 for c in s['chars']]
    heading = norm(''.join(c['c'] for c in sorted(heading_chars, key=lambda c: -c['bbox'][0])))
    grade = next(g for label, g in GRADE_WORDS.items() if label in heading)
    digits = sorted([c for c in heading_chars if c['c'].isdigit()], key=lambda c: c['bbox'][0])
    section = int(''.join(c['c'] for c in digits))
    code = f'{grade}/{section}'
    period_spans = [s for s in spans if re.fullmatch('[1-8]', s['text']) and 60 < s['bbox'][1] < 100]
    centers = {int(s['text']): (s['bbox'][0]+s['bbox'][2])/2 for s in period_spans}
    if len(centers) != 8: raise ValueError(f'Page {number}: missing period headings')
    day_spans = sorted([s for s in spans if s['bbox'][2] < 95 and s['size'] > 18 and s['bbox'][1] > 100], key=lambda s:s['bbox'][1])
    if [key(s['text']) for s in day_spans] != [key(s) for s in DAYS]: raise ValueError(f'Page {number}: invalid days')
    lines = [it for d in page.get_drawings() for it in d['items'] if it[0]=='l']
    horizontal = sorted(set(round(it[1].y,2) for it in lines if abs(it[1].y-it[2].y)<.01))
    lessons = []
    for day_index, day in enumerate(day_spans):
        cy = (day['bbox'][1]+day['bbox'][3])/2
        y0, y1 = max(y for y in horizontal if y<cy), min(y for y in horizontal if y>cy)
        xs = sorted(set(round(it[1].x,2) for it in lines if abs(it[1].x-it[2].x)<.01 and min(it[1].y,it[2].y)<cy<max(it[1].y,it[2].y)))
        for x0,x1 in zip(xs,xs[1:]):
            periods = sorted(p for p,cx in centers.items() if x0<cx<x1)
            if not periods: continue
            inside = [s for s in spans if x0<(s['bbox'][0]+s['bbox'][2])/2<x1 and y0<(s['bbox'][1]+s['bbox'][3])/2<y1]
            if not inside: continue
            subjects = sorted([s for s in inside if s['bbox'][1]<y1-25], key=lambda s:(round(s['bbox'][1],1),-s['bbox'][0]))
            subject = norm(' '.join(s['text'] for s in subjects))
            bottom_chars = [c for s in inside if s['bbox'][1]>=y1-25 for c in s['chars']]
            # Room names sit at the left edge; the teacher label is right aligned.
            if any('حاسوب' in s['text'] for s in inside):
                bottom_chars = [c for c in bottom_chars if c['bbox'][0] > (x0+x1)/2]
            printed_name = norm(''.join(c['c'] for c in sorted(bottom_chars,key=lambda c:-c['bbox'][0])))
            if not subject or not printed_name: raise ValueError(f'Incomplete cell {code}/{day_index}/{periods}')
            lessons.append({'day':DAYS[day_index],'dayIndex':day_index,'periodStart':min(periods),'periodEnd':max(periods),'subject':subject,'teacherLabel':printed_name})
    return {'classCode':code,'grade':grade,'section':section,'sourcePage':number,'lessons':lessons}

def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('pdf',type=Path); ap.add_argument('teachers',type=Path)
    ap.add_argument('--output',type=Path,required=True); ap.add_argument('--report',type=Path,required=True)
    args=ap.parse_args()
    teacher_data=json.loads(args.teachers.read_text())
    slots=defaultdict(list)
    for t in teacher_data['teachers']:
        for l in t['lessons']:
            for p in range(l['periodStart'],l['periodEnd']+1): slots[l['classCode'],l['dayIndex'],p].append((t,l))
    with fitz.open(args.pdf) as doc:
        classes=[read_page(p,i+1) for i,p in enumerate(doc)]
        date=datetime.strptime(doc.metadata['creationDate'][2:10],'%Y%m%d').date().isoformat()
    issues=[]; checked=0; aliases=defaultdict(set); visited=set()
    for c in classes:
        for l in c['lessons']:
            candidates=[]
            for p in range(l['periodStart'],l['periodEnd']+1):
                k=(c['classCode'],l['dayIndex'],p)
                if k in visited: issues.append({'type':'duplicateClassSlot','slot':k})
                visited.add(k)
                matches=slots.get(k,[])
                if len(matches)!=1:
                    issues.append({'type':'missingOrMultipleTeacher','slot':k,'matches':len(matches)}); continue
                t,tl=matches[0]; candidates.append(t)
                if key(l['subject'])!=key(tl['subject']): issues.append({'type':'subjectMismatch','slot':k,'classSubject':l['subject'],'teacherSubject':tl['subject']})
                label_tokens=norm(l['teacherLabel']).split()
                if not all(key(token) in key(t['fullName']) for token in label_tokens):
                    issues.append({'type':'teacherNameMismatch','slot':k,'label':l['teacherLabel'],'fullName':t['fullName']})
                checked+=1
            if candidates and len({t['id'] for t in candidates})==1:
                t=candidates[0]; l['teacherId']=t['id']; l['teacherFullName']=t['fullName']; aliases[t['id']].add(l['teacherLabel'])
            else: issues.append({'type':'unresolvedTeacher','class':c['classCode'],'lesson':l})
    if set(slots)!=visited: issues.append({'type':'slotSetMismatch','teacherOnly':sorted(set(slots)-visited),'classOnly':sorted(visited-set(slots))})
    for tid,names in aliases.items():
        if len(names)>1: issues.append({'type':'inconsistentTeacherLabels','teacherId':tid,'labels':sorted(names)})
    counts={'classes':len(classes),'teachers':len(teacher_data['teachers']),'classLessonBlocks':sum(len(c['lessons']) for c in classes),'matchedPeriods':checked,'expectedPeriods':len(classes)*5*8}
    source={'fileName':args.pdf.name,'createdDate':date,'sha256':hashlib.sha256(args.pdf.read_bytes()).hexdigest()}
    report={'ok':not issues,'source':source,'teacherSourceSha256':teacher_data['sourceSha256'],'counts':counts,'discrepancies':issues}
    args.report.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    if not issues: args.output.write_text(json.dumps({'source':source,'classes':classes},ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(report,ensure_ascii=False,indent=2))
    return int(bool(issues))

if __name__=='__main__': raise SystemExit(main())
