"""US & LV India: Streamlit host for the static website in ./src."""
from __future__ import annotations

import base64
import json
import logging
import mimetypes
import re
from pathlib import Path

import streamlit as st
import streamlit.components.v1 as components

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
SRC_DIR = Path(__file__).parent / "src"
HTML_FILE = SRC_DIR / "index.html"
CSS_FILE = SRC_DIR / "style.css"
JS_FILE = SRC_DIR / "script.js"
LOGO_FILE = SRC_DIR / "logo.png"

IMAGE_EXTENSIONS = (".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico")
LARGE_IMAGE_BYTES = 600 * 1024  # warn in the log above this size
FALLBACK_HEIGHT = 900  # pixel fallback only; HOST_CSS stretches the iframe to the window

log = logging.getLogger("uslv")

st.set_page_config(
    page_title="US & LV India | The Growth Transformers",
    page_icon=str(LOGO_FILE) if LOGO_FILE.exists() else "🚀",
    layout="wide",
    initial_sidebar_state="collapsed",
)

# Strips Streamlit chrome and makes the site iframe fill the window.
# The site scrolls inside the iframe, so its sticky header keeps working.
HOST_CSS = """
#MainMenu, footer, header,
[data-testid="stHeader"], [data-testid="stToolbar"],
[data-testid="stDecoration"], [data-testid="stStatusWidget"] {
    display: none !important;
}
html, body, .stApp,
[data-testid="stAppViewContainer"], [data-testid="stMain"] {
    margin: 0;
    background: #fff;
    overflow: hidden;
}
.block-container, [data-testid="stMainBlockContainer"] {
    padding: 0 !important;
    max-width: 100% !important;
}
[data-testid="stVerticalBlock"] { gap: 0 !important; }
.stApp iframe {
    display: block;
    width: 100%;
    border: 0;
    height: 100vh !important;
    height: 100dvh !important;
}
"""

# Smooth in-page anchor navigation. Plain "#section" links inside an iframe
# can resolve against the parent URL in some browsers, so handle them in JS.
ANCHOR_SHIM = """
<script>
document.addEventListener('click', function (e) {
  var link = e.target.closest('a[href^="#"]');
  if (!link) return;
  var id = decodeURIComponent(link.getAttribute('href').slice(1));
  var target = id ? document.getElementById(id) : document.body;
  if (!target) return;
  e.preventDefault();
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  target.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  if (id) { target.setAttribute('tabindex', '-1'); target.focus({ preventScroll: true }); }
});
</script>
"""

# Matches local image references such as src="logo.png" or href="logo.png".
IMAGE_REF = re.compile(
    r"""(?P<attr>\b(?:src|href))=(?P<q>["'])(?P<path>[^"']+?\.(?:png|jpe?g|gif|webp|svg|ico))(?P=q)""",
    re.IGNORECASE,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _read(path: Path, *, required: bool = False) -> str:
    if not path.exists():
        if required:
            raise FileNotFoundError(path)
        return ""
    return path.read_text(encoding="utf-8")


def _signature() -> tuple:
    """Changes whenever any file in src/ is added, removed or edited, so the cache refreshes."""
    files = sorted(p for p in SRC_DIR.glob("*") if p.is_file()) if SRC_DIR.exists() else []
    return tuple((p.name, p.stat().st_mtime_ns) for p in files)


def _client_config() -> str:
    """Public settings for script.js. Set FORM_ENDPOINT in .streamlit/secrets.toml."""
    try:
        endpoint = str(st.secrets.get("FORM_ENDPOINT", "")).strip()
    except Exception:  # no secrets file configured
        endpoint = ""
    if not endpoint:  # an empty value would override the script's own default
        return ""
    payload = json.dumps({"FORM_ENDPOINT": endpoint}).replace("</", "<\\/")
    return f"<script>window.USLV_CONFIG = {payload};</script>"


def _inline_images(html: str) -> str:
    """Embed local images as data URIs: the iframe has no file server, so relative paths would 404."""
    root = SRC_DIR.resolve()
    cache: dict[str, str] = {}

    def replace(match: re.Match) -> str:
        ref = match.group("path")
        if "://" in ref or ref.startswith(("data:", "//", "/")):
            return match.group(0)

        if ref not in cache:
            file = (SRC_DIR / ref).resolve()
            inside_src = file == root or root in file.parents  # blocks "../" escapes
            if not (inside_src and file.is_file() and file.suffix.lower() in IMAGE_EXTENSIONS):
                log.warning("Image not found in src/: %s", ref)
                cache[ref] = ""
            else:
                data = file.read_bytes()
                if len(data) > LARGE_IMAGE_BYTES:
                    log.warning("%s is %d KB; compress it for faster loading.", ref, len(data) // 1024)
                mime = mimetypes.guess_type(file.name)[0] or "application/octet-stream"
                cache[ref] = f"data:{mime};base64,{base64.b64encode(data).decode('ascii')}"

        if not cache[ref]:
            return match.group(0)  # leave the original so the alt text still shows
        return f"{match.group('attr')}={match.group('q')}{cache[ref]}{match.group('q')}"

    return IMAGE_REF.sub(replace, html)


def _replace_or_insert(html: str, pattern: str, block: str, marker: str) -> str:
    """Swap the first tag matching `pattern` for `block`; otherwise insert before `marker`."""
    new_html, count = re.subn(pattern, lambda _m: block, html, count=1, flags=re.I)
    if count:
        return new_html
    idx = html.lower().rfind(marker)
    return html + block if idx == -1 else html[:idx] + block + html[idx:]


# ---------------------------------------------------------------------------
# Page assembly (cached; rebuilt automatically when any src/ file changes)
# ---------------------------------------------------------------------------
@st.cache_data(show_spinner=False)
def build_page(_signature_key: tuple) -> str:
    html = _read(HTML_FILE, required=True)
    css = _read(CSS_FILE).replace("</style", "<\\/style")
    js = _read(JS_FILE).replace("</script", "<\\/script")

    if not html.lstrip().lower().startswith("<!doctype"):
        html = "<!DOCTYPE html>\n" + html

    css = _inline_images(css)  # in case the stylesheet references local images
    html = _inline_images(html)

    # Inline the stylesheet and script (links to style.css / script.js would 404 here).
    html = _replace_or_insert(
        html,
        r'<link[^>]*href=["\']style\.css["\'][^>]*>',
        f"<style>\n{css}\n</style>",
        "</head>",
    )
    scripts = f"{_client_config()}\n<script>\n{js}\n</script>\n{ANCHOR_SHIM}"
    return _replace_or_insert(
        html,
        r'<script[^>]*src=["\']script\.js["\'][^>]*>\s*</script>',
        scripts,
        "</body>",
    )


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
def main() -> None:
    st.markdown(f"<style>{HOST_CSS}</style>", unsafe_allow_html=True)
    try:
        page = build_page(_signature())
    except FileNotFoundError as exc:
        st.error(f"Site file not found: `{exc}`. Put index.html, style.css and script.js in the `src/` folder.")
        st.stop()
    components.html(page, height=FALLBACK_HEIGHT, scrolling=True)


main()