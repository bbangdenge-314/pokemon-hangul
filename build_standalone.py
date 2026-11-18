#!/usr/bin/env python3
"""index.html + style.css + data.js + app.js 를 한 파일(standalone.html)로 합칩니다."""
import pathlib

base = pathlib.Path(__file__).resolve().parent
html = (base / 'index.html').read_text(encoding='utf-8')
css = (base / 'style.css').read_text(encoding='utf-8')
data = (base / 'data.js').read_text(encoding='utf-8')
app = (base / 'app.js').read_text(encoding='utf-8')

for src in (css, data, app):
    assert '</script>' not in src, 'script 태그를 닫는 문자열이 들어 있습니다'

html = html.replace('<link rel="stylesheet" href="style.css">', '<style>\n' + css + '\n</style>')
html = html.replace('<script src="data.js"></script>', '<script>\n' + data + '\n</script>')
html = html.replace('<script src="app.js"></script>', '<script>\n' + app + '\n</script>')
html = html.replace('<link rel="manifest" href="manifest.json">', '')
html = html.replace('<title>포켓몬 한글 따라쓰기</title>', '<title>포켓몬 한글 따라쓰기 · 한 파일 버전</title>')

(base / 'standalone.html').write_text(html, encoding='utf-8')
print('standalone.html', len(html), 'bytes')
