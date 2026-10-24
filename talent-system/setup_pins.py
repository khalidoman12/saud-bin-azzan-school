# -*- coding: utf-8 -*-
"""Provision 12 four-digit PINs interactively; NEVER commit them or this private database."""
from getpass import getpass
from criteria import SECTIONS
from server import init_db, install_pin

def main():
    init_db()
    print("تهيئة رموز رصد الموهبة (تخزن بصيغة مشتقة ومملحة في قاعدة البيانات المحلية)")
    print("تحذير: الرمز الرباعي عامل دخول ضعيف؛ أضف حسابات فردية وحماية مؤسسية قبل الإنتاج.")
    for scope, title in [(key, data["title"]) for key,data in SECTIONS.items()] + [("registry","سجل تقييم الطلبة الموهوبين")]:
        while True:
            pin=getpass(f"{title}: أدخل رمزًا من 4 أرقام: ").strip()
            confirmation=getpass("أعد إدخال الرمز: ").strip()
            if not (len(pin)==4 and pin.isascii() and pin.isdigit()):
                print("يجب أن يتكون الرمز من أربعة أرقام إنجليزية 0-9.")
                continue
            if pin!=confirmation:
                print("الرمزان غير متطابقين.")
                continue
            install_pin(scope,pin)
            print("تم إعداد رمز القسم.")
            break
    print("اكتملت تهيئة جميع الأقسام.")

if __name__=="__main__":
    main()
