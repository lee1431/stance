from pathlib import Path
from html.parser import HTMLParser
import re

root = Path(__file__).resolve().parent

class Page(HTMLParser):
    def __init__(self, path):
        super().__init__()
        self.ids = []
        self.feed(path.read_text(encoding="utf-8"))
    def handle_starttag(self, tag, attrs):
        value = dict(attrs).get("id")
        if value:
            self.ids.append(value)

for html, script in [("index.html", "app.js"), ("index.html", "delivery-map.js"), ("admin/index.html", "admin/admin.js")]:
    page = Page(root / html)
    assert len(page.ids) == len(set(page.ids)), (html, "duplicate ids")
    js = (root / script).read_text(encoding="utf-8")
    refs = set(re.findall(r"\$\('([^']+)'\)", js))
    assert refs <= set(page.ids), (script, "missing ids", refs - set(page.ids))

page = Page(root / "index.html")
assert page.ids.index("scanTab") < page.ids.index("mapTab") < page.ids.index("listTab")
assert page.ids.index("cameraVideo") < page.ids.index("waybillInput") < page.ids.index("recentScans")
assert {"mapPopup", "orderWheel", "mapOrderSave", "mapEdit", "mapNav", "pinPopup", "pinSave", "stopList"} <= set(page.ids)
assert not {"resetMapOrder", "undoMapOrder", "deliveryMapFitBtn"} & set(page.ids)
assert (root / "connect/index.html").exists()
print("DDSM UI contract OK")
