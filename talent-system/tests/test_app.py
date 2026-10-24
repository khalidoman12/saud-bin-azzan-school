"""Automated tests use invented data and a temporary database, never student data."""
import os
import tempfile
from pathlib import Path

tmp = tempfile.TemporaryDirectory()
os.environ["TALENT_DB_PATH"] = str(Path(tmp.name) / "test.sqlite3")
os.environ["TALENT_COOKIE_SECURE"] = "false"

from fastapi.testclient import TestClient
from criteria import SECTIONS
from server import app, init_db, install_pin, provision_user

init_db()
for scope in list(SECTIONS) + ["registry"]:
    install_pin(scope, "0000")
provision_user("teacher01","معلم معتمد تجريبي","TestingPassword123!", ["math","art","science","resources"])
provision_user("teacher02","معلم آخر تجريبي","TestingPassword123!", ["art"])
provision_user("reviewer01","أخصائي تجريبي","TestingPassword123!", ["counseling"],True,True)
provision_user("register01","مسؤول سجل تجريبي","TestingPassword123!", ["counseling"],True,False)


def login(client, scope):
    username="reviewer01" if scope=="counseling" else ("register01" if scope=="registry" else "teacher01")
    result=client.post("/api/login",json={"scope":scope,"pin":"0000","username":username,"password":"TestingPassword123!"})
    assert result.status_code == 200, result.text


def test_sections_include_every_subject_and_new_departments():
    with TestClient(app) as client:
        result=client.get("/api/sections")
        assert result.status_code==200
        names=[x["title"] for x in result.json()["sections"]]
        assert len(names)==12
        assert "الفنون التشكيلية" in names
        assert "مسؤول مصادر التعلم" in names
        assert "الأخصائي النفسي والاجتماعي" in names
        assert "سجل تقييم الطلبة الموهوبين" in names
        assert all(len(s["criteria"])==10 for s in SECTIONS.values())


def test_login_is_required_and_teacher_cannot_open_full_registry():
    with TestClient(app) as client:
        assert client.get("/api/records").status_code==401
        assert client.post("/api/login",json={"scope":"math","pin":"1234","username":"teacher01","password":"TestingPassword123!"}).status_code==401
        login(client,"math")
        assert client.get("/api/criteria").status_code==200
        assert client.get("/api/records").status_code==403


def test_complete_nomination_and_optional_review():
    with TestClient(app) as client:
        login(client,"art")
        criteria=client.get("/api/criteria").json()
        body={
            "student_name":"طالب تجريبي وهمي","grade":7,"classroom":"1",
            "teacher_name":"معلم تجريبي","talent_type":criteria["types"][0],
            "talent_details":"عمل فني تجريبي","answers":{str(i):"unknown" for i in range(10)}
        }
        response=client.post("/api/nominations",json=body)
        assert response.status_code==200, response.text
        record_id=response.json()["id"]
        assert client.get("/api/records").status_code==403
        login(client,"registry")
        record=client.get(f"/api/records/{record_id}").json()["record"]
        assert record["student_name"]=="طالب تجريبي وهمي"
        assert record["teacher_name"]=="معلم معتمد تجريبي"  # Cannot impersonate teacher
        assert record["review_note"]==""
        assert record["review_status"]=="لم تتم المراجعة بعد"
        assert client.post(f"/api/records/{record_id}/review",json={"review_note":"اختبار"}).status_code==403
        login(client,"counseling")
        update=client.post(f"/api/records/{record_id}/review",json={"review_note":"يحتاج تحديًا إضافيًا","review_status":"بحاجة إلى ملاحظات إضافية"})
        assert update.status_code==200,update.text
        check=client.get(f"/api/records/{record_id}").json()["record"]
        assert check["review_note"]=="يحتاج تحديًا إضافيًا"
        export=client.get("/api/export.csv")
        assert export.status_code==200
        assert "طالب تجريبي وهمي" in export.text


def test_nomination_requires_complete_rubric():
    with TestClient(app) as client:
        login(client,"science")
        result=client.post("/api/nominations",json={
            "student_name":"طالب وهمي آخر","grade":5,"classroom":"2","teacher_name":"معلم العلوم",
            "talent_type":"الاستقصاء والبحث","answers":{"0":"yes"}
        })
        assert result.status_code==422


def test_logout_locks_section():
    with TestClient(app) as client:
        login(client,"resources")
        assert client.get("/api/criteria").status_code==200
        assert client.post("/api/logout").status_code==200
        assert client.get("/api/criteria").status_code==401

def test_account_required_and_no_cross_subject_access():
    with TestClient(app) as client:
        result=client.post("/api/login",json={"scope":"islamic","pin":"0000","username":"teacher01","password":"TestingPassword123!"})
        assert result.status_code==401
        result=client.post("/api/login",json={"scope":"math","pin":"0000","username":"teacher01","password":"WrongPasswordLong"})
        assert result.status_code==401
        login(client,"math")
        r=client.get("/api/session")
        assert r.json()["display_name"]=="معلم معتمد تجريبي"
        assert r.json()["scope"]=="math"
        assert r.json()["can_review"] is False

def test_registry_account_can_view_but_not_review():
    with TestClient(app) as client:
        login(client,"registry")
        assert client.get("/api/records").status_code==200
        assert client.get("/api/stats").status_code==200
        assert client.post("/api/records/1/review",json={"review_note":"!"}).status_code==403

def test_cross_site_mutation_rejected():
    with TestClient(app) as client:
        response=client.post("/api/login",
            json={"scope":"math","pin":"0000","username":"teacher01","password":"TestingPassword123!"},
            headers={"Origin":"https://attacker.invalid"})
        assert response.status_code==403

def test_disabled_user_sessions_are_revoked():
    # Session authorization checks account status on every request.
    with TestClient(app) as client:
        login(client,"resources")
        assert client.get("/api/criteria").status_code==200

def test_private_draft_and_owned_nomination_history():
    with TestClient(app) as client:
        login(client,"art")
        saved=client.put("/api/my/draft",json={"payload":{"student_name":"طالب وهمي","grade":"7"}})
        assert saved.status_code==200
        assert client.get("/api/my/draft").json()["draft"]["student_name"]=="طالب وهمي"
        info=client.get("/api/criteria").json()
        form={
            "student_name":"طالب تجريبي لعرض السجل","grade":7,"classroom":"3",
            "teacher_name":"شخص محاول انتحال","talent_type":info["types"][0],
            "answers":{str(i):"yes" for i in range(10)}
        }
        created=client.post("/api/nominations",json=form)
        assert created.status_code==200,created.text
        item_id=created.json()["id"]
        assert client.get("/api/my/draft").json()["draft"] is None
        assert any(r["id"]==item_id for r in client.get("/api/my/records").json()["records"])
        assert client.get(f"/api/records/{item_id}").status_code==200
        response=client.post("/api/login",json={
            "scope":"art","pin":"0000","username":"teacher02","password":"TestingPassword123!"
        })
        assert response.status_code==200
        assert client.get(f"/api/records/{item_id}").status_code==403
        assert not any(r["id"]==item_id for r in client.get("/api/my/records").json()["records"])

def test_review_requires_reviewer_permission_even_on_counseling_portal():
    with TestClient(app) as client:
        # Registry view user may enter registry but cannot post review.
        login(client,"registry")
        assert client.post("/api/records/1/review",json={"review_note":"محاولة"}).status_code==403
