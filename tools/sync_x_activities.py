#!/usr/bin/env python3
"""Best-effort, key-free import of new public posts from the school's X profile.

The script never deletes existing archive records. X may change or restrict its
logged-out page at any time; in that case this command reports failure and
leaves the checked-in data untouched.
"""

from __future__ import annotations

import argparse
import html
import json
import re
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Iterable
from urllib.parse import urljoin, urlparse
from urllib.request import Request, urlopen
from urllib.error import URLError
from zoneinfo import ZoneInfo


ACCOUNT = "EduGovSsq5302"
PROFILE_URL = f"https://x.com/{ACCOUNT}"
STATUS_PATTERN = re.compile(rf"/{ACCOUNT}/status/(\d+)", re.IGNORECASE)
MEDIA_PATTERN = re.compile(r"https://pbs\.twimg\.com/media/", re.IGNORECASE)
VOID_TAGS = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}
GRADE_PATTERN = re.compile(r"(?:الصف|صف)\s*(الخامس|السادس|السابع|الثامن|[٥-٨5-8])")
GRADE_MAP = {
    "الخامس": 5,
    "السادس": 6,
    "السابع": 7,
    "الثامن": 8,
    "٥": 5,
    "٦": 6,
    "٧": 7,
    "٨": 8,
    "5": 5,
    "6": 6,
    "7": 7,
    "8": 8,
}
MUSCAT = ZoneInfo("Asia/Muscat")


@dataclass
class ParsedPost:
    source_id: str | None = None
    datetime_value: str | None = None
    tweet_text_parts: list[str] = field(default_factory=list)
    images: list[str] = field(default_factory=list)
    video_posters: list[str] = field(default_factory=list)

    @property
    def text(self) -> str:
        value = " ".join(self.tweet_text_parts)
        return re.sub(r"\s+", " ", html.unescape(value)).strip()


class XTimelineParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.current: ParsedPost | None = None
        self.article_depth = 0
        self.tweet_text_depth = 0
        self.posts: list[ParsedPost] = []

    def handle_starttag(self, tag: str, attrs_list: list[tuple[str, str | None]]) -> None:
        attrs = {key: value or "" for key, value in attrs_list}
        if tag == "article" and self.current is None:
            self.current = ParsedPost()
            self.article_depth = 1
            return
        if self.current is None:
            return

        is_void = tag in VOID_TAGS
        if not is_void:
            self.article_depth += 1
        if self.tweet_text_depth and not is_void:
            self.tweet_text_depth += 1
        if attrs.get("data-testid") == "tweetText" or (attrs.get("dir") == "auto" and "whitespace-pre-wrap" in attrs.get("class", "") and not self.tweet_text_depth):
            self.tweet_text_depth = 1

        if tag == "a":
            href = attrs.get("href", "")
            match = STATUS_PATTERN.search(href)
            if match and self.current.source_id is None:
                self.current.source_id = match.group(1)
        elif tag == "time" and attrs.get("datetime"):
            self.current.datetime_value = attrs["datetime"]
        elif tag == "img":
            src = html.unescape(attrs.get("src", ""))
            if MEDIA_PATTERN.match(src) and src not in self.current.images:
                self.current.images.append(src)
            elif src.startswith("https://pbs.twimg.com/") and "video_thumb/" in src and src not in self.current.video_posters:
                self.current.video_posters.append(src)
        elif tag == "video":
            poster = html.unescape(attrs.get("poster", ""))
            if poster and poster not in self.current.video_posters:
                self.current.video_posters.append(poster)

    def handle_startendtag(self, tag: str, attrs_list: list[tuple[str, str | None]]) -> None:
        if self.current is None:
            return
        attrs = {key: value or "" for key, value in attrs_list}
        if tag == "img":
            src = html.unescape(attrs.get("src", ""))
            if MEDIA_PATTERN.match(src) and src not in self.current.images:
                self.current.images.append(src)

    def handle_data(self, data: str) -> None:
        if self.current is not None and self.tweet_text_depth and data.strip():
            self.current.tweet_text_parts.append(data.strip())

    def handle_endtag(self, tag: str) -> None:
        if self.current is None:
            return
        if self.tweet_text_depth:
            self.tweet_text_depth -= 1
        self.article_depth -= 1
        if self.article_depth == 0:
            if self.current.source_id and self.current.text:
                self.posts.append(self.current)
            self.current = None
            self.tweet_text_depth = 0


def find_chrome() -> str | None:
    for candidate in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser"):
        path = shutil.which(candidate)
        if path:
            return path
    return None


