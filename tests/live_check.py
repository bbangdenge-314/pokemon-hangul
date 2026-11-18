#!/usr/bin/env python3
"""공개 주소(https://bbangdenge-314.github.io/pokemon-hangul/)에서 실제 동작을 확인하고
화면 캡처를 downloads/ 에 저장합니다.

    python3 tests/live_check.py
"""
import json
import pathlib
import random
import sys

from playwright.sync_api import sync_playwright

LIVE = "https://bbangdenge-314.github.io/pokemon-hangul/"
OUT = pathlib.Path("/workspace/downloads")
KEY = "pokemon-hangul-trace-v3"
random.seed(5)

results = []


def check(name, cond, detail=""):
    results.append((bool(cond), name, detail))
    print(("  PASS  " if cond else "  FAIL  ") + name + (("  — " + str(detail)) if detail else ""))
    return bool(cond)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        ctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, locale="ko-KR")
        page = ctx.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(LIVE + "#debug", wait_until="load")
        page.wait_for_timeout(1500)

        def info():
            return page.evaluate("() => window.__trace.info()")

        def box():
            return page.evaluate("() => window.__trace.info().box")

        def points(frac=1.0, filt=None):
            return page.evaluate(
                """([frac, filt]) => {
                    const p = window.__trace.path();
                    let pts = p.slice(0, Math.max(2, Math.floor(p.length * frac)));
                    if (filt) pts = pts.filter(q =>
                        (filt.maxX === undefined || q.x <= filt.maxX) &&
                        (filt.maxY === undefined || q.y <= filt.maxY));
                    return pts;
                }""", [frac, filt])

        def stroke(pts, jitter=0.0):
            b = box()
            def px(p):
                return (b["x"] + p["x"] * b["w"], b["y"] + p["y"] * b["h"])
            x, y = px(pts[0])
            page.mouse.move(x, y)
            page.mouse.down()
            for p in pts[1:]:
                if jitter:
                    p = {"x": p["x"] + random.uniform(-jitter, jitter),
                         "y": p["y"] + random.uniform(-jitter, jitter)}
                x, y = px(p)
                page.mouse.move(x, y)

        # ---------- 1. 배포본이 v3 인지 ----------
        data = page.evaluate("""() => ({
            count: Object.keys(window.POKE_DATA.POKEMON).length,
            gens: [...new Set(Object.values(window.POKE_DATA.POKEMON).map(p => p.gen))].sort(),
            stages: window.POKE_DATA.STAGES.map(s => ({id: s.id, guide: s.guide, qs: s.questions.length})),
            hasV3: !!window.__trace
        })""")
        check("공개 주소에 v3 데이터가 올라감", data["hasV3"] and data["count"] == 45, data["count"])
        check("1~9세대 모두", data["gens"] == list(range(1, 10)), data["gens"])
        check("6단계 구성", [s["id"] for s in data["stages"]] == [1, 2, 3, 4, 5, 6],
              [(s["id"], s["guide"], s["qs"]) for s in data["stages"]])
        check("5·6단계는 백지", data["stages"][4]["guide"] == "blank" and data["stages"][5]["guide"] == "blank")

        page.evaluate("() => { localStorage.setItem('" + KEY + "', JSON.stringify({unlocked:6, cleared:{1:3,2:2,3:3,4:2}, caught:[25,7,906,921,152,909,183,39,79,84,35,86,1,445,658,722,778,431,494,133,570,572,258,700,702,175,197,252,282,393,888], muted:true})) }")
        page.goto(LIVE + "?live=1#debug", wait_until="load")
        page.wait_for_timeout(1500)

        # 홈
        page.evaluate("() => { const b = document.querySelector('[data-act=\"start\"]'); if (b) b.click(); }")
        page.wait_for_timeout(700)
        page.screenshot(path=str(OUT / "포켓몬한글-v3-지도.png"))

        # ---------- 2. 따라쓰기: 획 긋는 중에는 채점 금지 ----------
        page.evaluate("() => window.__trace.goto(2)")
        page.wait_for_timeout(600)
        pts = points(1.0)
        stroke(pts[:-2])
        page.wait_for_timeout(1200)
        mid = info()
        check("공개 주소: 획 긋는 중에는 채점하지 않음", mid["locked"] is False and mid["ti"] == 0, mid["ti"])
        page.mouse.up()
        page.wait_for_timeout(1300)
        done = info()
        check("공개 주소: 다 쓰고 손을 떼면 저절로 정답 처리", done["ti"] == 1 or done["locked"], done["ti"])
        page.wait_for_timeout(900)

        # ---------- 3. 일부만 쓰기 / 낙서 거부 ----------
        page.evaluate("() => window.__trace.goto(2)")
        page.wait_for_timeout(600)
        # 화면 캡처용: 앞부분만 이어서 쓴 상태 (아직 다 안 씀)
        stroke(points(0.5))
        page.mouse.up()
        page.wait_for_timeout(650)
        page.screenshot(path=str(OUT / "포켓몬한글-v3-따라쓰기.png"))
        page.wait_for_timeout(600)

        # 위쪽만 쓰기 → 거부
        page.evaluate("() => window.__trace.tapClear()")
        page.wait_for_timeout(150)
        stroke(points(1.0, {"maxY": 0.5}))
        page.mouse.up()
        page.wait_for_timeout(1300)
        half = info()
        a = page.evaluate("() => window.__trace.analyze()")
        check("공개 주소: 위쪽만 쓰면 통과 안 함", half["locked"] is False, a["reasons"])
        page.screenshot(path=str(OUT / "포켓몬한글-v3-따라쓰기-확인.png"))
        page.evaluate("() => window.__trace.tapClear()")
        page.wait_for_timeout(200)

        scribble = []
        for r in range(14):
            y = 0.06 + 0.88 * r / 13
            xs = [0.06 + 0.88 * i / 9 for i in range(10)]
            if r % 2:
                xs.reverse()
            scribble += [{"x": x, "y": y} for x in xs]
        stroke(scribble)
        page.mouse.up()
        page.wait_for_timeout(1200)
        scr = info()
        a = page.evaluate("() => window.__trace.analyze()")
        check("공개 주소: 마구 낙서하면 통과 안 함", scr["locked"] is False and "off" in a["reasons"],
              {"off": round(a["offRatio"], 3), "max": a["offMax"]})

        # 정확히 따라 쓰기 → 자동 통과 + 스크린샷용으로 한 글자 완성 상태
        page.evaluate("() => window.__trace.tapClear()")
        page.wait_for_timeout(200)
        stroke(points(1.0), jitter=0.006)
        page.mouse.up()
        page.wait_for_timeout(1200)
        ok = info()
        check("공개 주소: 정확히 쓰면 자동 통과", ok["ti"] == 1 or ok["locked"], ok["ti"])

        # ---------- 4. 5·6단계 백지 ----------
        page.evaluate("() => window.__trace.goto(5)")
        page.wait_for_timeout(700)
        inf5 = info()
        blank_ink = page.evaluate("""() => { const c = document.querySelector('.guide-canvas');
            const d = c.getContext('2d').getImageData(0,0,c.width,c.height).data; let n = 0;
            for (let i = 3; i < d.length; i += 4) if (d[i] > 20) n++; return n; }""")
        check("공개 주소: 5단계 백지 칸", inf5["guide"] == "blank" and blank_ink == 0, {"guide": inf5["guide"], "ink": blank_ink})
        page.click('[data-act="hint"]')
        page.wait_for_timeout(800)
        page.screenshot(path=str(OUT / "포켓몬한글-v3-혼자쓰기.png"))
        hint_ink = page.evaluate("""() => { const c = document.querySelector('.hint-canvas');
            const d = c.getContext('2d').getImageData(0,0,c.width,c.height).data; let n = 0;
            for (let i = 3; i < d.length; i += 4) if (d[i] > 20) n++; return n; }""")
        check("공개 주소: 힌트가 보임", hint_ink > 200 and info()["hints"] == 1, {"ink": hint_ink})

        page.evaluate("() => window.__trace.goto(6)")
        page.wait_for_timeout(700)
        row6 = page.eval_on_selector("#name-row", "el => el.textContent")
        inf6 = info()
        check("공개 주소: 6단계는 이름 전체 가림", inf6["guide"] == "blank" and row6.count("?") == inf6["targets"], row6)

        # ---------- 5. 도감 ----------
        page.evaluate("() => { document.querySelector('.hud-btn[data-act=\"back\"]').click(); }")
        page.wait_for_timeout(500)
        page.click(".dex-btn")
        page.wait_for_timeout(800)
        dex = page.evaluate("""() => ({
            items: document.querySelectorAll('.dex-item').length,
            badges: [...new Set([...document.querySelectorAll('.dex-item .gen-badge')].map(b => b.textContent))].sort(),
            chips: document.querySelectorAll('.gen-chip').length,
            count: document.querySelector('.dex-count').textContent.trim()
        })""")
        check("공개 주소: 도감 45마리", dex["items"] == 45, dex["items"])
        check("공개 주소: 1~9세대 배지", dex["badges"] == [f"{g}세대" for g in range(1, 10)], dex["badges"])
        page.screenshot(path=str(OUT / "포켓몬한글-v3-도감.png"))

        page.goto(LIVE + "?home=1#debug", wait_until="load")
        page.wait_for_timeout(1400)
        page.screenshot(path=str(OUT / "포켓몬한글-v3-홈.png"))

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
