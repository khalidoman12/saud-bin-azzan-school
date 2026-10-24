# -*- coding: utf-8 -*-
"""Private backend for رصد الموهبة. Never deploy the database or PINs on GitHub Pages."""
from __future__ import annotations

import csv
import hashlib
import hmac
import io
import json
import os
import re
import secrets
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field, field_validator

from criteria import APP_NAME, PREPARED_BY, RATINGS, SCHOOL, SECTIONS

BASE = Path(__file__).resolve().parent
DB_PATH = Path(os.getenv("TALENT_DB_PATH", str(BASE / "private" / "talent.sqlite3")))
COOKIE_NAME = "talent_session"
COOKIE_SECURE = os.getenv("TALENT_COOKIE_SECURE", "true").lower() != "false"
TTL = 8 * 3600
SCOPES = list(SECTIONS) + ["registry"]
REVIEW_STATES = ["لم تتم المراجعة بعد", "بحاجة إلى ملاحظات إضافية", "يوصى بإتاحة نشاط إثرائي", "يوصى بإجراء تقييم تخصصي إضافي", "تمت مراجعة الحالة"]
# Single-instance defense in depth, NOT a replacement for gateway rate limiting + individual accounts.
ATTEMPTS: dict[str, list[float]] = {}
MAX_LOGIN_ATTEMPTS = 5
LOCK_SECONDS = 15 * 60

app = FastAPI(title=APP_NAME, docs_url=None, redoc_url=None, openapi_url=None)

@contextmanager
def database():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DB_PATH, timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys=ON")
    try:
        yield connection
        connection.commit()
    finally:
        connection.close()

def init_db():
    with database() as con:
        con.executescript("""
        CREATE TABLE IF NOT EXISTS pins(
          scope TEXT PRIMARY KEY, salt BLOB NOT NULL, digest BLOB NOT NULL, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS sessions(
          token_hash TEXT PRIMARY KEY, scope TEXT NOT NULL, expires_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS nominations(
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          scope TEXT NOT NULL,
          student_name TEXT NOT NULL,
          grade INTEGER NOT NULL CHECK(grade IN (5,6,7,8)),
          classroom TEXT NOT NULL,
          teacher_name TEXT NOT NULL,
          talent_type TEXT NOT NULL,
          talent_details TEXT NOT NULL DEFAULT '',
          comments TEXT NOT NULL DEFAULT '',
          evidence_note TEXT NOT NULL DEFAULT '',
          answers_json TEXT NOT NULL,
          review_note TEXT NOT NULL DEFAULT '',
          review_status TEXT NOT NULL DEFAULT 'لم تتم المراجعة بعد',
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          reviewed_at TEXT
        );
        CREATE INDEX IF NOT EXISTS nominations_scope_idx ON nominations(scope);
        CREATE INDEX IF NOT EXISTS nominations_grade_idx ON nominations(grade);
        CREATE TABLE IF NOT EXISTS audit(
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          action TEXT NOT NULL, scope TEXT NOT NULL, record_id INTEGER,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        """)

@app.on_event("startup")
def start():
    init_db()

def hash_pin(pin: str, salt: bytes) -> bytes:
    return hashlib.pbkdf2_hmac("sha256", pin.encode("utf-8"), salt, 600_000)

def install_pin(scope: str, pin: str):
    if scope not in SCOPES or not re.fullmatch(r"[0-9]{4}", pin):
        raise ValueError("Scope must exist and PIN must contain exactly four ASCII digits")
    salt = secrets.token_bytes(32)
    digest = hash_pin(pin, salt)
    with database() as con:
        con.execute("INSERT OR REPLACE INTO pins(scope,salt,digest,updated_at) VALUES(?,?,?,CURRENT_TIMESTAMP)", (scope, salt, digest))
        con.execute("DELETE FROM sessions WHERE scope=?", (scope,))

def add_audit(con, action: str, scope: str, record_id=None):
    con.execute("INSERT INTO audit(action,scope,record_id) VALUES(?,?,?)", (action,scope,record_id))

def auth(request: Request, allowed: set[str] | None = None) -> str:
    token = request.cookies.get(COOKIE_NAME, "")
    if not token:
        raise HTTPException(401, "القسم مغلق. أدخل الرمز أولًا.")
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    with database() as con:
        row = con.execute("SELECT scope,expires_at FROM sessions WHERE token_hash=?", (token_hash,)).fetchone()
    if row is None or row["expires_at"] < int(time.time()):
        raise HTTPException(401, "انتهت الجلسة. افتح القسم مجددًا.")
    scope = row["scope"]
    if allowed is not None and scope not in allowed:
        raise HTTPException(403, "ليست لديك صلاحية الاطلاع على هذا القسم.")
    return scope

class Login(BaseModel):
    scope: str
    pin: str

@app.get("/")
def home():
    return FileResponse(BASE / "public" / "index.html", headers={"Cache-Control":"no-store"})

@app.get("/app.js")
def js():
    return FileResponse(BASE / "public" / "app.js", media_type="application/javascript", headers={"Cache-Control":"no-store"})