def fetch_profile_html() -> str | None:
    # Current public X pages render post text in the initial HTML. Prefer that
    # public surface; Chrome remains a fallback for client-rendered versions.
    try:
        with urlopen(Request(PROFILE_URL, headers={"User-Agent": "SchoolActivityArchive/1.0"}), timeout=25) as response:
            document = response.read(5_000_000).decode("utf-8")
        if parse_posts(document):
            return document
    except (URLError, TimeoutError, OSError, UnicodeDecodeError) as error:
        print(f"Public profile request failed: {error}", file=sys.stderr)
    chrome = find_chrome()
    if not chrome:
        print("warning: Chrome/Chromium is unavailable; archive left unchanged", file=sys.stderr)
        return None

    with tempfile.TemporaryDirectory(prefix="school-x-sync-") as profile_dir:
        command = [
            chrome,
            "--headless=new",
            "--no-sandbox",
            "--disable-dev-shm-usage",
            "--disable-gpu",
            "--disable-background-networking",
            "--disable-extensions",
            "--lang=ar",
            "--window-size=1440,2400",
            "--virtual-time-budget=20000",
            f"--user-data-dir={profile_dir}",
            "--dump-dom",
            PROFILE_URL,
        ]
        try:
            result = subprocess.run(command, check=False, capture_output=True, text=True, timeout=90)
        except (OSError, subprocess.TimeoutExpired) as error:
            print(f"warning: could not open the public X profile ({error}); archive left unchanged", file=sys.stderr)
            return None

    if result.returncode != 0 or "<article" not in result.stdout:
        detail = result.stderr.strip().splitlines()[-1] if result.stderr.strip() else "no public posts found"
        print(f"warning: X did not expose a usable public timeline ({detail}); archive left unchanged", file=sys.stderr)
        return None
    return result.stdout


def snowflake_datetime(source_id: str) -> datetime:
    timestamp_ms = (int(source_id) >> 22) + 1_288_834_974_657
    return datetime.fromtimestamp(timestamp_ms / 1000, tz=timezone.utc)


def post_datetime(post: ParsedPost) -> datetime:
    if post.datetime_value:
        try:
            value = datetime.fromisoformat(post.datetime_value.replace("Z", "+00:00"))
            return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
        except ValueError:
            pass
    if not post.source_id:
        raise ValueError("post has no source ID")
    return snowflake_datetime(post.source_id)


def contains_any(text: str, words: Iterable[str]) -> bool:
    return any(word in text for word in words)


def classify(text: str) -> tuple[str, bool]:
    specialist = contains_any(text, ("الإرشاد", "الارشاد", "نفسي", "اجتماعي", "سلوكي", "لائحة شؤون الطلبة"))
    if specialist:
        return "guidance", True
    if contains_any(text, ("حافل", "النقل المدرسي", "سائق")):
        return "transport", False
    if contains_any(text, ("صحي", "صحية", "ممرض", "مرض", "سلامة", "المقصف")):
        return "health", False
    if contains_any(text, ("تكريم", "كرّم", "كرم", "تهنئة", "احتفاء")):
        return "honors", False
    if contains_any(text, ("زيارة", "زار", "استقبل", "تفضل")):
        return "visits", False
    if contains_any(text, ("ولي الأمر", "أولياء الأمور", "الشراكة المجتمعية", "المجتمع المحلي")):
        return "community", False
    if contains_any(text, ("ملخص", "فيديو", "تغطية", "تصميم", "جانب من")):
        return "media", False
    if contains_any(text, ("اجتماع", "لجنة", "إدارة المدرسة", "مدير المدرسة", "تنظيم")):
        return "administration", False
    if contains_any(text, ("درسًا", "درسا", "حصة", "حصص", "تعلم", "رياضيات", "علوم", "لغة")):
        return "teaching", False
    return "student-life", False


def infer_audiences(text: str, specialist: bool) -> list[str]:
    audiences: list[str] = []
    if contains_any(text, ("طالب", "الطلبة", "طلاب")):
        audiences.append("الطلبة")
    if contains_any(text, ("معلم", "المعلمين", "الهيئة التدريسية")):
        audiences.append("المعلمون")
    if contains_any(text, ("ولي الأمر", "أولياء الأمور")):
        audiences.append("أولياء الأمور")
    if specialist:
        audiences.append("الأخصائيون")
    return list(dict.fromkeys(audiences or ["المجتمع المدرسي"]))


def infer_grades(text: str) -> list[int]:
    return sorted({GRADE_MAP[value] for value in GRADE_PATTERN.findall(text) if value in GRADE_MAP})


def make_title(text: str) -> str:
    cleaned = re.sub(r"(?:https?://\S+|#[\w\u0600-\u06FF]+)", "", text).strip(" .،ـ-")
    # Arabic titles commonly contain the abbreviation أ. before a name.
    sentence = re.split(r"[!؟\n]", cleaned, maxsplit=1)[0].strip()
    if len(sentence) <= 92:
        return sentence or "فعالية مدرسية"
    return sentence[:89].rsplit(" ", 1)[0] + "…"


