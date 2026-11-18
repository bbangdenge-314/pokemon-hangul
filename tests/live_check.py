#!/usr/bin/env python3
"""공개 주소(https://bbangdenge-314.github.io/pokemon-hangul/)에서 v4가 실제로 동작하는지 확인하고
화면 캡처를 downloads/ 에 저장합니다.

- 배포된 파일이 지금 저장소의 파일과 같은지 (해시 비교)
- 전국도감 1,025 · 1~9세대 · 6단계 · 울음소리 재생 · 도감·검색·상세
- 콘솔/페이지 오류 0건

    python3 tests/live_check.py
"""
import hashlib
import pathlib
import random
import sys
import urllib.request

from playwright.sync_api import sync_playwright

LIVE = "https://bbangdenge-314.github.io/pokemon-hangul/"
ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = pathlib.Path("/workspace/downloads")
KEY = "pokemon-hangul-v4"
random.seed(5)

results = []


def check(name, cond, detail=""):
    results.append((bool(cond), name, detail))
    print(("  PASS  " if cond else "  FAIL  ") + name + (("  — " + str(detail)) if detail else ""))
    return bool(cond)


def live_bytes(path):
    req = urllib.request.Request(LIVE + path + "?nocache=%d" % random.randint(1, 10 ** 9),
                                 headers={"Cache-Control": "no-cache"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.status, r.read()


def main():
    OUT.mkdir(parents=True, exist_ok=True)

    # ---------- 1. 배포된 파일 ----------
    status, html = live_bytes("index.html")
    check("공개 주소 HTTP 200", status == 200, status)
    check("v4 파일을 불러옴 (pokemon-data.js?v=4)",
          b"pokemon-data.js?v=4" in html and b"style.css?v=4" in html, html[:80])
    for name in ["app.js", "data.js", "pokemon-data.js", "style.css"]:
        st, body = live_bytes(name)
        local = (ROOT / name).read_bytes()
        check(f"배포된 {name} 가 저장소 파일과 같음", st == 200 and hashlib.sha256(body).hexdigest() == hashlib.sha256(local).hexdigest(),
              f"{len(body)} vs {len(local)} bytes")

    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=["--autoplay-policy=no-user-gesture-required"])
        ctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2,
                                  locale="ko-KR", is_mobile=True, has_touch=True,
                                  user_agent="Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36")
        page = ctx.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: errors.append("console:" + m.text) if m.type == "error" else None)

        page.goto(LIVE + "?live=v4#debug", wait_until="load")
        page.wait_for_timeout(1500)
        page.evaluate("() => window.__trace.clearStorage()")
        page.goto(LIVE + "?live=v4b#debug", wait_until="load")
        page.wait_for_timeout(1500)

        data = page.evaluate("""() => ({
            count: window.POKE_DATA.COUNT,
            gens: (() => { const g = {}; window.POKE_DATA.POKE_IDS.forEach(id => { const k = window.POKE_DATA.POKEMON[id].gen; g[k] = (g[k] || 0) + 1; }); return g; })(),
            stages: window.POKE_DATA.STAGES.length,
            hasTrace: !!window.__trace,
            svg: !!document.querySelector('.home-title'),
            badge: (document.querySelector('.home-badge') || {}).textContent || ''
        })""")
        check("공개 주소에 v4 데이터 (1,025마리)", data["count"] == 1025 and data["hasTrace"], data["count"])
        check("공개 주소에 1~9세대 모두", sorted(int(k) for k in data["gens"]) == list(range(1, 10)), data["gens"])
        check("6단계 · 새 홈 화면", data["stages"] == 6 and data["svg"], {"stages": data["stages"], "badge": data["badge"]})
        page.screenshot(path=str(OUT / "포켓몬한글-v4-홈.png"))

        # ---------- 2. 지도 ----------
        page.evaluate("() => { document.querySelector('[data-act=\"start\"]').click(); }")
        page.wait_for_timeout(700)
        check("모험 지도: 단계 6개 · 세대 칩 10개",
              page.evaluate("() => document.querySelectorAll('.stage-card').length") == 6 and
              page.evaluate("() => document.querySelectorAll('.gen-chip').length") == 10,
              page.evaluate("() => [document.querySelectorAll('.stage-card').length, document.querySelectorAll('.gen-chip').length]"))
        page.screenshot(path=str(OUT / "포켓몬한글-v4-지도.png"))

        # ---------- 3. 따라쓰기 ----------
        page.evaluate("() => { window.__trace.unlockAll(); window.__trace.goto(1); }")
        page.wait_for_timeout(900)
        inf = page.evaluate("() => window.__trace.info()")
        check("1단계 따라쓰기 화면", inf["view"] == "quiz" and inf["guide"] == "strong", {k: inf[k] for k in ("view", "guide", "name")})
        page.screenshot(path=str(OUT / "포켓몬한글-v4-따라쓰기.png"))

        # 획을 긋는 중에는 채점하지 않는다
        box = page.evaluate("() => window.__trace.info().box")
        pts = page.evaluate("() => window.__trace.path()")
        def px(p):
            return (box["x"] + p["x"] * box["w"], box["y"] + p["y"] * box["h"])
        x, y = px(pts[0])
        page.touchscreen.tap(int(x), int(y))          # 터치가 되는지 먼저 확인
        page.wait_for_timeout(300)
        page.evaluate("() => window.__trace.tapClear()")
        page.wait_for_timeout(300)

        page.mouse.move(x, y)
        page.mouse.down()
        for p in pts[: int(len(pts) * 0.98)]:
            x, y = px(p)
            page.mouse.move(x, y)
        page.wait_for_timeout(900)
        mid = page.evaluate("() => window.__trace.info()")
        check("공개 주소: 획을 긋는 중에는 채점하지 않음", mid["locked"] is False and mid["ti"] == 0, mid["ti"])
        page.mouse.up()
        page.wait_for_timeout(1500)
        done = page.evaluate("() => window.__trace.info()")
        check("공개 주소: 다 쓰고 손을 떼면 저절로 정답", done["ti"] == 1 or done["locked"], done["ti"])
        page.wait_for_timeout(700)
        cry = page.evaluate("() => window.__trace.lastCry()")
        check("공개 주소: 포획할 때 울음소리 재생", bool(cry) and cry["status"] == "ok", cry)
        page.screenshot(path=str(OUT / "포켓몬한글-v4-포획-울음소리.png"))
        page.wait_for_timeout(2200)

        # ---------- 4. 도감 ----------
        page.evaluate("() => { document.querySelector('[data-act=\"back\"]').click(); }")
        page.wait_for_timeout(500)
        page.evaluate("() => { document.querySelector('[data-act=\"dex\"]').click(); }")
        page.wait_for_timeout(800)
        dex = page.evaluate("""() => ({
            shown: window.__trace.dexShown(),
            items: document.querySelectorAll('.dex-item').length,
            count: (document.querySelector('.dex-count') || {}).textContent || '',
            chips: document.querySelectorAll('.gen-chip').length
        })""")
        check("공개 주소: 도감 1,025마리 (첫 묶음 60)", dex["shown"]["total"] == 1025 and dex["items"] == 60, dex)
        page.screenshot(path=str(OUT / "포켓몬한글-v4-도감.png"))

        caught = page.evaluate("() => JSON.parse(localStorage.getItem('%s')).caught" % KEY)
        if caught:
            page.evaluate("(id) => window.__trace.dexSearch(String(id))", caught[0])
            page.wait_for_timeout(400)
            page.evaluate("() => { const i = document.querySelector('.dex-item.got'); if (i) i.click(); }")
            page.wait_for_timeout(700)
            page.evaluate("() => { const b = document.querySelector('[data-act=\"detail-cry\"]'); if (b) b.click(); }")
            page.wait_for_timeout(1200)
            dcry = page.evaluate("() => window.__trace.lastCry()")
            check("공개 주소: 도감 상세 울음소리 다시 듣기", bool(dcry) and dcry["status"] == "ok", dcry)
            page.screenshot(path=str(OUT / "포켓몬한글-v4-도감-상세.png"))

        # ---------- 5. 검색 ----------
        page.evaluate("() => { const b = document.querySelector('[data-act=\"close-detail\"]'); if (b) b.click(); }")
        page.wait_for_timeout(300)
        page.evaluate("() => window.__trace.dexSearch('피카츄')")
        page.wait_for_timeout(400)
        found = page.evaluate("() => [...document.querySelectorAll('.dex-item')].map(i => Number(i.dataset.id))")
        check("공개 주소: 이름으로 찾기", found == [25], found)

        # ---------- 6. 세대 고르기 ----------
        page.evaluate("() => { document.querySelector('[data-act=\"back\"]').click(); }")
        page.wait_for_timeout(500)
        page.evaluate("() => { const c = document.querySelector('.gen-chip[data-gen=\"9\"]'); if (c) c.click(); }")
        page.wait_for_timeout(500)
        page.evaluate("() => window.__trace.goto(3)")
        page.wait_for_timeout(600)
        q9 = page.evaluate("() => window.__trace.questions().map(id => window.POKE_DATA.POKEMON[id].gen)")
        check("공개 주소: 고른 세대(9세대)만 문제로 나옴", q9 and set(q9) == {9}, q9)
        page.evaluate("() => window.__trace.setGen(0)")

        page.wait_for_timeout(500)
        check("공개 주소: 자바스크립트 오류 없음", len(errors) == 0, errors[:3])
        ctx.close()
        browser.close()

    fails = [r for r in results if not r[0]]
    print()
    print(f"{len(results) - len(fails)} / {len(results)} 통과")
    for _, name, detail in fails:
        print(" -", name, "|", detail)
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
