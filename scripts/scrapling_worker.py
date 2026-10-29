"""HTML parts for the crawler, read with Scrapling's parser.

Protocol: one JSON object per line on stdin ({"id", "html", "url"}); one JSON line back
({"id", "parts"} or {"id", "error"}). The HTML is untrusted data and is only parsed, never executed.
This is parsing only: nothing here fetches a page.
"""
import json
import re
import sys

from scrapling.parser import Selector

WS = re.compile(r"\s+")
SKIP = ("script", "style", "noscript", "svg", "template")


def norm(s):
    return WS.sub(" ", s or "").strip()


def attrs(el):
    return {str(k).lower(): str(v) for k, v in el.attrib.items()}


def text_of(el):
    return norm(el.get_all_text(separator=" ", strip=True, ignore_tags=SKIP))


def parts(html, url):
    page = Selector(html, url=url)
    heads = page.css("head")
    head = heads[0] if len(heads) else None
    bodies = page.css("body")
    body = bodies[0] if len(bodies) else page
    title = norm(page.css("title::text").get() or "")
    ld = []
    for el in page.css('script[type="application/ld+json"]'):
        ld.append(el.text or "")
    imgs = [attrs(i) for i in page.css("img")]
    anchors = []
    for a in body.css("a"):
        at = attrs(a)
        label = text_of(a)
        if not label:
            inner = a.css("img")
            label = norm(inner[0].attrib.get("alt", "")) if len(inner) else ""
        anchors.append({"href": at.get("href", ""), "rel": at.get("rel", ""), "text": label})
    insecure = len(
        page.css(
            'script[src^="http://"], img[src^="http://"], iframe[src^="http://"], '
            'source[src^="http://"], link[rel~="stylesheet"][href^="http://"]'
        )
    )
    scope = head if head is not None else page
    return {
        "title": title,
        "metas": [attrs(m) for m in scope.css("meta")],
        "links": [attrs(l) for l in scope.css("link")],
        "headings": {lvl: [text_of(h)[:200] for h in body.css(lvl)] for lvl in ("h1", "h2", "h3")},
        "anchors": anchors,
        "imgs": imgs,
        "ld": ld,
        "text": text_of(body),
        "lang": page.css("html::attr(lang)").get() or "",
        "insecure": insecure,
        "metaRefresh": len(page.css('meta[http-equiv="refresh" i]')) > 0,
    }


def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except ValueError:
            continue
        try:
            out = {"id": req["id"], "parts": parts(req["html"], req["url"])}
        except Exception as err:  # a malformed document must not stop the crawl
            out = {"id": req.get("id"), "error": type(err).__name__ + ": " + str(err)[:200]}
        sys.stdout.write(json.dumps(out, ensure_ascii=False) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
