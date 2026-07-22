#!/usr/bin/env python3
"""Generate blogs/feed.xml (RSS 2.0) from blogs/posts.json.

Source of truth is posts.json (edited by hand or seeded from the index). Only
dated posts are emitted as items, newest first. Run after editing posts.json:

    python blogs/build_feed.py
"""
import io
import sys
import json
from datetime import datetime, timezone
from pathlib import Path
from xml.sax.saxutils import escape

try:
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
except Exception:
    pass

SITE = "https://svyoma.github.io"
HERE = Path(__file__).parent
POSTS = HERE / "posts.json"
OUT = HERE / "feed.xml"

CHANNEL_TITLE = "Vyom A. Shah — Sanskrit & Prakrit Studies"
CHANNEL_DESC = ("Essays on Jaina literature, Sanskrit and Prakrit poetry, śleṣa, "
                "stuti, manuscripts and grammar by Vyom A. Shah.")


def rfc822(iso):
    dt = datetime.strptime(iso, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    return dt.strftime("%a, %d %b %Y %H:%M:%S +0000")


def main():
    posts = json.loads(POSTS.read_text(encoding="utf-8"))
    dated = [p for p in posts if p.get("date")]
    dated.sort(key=lambda p: p["date"], reverse=True)

    items = []
    for p in dated:
        link = SITE + p["url"] if p["url"].startswith("/") else p["url"]
        cats = "".join("<category>%s</category>" % escape(t) for t in p.get("tags", []))
        desc = p.get("excerpt") or p.get("title", "")
        items.append(
            "    <item>\n"
            "      <title>%s</title>\n"
            "      <link>%s</link>\n"
            "      <guid isPermaLink=\"true\">%s</guid>\n"
            "      <pubDate>%s</pubDate>\n"
            "      %s\n"
            "      <description>%s</description>\n"
            "    </item>"
            % (escape(p.get("title", "")), escape(link), escape(link),
               rfc822(p["date"]), cats, escape(desc))
        )

    now = datetime.now(timezone.utc).strftime("%a, %d %b %Y %H:%M:%S +0000")
    xml = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">\n'
        "  <channel>\n"
        "    <title>%s</title>\n"
        "    <link>%s/blogs</link>\n"
        '    <atom:link href="%s/blogs/feed.xml" rel="self" type="application/rss+xml"/>\n'
        "    <description>%s</description>\n"
        "    <language>en</language>\n"
        "    <lastBuildDate>%s</lastBuildDate>\n"
        "%s\n"
        "  </channel>\n"
        "</rss>\n"
        % (escape(CHANNEL_TITLE), SITE, SITE, escape(CHANNEL_DESC), now, "\n".join(items))
    )
    OUT.write_text(xml, encoding="utf-8")
    print("wrote %s — %d items (of %d posts; undated omitted)"
          % (OUT.name, len(dated), len(posts)))


if __name__ == "__main__":
    main()
