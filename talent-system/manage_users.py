# -*- coding: utf-8 -*-
"""Operator-only account management. Run on the private application server."""
import argparse
import json
from getpass import getpass
from criteria import SECTIONS
from server import init_db, database, provision_user, hash_pin
import secrets

def prompt_password():
    while True:
        p=getpass("كلمة المرور الشخصية (12 حرفًا على الأقل): ")
        p2=getpass("أعد كلمة المرور: ")
        if len(p)<12 or len(p)>256:
            print("كلمة المرور قصيرة أو طويلة جدًا.")
        elif p!=p2:
            print("كلمتا المرور غير متطابقتين.")
        else:
            return p

def main():
    parser=argparse.ArgumentParser(description="إدارة حسابات مستخدمي رصد الموهبة")
    subs=parser.add_subparsers(dest="action",required=True)
    add=subs.add_parser("add",help="إضافة حساب معلم أو مختص")
    add.add_argument("--username",required=True)
    add.add_argument("--name",required=True)
    add.add_argument("--scopes",required=True,help="Comma-separated: "+",".join(SECTIONS))
    add.add_argument("--registry",action="store_true",help="صلاحية الاطلاع على السجل العام")
    add.add_argument("--reviewer",action="store_true",help="صلاحية مراجعة اللجنة؛ تتطلب counseling")
    disable=subs.add_parser("disable")
    disable.add_argument("--username",required=True)
    reset=subs.add_parser("reset-password")
    reset.add_argument("--username",required=True)
    subs.add_parser("list")
    args=parser.parse_args()
    init_db()
    if args.action=="add":
        scopes=[x.strip() for x in args.scopes.split(",") if x.strip()]
        if args.reviewer and "counseling" not in scopes:
            parser.error("--reviewer يتطلب تضمين counseling في الصلاحيات")
        provision_user(args.username,args.name,prompt_password(),scopes,args.registry,args.reviewer)
        print("تم إنشاء الحساب دون تسجيل كلمة المرور في الملفات.")
    elif args.action=="list":
        with database() as con:
            rows=con.execute("SELECT username,display_name,allowed_scopes,can_view_registry,can_review,is_active FROM users ORDER BY id").fetchall()
            for row in rows:
                print(row["username"],row["display_name"],row["allowed_scopes"],
                    "السجل:"+str(bool(row["can_view_registry"])),
                    "مراجعة:"+str(bool(row["can_review"])),
                    "نشط:"+str(bool(row["is_active"])))
    elif args.action=="disable":
        with database() as con:
            cur=con.execute("UPDATE users SET is_active=0 WHERE username=?",(args.username,))
            if not cur.rowcount:
                parser.error("الحساب غير موجود")
            con.execute("DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE username=?)",(args.username,))
        print("تم تعطيل الحساب وإلغاء الجلسات.")
    elif args.action=="reset-password":
        password=prompt_password()
        salt=secrets.token_bytes(32)
        with database() as con:
            cur=con.execute("UPDATE users SET salt=?,digest=?,failed_attempts=0,locked_until=0 WHERE username=?",
                        (salt,hash_pin(password,salt),args.username))
            if not cur.rowcount:
                parser.error("الحساب غير موجود")
            con.execute("DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE username=?)",(args.username,))
        print("تم تغيير كلمة المرور وإلغاء الجلسات.")
if __name__=="__main__":
    main()