def post_to_activity(post: ParsedPost) -> dict:
    assert post.source_id
    timestamp = post_datetime(post).astimezone(MUSCAT)
    category, specialist = classify(post.text)
    media = [
        {"type": "image", "url": url, "alt": make_title(post.text)}
        for url in post.images
    ]
    media.extend(
        {"type": "video", "url": url, "alt": f"فيديو: {make_title(post.text)}"}
        for url in post.video_posters
        if url not in post.images
    )
    return {
        "id": f"x-{post.source_id}",
        "sourceId": post.source_id,
        "date": timestamp.date().isoformat(),
        "title": make_title(post.text),
        "description": post.text,
        "category": category,
        "audiences": infer_audiences(post.text, specialist),
        "people": [],
        "grades": infer_grades(post.text),
        "specialist": specialist,
        "media": media,
        "sourceUrl": urljoin("https://x.com", f"/{ACCOUNT}/status/{post.source_id}"),
        "sourceLabel": "عرض المنشور الأصلي",
        "verifiedAt": datetime.now(timezone.utc).date().isoformat(),
    }


def parse_posts(document: str) -> list[ParsedPost]:
    parser = XTimelineParser()
    parser.feed(document)
    unique: dict[str, ParsedPost] = {}
    for post in parser.posts:
        if post.source_id:
            unique.setdefault(post.source_id, post)
    return list(unique.values())


def update_archive(data_path: Path, posts: list[ParsedPost]) -> int:
    payload = json.loads(data_path.read_text(encoding="utf-8"))
    activities = payload["activities"]
    existing_ids = {str(item["sourceId"]): item for item in activities if item.get("sourceId")}
    start_date = datetime.fromisoformat(payload["source"]["rangeStart"]).date()
    added: list[dict] = []
    enriched = 0

    def media_key(url: str) -> str:
        return re.sub(r"\.(jpg|jpeg|png|webp)$", "", urlparse(url).path)

    for post in posts:
        if not post.source_id:
            continue
        activity = post_to_activity(post)
        if datetime.fromisoformat(activity["date"]).date() < start_date:
            continue
        existing = existing_ids.get(post.source_id)
        if existing is None and activity["media"]:
            keys = {media_key(m["url"]) for m in activity["media"]}
            candidates = [a for a in activities if not a.get("sourceId") and any(media_key(m["url"]) in keys for m in a["media"])]
            if len(candidates) == 1:
                existing = candidates[0]
        if existing is not None:
            before = json.dumps(existing, ensure_ascii=False, sort_keys=True)
            # Keep the curated title, categories, people and any saved photos.
            existing.update({key: activity[key] for key in ("sourceId", "sourceUrl", "sourceLabel", "date", "description")})
            existing.setdefault("verifiedAt", activity["verifiedAt"])
            known_media = {media_key(m["url"]) for m in existing["media"]}
            existing["media"].extend(m for m in activity["media"] if media_key(m["url"]) not in known_media)
            enriched += before != json.dumps(existing, ensure_ascii=False, sort_keys=True)
            existing_ids[post.source_id] = existing
            continue
        added.append(activity)
        existing_ids[post.source_id] = activity

    if not added and not enriched:
        print(f"No new posts. Parsed {len(posts)} public post(s); archive unchanged.")
        return 0

    activities.extend(added)
    activities.sort(key=lambda item: (item["date"], item["id"]), reverse=True)
    payload["source"]["rangeEnd"] = max(item["date"] for item in activities)
    payload["source"]["lastSyncedAt"] = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    payload["source"]["syncMethod"] = "مزامنة مجانية للمنشورات المتاحة من صفحة X العامة"
    payload["source"]["coverage"] = "partial"
    data_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Added {len(added)}, enriched {enriched}; archive contains {len(activities)} activities.")
    return len(added) + enriched


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", type=Path, default=Path("data/activities.generated.json"))
    parser.add_argument("--html-file", type=Path, help="Use saved HTML instead of opening X (for tests/debugging).")
    args = parser.parse_args()

    if not args.data.exists():
        print(f"error: data file not found: {args.data}", file=sys.stderr)
        return 2
    document = args.html_file.read_text(encoding="utf-8") if args.html_file else fetch_profile_html()
    if not document:
        print("::error::تعذر الوصول إلى المنشورات العامة؛ الأرشيف السابق محفوظ.")
        return 1
    posts = parse_posts(document)
    if not posts:
        print("::error::لم تُقرأ منشورات من الصفحة؛ يلزم فحص المزامنة. الأرشيف السابق محفوظ.", file=sys.stderr)
        return 1
    update_archive(args.data, posts)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