@app.get("/style.css")
def css():
    return FileResponse(BASE / "public" / "style.css", media_type="text/css")

@app.get("/api/sections")
def sections():
    return {"school":SCHOOL,"title":APP_NAME,"prepared_by":PREPARED_BY,
            "sections":[{"id":key,"title":item["title"],"emoji":item["emoji"]} for key,item in SECTIONS.items()] +
                [{"id":"registry","title":"سجل تقييم الطلبة الموهوبين","emoji":"🗂️"}]}

@app.post("/api/login")
def login(data: Login, request: Request, response: Response):
    if data.scope not in SCOPES or not re.fullmatch(r"[0-9]{4}", data.pin):
        raise HTTPException(401, "الرمز غير صحيح.")
    ip = request.client.host if request.client else "unknown"
    key = ip + ":" + data.scope
    now = time.monotonic()
    ATTEMPTS[key] = [t for t in ATTEMPTS.get(key, []) if now - t < LOCK_SECONDS]
    if len(ATTEMPTS[key]) >= MAX_LOGIN_ATTEMPTS:
        raise HTTPException(429, "تم تجاوز محاولات الدخول. حاول بعد 15 دقيقة.")
    with database() as con:
        row = con.execute("SELECT salt,digest FROM pins WHERE scope=?", (data.scope,)).fetchone()
    if not row:
        raise HTTPException(503, "لم تُهيأ رموز الدخول على الخادم بعد.")
    valid = hmac.compare_digest(hash_pin(data.pin, row["salt"]), row["digest"])
    if not valid:
        ATTEMPTS[key].append(now)
        raise HTTPException(401, "الرمز غير صحيح.")
    ATTEMPTS.pop(key, None)
    token = secrets.token_urlsafe(32)
    with database() as con:
        con.execute("DELETE FROM sessions WHERE expires_at < ?", (int(time.time()),))
        con.execute("INSERT INTO sessions(token_hash,scope,expires_at) VALUES(?,?,?)",
                    (hashlib.sha256(token.encode()).hexdigest(),data.scope,int(time.time())+TTL))
        add_audit(con,"login",data.scope)
    response.set_cookie(COOKIE_NAME,token,httponly=True,secure=COOKIE_SECURE,samesite="strict",max_age=TTL,path="/")
    return {"scope":data.scope,"title":SECTIONS[data.scope]["title"] if data.scope in SECTIONS else "سجل تقييم الطلبة الموهوبين"}

@app.post("/api/logout")
def logout(request: Request, response: Response):
    token = request.cookies.get(COOKIE_NAME, "")
    if token:
        with database() as con:
            con.execute("DELETE FROM sessions WHERE token_hash=?", (hashlib.sha256(token.encode()).hexdigest(),))
    response.delete_cookie(COOKIE_NAME,path="/",secure=COOKIE_SECURE,samesite="strict")
    return {"ok":True}

@app.get("/api/session")
def session(request: Request):
    scope = auth(request)
    return {"scope":scope,"title": SECTIONS[scope]["title"] if scope in SECTIONS else "سجل تقييم الطلبة الموهوبين"}

@app.get("/api/criteria")
def criteria(request: Request):
    scope = auth(request)
    if scope == "registry":
        raise HTTPException(403, "بوابة السجل مخصصة للعرض فقط.")
    sec = SECTIONS[scope]
    return {"scope":scope,"title":sec["title"],"types":sec["types"],"criteria":sec["criteria"],"ratings":RATINGS}

class Nomination(BaseModel):
    student_name: str = Field(min_length=3, max_length=180)
    grade: Literal[5,6,7,8]
    classroom: str = Field(min_length=1,max_length=30)
    teacher_name: str = Field(min_length=3,max_length=180)
    talent_type: str = Field(min_length=1,max_length=200)
    talent_details: str = Field(default="",max_length=1500)
    comments: str = Field(default="",max_length=2000)
    evidence_note: str = Field(default="",max_length=1000)
    answers: dict[str, Literal["yes","partial","no","unknown"]]

    @field_validator("student_name","classroom","teacher_name","talent_type")
    @classmethod
    def cannot_be_blank(cls,v):
        if not v.strip():
            raise ValueError("الحقل مطلوب")
        return v.strip()

@app.post("/api/nominations")
def nominate(data: Nomination, request: Request):
    scope = auth(request, set(SECTIONS))
    required = {str(i) for i in range(len(SECTIONS[scope]["criteria"]))}
    if set(data.answers) != required:
        raise HTTPException(422, "يرجى تقييم جميع المؤشرات أو اختيار عدم توفر فرصة للملاحظة.")
    if data.talent_type not in SECTIONS[scope]["types"] and len(data.talent_type.strip()) < 3:
        raise HTTPException(422, "اسم الموهبة غير صالح.")
    with database() as con:
        cursor=con.execute("""
        INSERT INTO nominations(scope,student_name,grade,classroom,teacher_name,talent_type,
        talent_details,comments,evidence_note,answers_json)
        VALUES(?,?,?,?,?,?,?,?,?,?)
        """,(scope,data.student_name,data.grade,data.classroom,data.teacher_name,
             data.talent_type,data.talent_details,data.comments,data.evidence_note,
             json.dumps(data.answers,ensure_ascii=False)))
        rid=cursor.lastrowid
        add_audit(con,"nomination_create",scope,rid)
    return {"ok":True,"id":rid,"message":"تم حفظ استمارة ترشيح الطالب بنجاح"}

