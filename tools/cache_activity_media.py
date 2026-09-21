#!/usr/bin/env python3
"""Store only the original public X images already referenced by the archive."""
import argparse
import hashlib
import json
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import Request, urlopen

MAX_BYTES = 8_000_000


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", type=Path, default=Path("data/activities.generated.json"))
    parser.add_argument("--public", type=Path, default=Path("public"))
    args = parser.parse_args()
    payload = json.loads(args.data.read_text())
    target = args.public / "activity-media"
    target.mkdir(parents=True, exist_ok=True)
    urls = {m["url"] for a in payload["activities"] for m in a["media"] if not m.get("localPath") or not (args.public / m["localPath"].lstrip("/")).is_file()}

    def save(url):
        parsed = urlparse(url)
        if parsed.scheme != "https" or parsed.netloc != "pbs.twimg.com":
            return url, None
        stem = hashlib.sha256(url.encode()).hexdigest()[:24]
        for extension in ("jpg", "png", "webp"):
            cached = target / (stem + "." + extension)
            if cached.is_file() and 0 < cached.stat().st_size <= MAX_BYTES:
                return url, "/activity-media/" + cached.name
        try:
            with urlopen(Request(url, headers={"User-Agent": "SchoolActivityArchive/1.0"}), timeout=20) as response:
                if urlparse(response.url).netloc != "pbs.twimg.com":
                    raise ValueError("unexpected media host")
                data = response.read(MAX_BYTES + 1)
                content_type = response.headers.get_content_type()
            valid = ((content_type == "image/jpeg" and data.startswith(b"\xff\xd8\xff"), "jpg"),
                     (content_type == "image/png" and data.startswith(b"\x89PNG\r\n\x1a\n"), "png"),
                     (content_type == "image/webp" and data[:4] == b"RIFF" and data[8:12] == b"WEBP", "webp"))
            extension = next((ext for ok, ext in valid if ok), None)
            if not extension or len(data) > MAX_BYTES:
                raise ValueError("invalid image response")
            name = stem + "." + extension
            temporary = target / (name + ".tmp")
            temporary.write_bytes(data)
            temporary.replace(target / name)
            return url, "/activity-media/" + name
        except Exception as error:
            print(f"::warning::Media unavailable: {url}: {error}", file=sys.stderr)
            return url, None

    results = dict(ThreadPoolExecutor(max_workers=5).map(save, sorted(urls)))
    for activity in payload["activities"]:
        for media in activity["media"]:
            if results.get(media["url"]):
                media["localPath"] = results[media["url"]]
    args.data.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")
    print(f"Saved {sum(bool(v) for v in results.values())}/{len(results)} new images; original links retained.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