def full_record(row):
    d=dict(row)
    d["answers"]=json.loads(d.pop("answers_json"))
    d["section_title"]=SECTIONS[d["scope"]]["title"]
    return d

@app.get("/api/records")
def records(request: Request, scope: str | None = None, grade: int | None = None, search: str = ""):
    viewer=auth(request, {"registry","counseling"})
    query="SELECT * FROM nominations WHERE 1=1"
    args=[]
    if scope in SECTIONS:
        query+=" AND scope=?"; args.append(scope)
    if grade in (5,6,7,8):
        query+=" AND grade=?"; args.append(grade)
    if search:
        query+=" AND (student_name LIKE ? OR teacher_name LIKE ?)"; args.extend([f"%{search[:100]}%"]*2)
    query+=" ORDER BY id DESC LIMIT 1000"
    with database() as con:
        rows=[full_record(row) for row in con.execute(query,args)]
        add_audit(con,"records_view",viewer)
    return {"records":rows,"limit":1000}

@app.get("/api/records/{record_id}")
def get_record(record_id: int, request: Request):
    viewer=auth(request, {"registry","counseling"})
    with database() as con:
        row=con.execute("SELECT * FROM nominations WHERE id=?", (record_id,)).fetchone()
        if row:
            add_audit(con,"record_view",viewer,record_id)
    if not row:
        raise HTTPException(404, "السجل غير موجود.")
    return {"record":full_record(row),"criteria":SECTIONS[row["scope"]]["criteria"]}

@app.get("/api/stats")
def stats(request: Request):
    auth(request, {"registry","counseling"})
    with database() as con:
        count=con.execute("SELECT COUNT(*) c FROM nominations").fetchone()["c"]
        # Deduplication by normalized name + grade; production import should use internal student ID.
        unique=con.execute("SELECT COUNT(DISTINCT TRIM(student_name) || ':' || grade) c FROM nominations").fetchone()["c"]
        grouped=[dict(r) for r in con.execute("SELECT scope,COUNT(*) as count FROM nominations GROUP BY scope")]
        pending=con.execute("SELECT COUNT(*) c FROM nominations WHERE review_status='لم تتم المراجعة بعد'").fetchone()["c"]
    return {"nominations":count,"unique_students_estimate":unique,"by_section":grouped,"pending":pending,
            "unique_note":"عدد تقريبي بالأسماء والصفوف؛ يفضل استخدام رقم طالب داخلي لمنع الالتباس."}

class Review(BaseModel):
    review_note: str = Field(default="",max_length=3000)
    review_status: str = "لم تتم المراجعة بعد"

@app.post("/api/records/{record_id}/review")
def review(record_id: int, data: Review, request: Request):
    auth(request, {"counseling"})
    if data.review_status not in REVIEW_STATES:
        raise HTTPException(422, "حالة المراجعة غير معروفة.")
    with database() as con:
        row=con.execute("SELECT id FROM nominations WHERE id=?", (record_id,)).fetchone()
        if not row:
            raise HTTPException(404, "السجل غير موجود.")
        con.execute("UPDATE nominations SET review_note=?,review_status=?,reviewed_at=CURRENT_TIMESTAMP WHERE id=?",
                    (data.review_note,data.review_status,record_id))
        add_audit(con,"review_update","counseling",record_id)
    return {"ok":True}

def csv_safe(v):
    value="" if v is None else str(v)
    if value and value.lstrip().startswith(("=","+","-","@")):
        return "'"+value
    return value

@app.get("/api/export.csv")
def export_csv(request: Request):
    viewer=auth(request, {"registry","counseling"})
    buffer=io.StringIO()
    writer=csv.writer(buffer)
    writer.writerow(["رقم","المادة","اسم الطالب","الصف","الشعبة","اسم المعلم","الموهبة","الوصف","الملاحظات","دليل الموهبة","رأي اللجنة","حالة المراجعة","تاريخ التسجيل"])
    with database() as con:
        for r in con.execute("SELECT * FROM nominations ORDER BY id DESC"):
            writer.writerow([csv_safe(x) for x in (r["id"],SECTIONS[r["scope"]]["title"],r["student_name"],r["grade"],r["classroom"],r["teacher_name"],r["talent_type"],r["talent_details"],r["comments"],r["evidence_note"],r["review_note"],r["review_status"],r["created_at"])])
        add_audit(con,"csv_export",viewer)
    return Response(content="\ufeff"+buffer.getvalue(),media_type="text/csv; charset=utf-8",headers={"Content-Disposition":"attachment; filename=talent-nominations.csv","Cache-Control":"no-store"})

@app.get("/healthz")
def health():
    return {"ok":True}
