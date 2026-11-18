#!/usr/bin/env python3
"""포켓몬 한글 따라쓰기 v3 - 브라우저 자동 테스트

정적 파일을 로컬 서버로 띄우고 실제 브라우저(Playwright Chromium)에서 검사합니다.

- 인식: 정확한 따라쓰기 통과 / 위쪽만·오른쪽 모음 빼고 쓰기 거부 / 마구 낙서 거부
- 채점 시점: 획을 긋는 중에는 절대 채점하지 않고, 손을 뗀 뒤 잠깐 뒤에 저절로 채점
- '다 썼어요!'는 확인용 (부족하면 안내만, 그림은 그대로, 몇 번 눌러도 통과하지 않음)
- 5·6단계 백지 칸과 힌트
- 도감 1~9세대 45마리와 세대 필터
- 단계 완료 → 보상 흐름

    python3 tests/run_tests.py
"""
import functools
import http.server
import pathlib
import random
import socket
import sys
import threading

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
VIEW = {"width": 390, "height": 844}
KEY = "pokemon-hangul-trace-v3"

results = []


def check(name, cond, detail=""):
    results.append((bool(cond), name, detail))
    print(("  PASS  " if cond else "  FAIL  ") + name + (("  — " + str(detail)) if detail else ""))
    return bool(cond)


def serve():
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    sock.close()
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(ROOT))
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", port), handler)
    httpd.log_message = lambda *a, **k: None
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, port


# ---------------- 페이지 도우미 ----------------
def info(page):
    return page.evaluate("() => window.__trace.info()")


def analyze(page):
    return page.evaluate("() => window.__trace.analyze()")


def box_of(page):
    return page.evaluate("() => window.__trace.info().box")


def trace_points(page, frac=1.0, filt=None):
    return page.evaluate(
        """([frac, filt]) => {
             const p = window.__trace.path();
             let pts = p.slice(0, Math.max(2, Math.floor(p.length * frac)));
             if (filt) pts = pts.filter(q =>
                (filt.maxX === undefined || q.x <= filt.maxX) &&
                (filt.minX === undefined || q.x >= filt.minX) &&
                (filt.maxY === undefined || q.y <= filt.maxY) &&
                (filt.minY === undefined || q.y >= filt.minY));
             return pts;
           }""",
        [frac, filt],
    )


def stroke(page, points, box, jitter=0.0):
    """손가락처럼 누르고 → 움직이고 (뗀다)."""
    def px(p):
        return (box["x"] + p["x"] * box["w"], box["y"] + p["y"] * box["h"])

    x, y = px(points[0])
    page.mouse.move(x, y)
    page.mouse.down()
    for p in points[1:]:
        if jitter:
            p = {"x": p["x"] + random.uniform(-jitter, jitter), "y": p["y"] + random.uniform(-jitter, jitter)}
        x, y = px(p)
        page.mouse.move(x, y)


def trace_whole(page, jitter=0.0):
    b = box_of(page)
    pts = trace_points(page, 1.0)
    stroke(page, pts, b, jitter=jitter)
    page.mouse.up()


def goto_stage(page, sid):
    page.evaluate("(s) => { window.__trace.unlockAll(); window.__trace.goto(s); }", sid)
    page.wait_for_timeout(400)


def dismiss_catch(page):
    page.evaluate("() => { const ov = document.getElementById('catch-overlay'); if (ov) ov.click(); }")
    page.wait_for_timeout(420)


def is_reward(page):
    return bool(page.evaluate("() => !!document.querySelector('.reward-title')"))


def main():
    httpd, port = serve()
    base_url = f"http://127.0.0.1:{port}/index.html"
    base = base_url + "#debug"
    random.seed(11)

    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=["--autoplay-policy=no-user-gesture-required"])
        ctx = browser.new_context(viewport=VIEW, device_scale_factor=2, locale="ko-KR")
        page = ctx.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: errors.append("console:" + m.text) if m.type == "error" else None)
        page.goto(base, wait_until="load")
        page.wait_for_timeout(1000)

        # ---------- 1. 학습 데이터 ----------
        data = page.evaluate("""() => {
            const D = window.POKE_DATA;
            const ids = Object.keys(D.POKEMON).map(Number);
            const gens = [...new Set(ids.map(id => D.POKEMON[id].gen))].sort();
            const stages = D.STAGES.map(s => ({id: s.id, title: s.title, guide: s.guide, qs: s.questions.length,
                ids: s.questions.map(q => q.id),
                bad: s.questions.filter(q => !D.POKEMON[q.id] || q.trace.some(i => i < 0 || i >= D.POKEMON[q.id].name.length))}));
            const names = ids.map(id => D.POKEMON[id].name);
            return {count: ids.length, gens, stages, dupNames: names.filter((n, i) => names.indexOf(n) !== i),
                    rewards: D.REWARDS, bonus: D.BONUS};
        }""")
        check("포켓몬 36마리 이상", data["count"] >= 36, data["count"])
        check("1~9세대 모두 있음", data["gens"] == list(range(1, 10)), data["gens"])
        check("6단계", len(data["stages"]) == 6, [s["id"] for s in data["stages"]])
        check("단계마다 문제 6개 이상", all(s["qs"] >= 6 for s in data["stages"]), [s["qs"] for s in data["stages"]])
        check("문제의 포켓몬/글자 위치 정상", all(len(s["bad"]) == 0 for s in data["stages"]),
              [s["bad"] for s in data["stages"] if s["bad"]])
        check("이름 중복 없음", len(data["dupNames"]) == 0, data["dupNames"])
        guide = {s["id"]: s["guide"] for s in data["stages"]}
        check("1~3단계 진한 가이드, 4 흐림, 5·6 백지",
              [guide[i] for i in (1, 2, 3, 4, 5, 6)] == ["strong", "strong", "strong", "faint", "blank", "blank"], guide)

        all_ids = set(page.evaluate("() => Object.keys(window.POKE_DATA.POKEMON).map(Number)"))
        used = set()
        for s in data["stages"]:
            used.update(s["ids"])
        used.update(data["rewards"].values())
        used.add(data["bonus"])
        check("도감의 모든 포켓몬을 잡을 수 있음", used == all_ids,
              {"unused": sorted(all_ids - used), "missing": sorted(used - all_ids)})

        # ---------- 2. 획을 긋는 중에는 채점하지 않는다 ----------
        goto_stage(page, 1)
        b = box_of(page)
        check("1단계 진한 가이드", info(page)["guide"] == "strong", info(page)["guide"])
        pts = trace_points(page, 1.0)
        stroke(page, pts[: int(len(pts) * 0.99)], b)          # 마우스는 아직 누른 상태
        page.wait_for_timeout(1200)
        mid = info(page)
        check("획을 긋는 중(손을 떼기 전)에는 채점하지 않음", mid["locked"] is False and mid["ti"] == 0, mid)

        page.mouse.up()
        page.wait_for_timeout(120)
        early = info(page)
        check("손을 뗀 직후 바로 채점하지 않음 (잠깐 기다림)", early["locked"] is False, early)

        page.wait_for_timeout(1200)
        done = info(page)
        check("글자를 다 쓰면 손을 뗀 뒤 저절로 정답 처리", done["ti"] == 1 or done["locked"], done)
        check("가이드 없이 '다 썼어요'를 누를 필요 없음", page.evaluate(
            "() => document.querySelectorAll('[data-act=\"done\"]').length") == 1)

        # ---------- 3. 일부만 쓰면 통과하지 않는다 ----------
        goto_stage(page, 2)
        page.wait_for_timeout(300)
        page.click('[data-act="done"]')
        page.wait_for_timeout(300)
        none = info(page)
        msg = page.eval_on_selector("#check-msg", "el => el.textContent")
        check("거의 안 썼는데 버튼을 눌러도 통과 안 함", none["locked"] is False and none["ti"] == 0, none)
        check("안내 문구 표시", len(msg) > 3, msg)

        page.click('[data-act="clear"]')
        page.wait_for_timeout(200)
        b = box_of(page)
        pts = trace_points(page, 1.0, {"maxY": 0.5})
        stroke(page, pts, b)
        page.mouse.up()
        page.wait_for_timeout(1200)
        half = info(page)
        a = analyze(page)
        check("글자 위쪽만 쓰면 통과 안 함", half["locked"] is False, {"cov": round(a["cov"], 3)})
        check("덮음이 모자라 거부", "coverage" in (a["reasons"] or []), {"reasons": a["reasons"], "cov": round(a["cov"], 3), "need": a["need"]})
        check("그림을 지우지 않고 그대로 둠", half["strokes"] >= 1, half["strokes"])

        # '다 썼어요!'를 여러 번 눌러도 통과하지 않는다 (3번 누르면 통과 같은 지름길 없음)
        for _ in range(3):
            page.click('[data-act="done"]')
            page.wait_for_timeout(180)
        again = info(page)
        check("'다 썼어요!'를 반복해 눌러도 통과하지 않음(우회 없음)", again["locked"] is False and again["ti"] == 0, again)
        check("확인 후에도 그림 유지", again["strokes"] >= 1, again["strokes"])

        # 오른쪽 모음을 빼고 쓰기
        page.click('[data-act="clear"]')
        page.wait_for_timeout(200)
        b = box_of(page)
        stroke(page, trace_points(page, 1.0, {"maxX": 0.52}), b)
        page.mouse.up()
        page.wait_for_timeout(1200)
        left = info(page)
        a = analyze(page)
        check("오른쪽 모음을 빼고 쓰면 통과 안 함", left["locked"] is False, {"cov": round(a["cov"], 3)})
        check("구역 검사에서 걸림", "zone" in (a["reasons"] or []), {"reasons": a["reasons"], "zoneMin": round(a["zoneMin"], 3)})

        # 마구 낙서
        page.click('[data-act="clear"]')
        page.wait_for_timeout(200)
        b = box_of(page)
        scribble = []
        rows = 14
        for r in range(rows):
            y = 0.06 + 0.88 * r / (rows - 1)
            xs = [0.06 + 0.88 * i / 9 for i in range(10)]
            if r % 2:
                xs = list(reversed(xs))
            scribble += [{"x": x, "y": y} for x in xs]
        stroke(page, scribble, b)
        page.mouse.up()
        page.wait_for_timeout(1200)
        scr = info(page)
        a = analyze(page)
        check("마구 낙서하면 통과 안 함", scr["locked"] is False, {"cov": round(a["cov"], 3), "off": round(a["offRatio"], 3)})
        check("글자 밖 벗어남으로 거부", "off" in (a["reasons"] or []),
              {"reasons": a["reasons"], "off": round(a["offRatio"], 3), "max": a["offMax"]})

        # 정확한 따라쓰기 (손떨림 조금)
        page.click('[data-act="clear"]')
        page.wait_for_timeout(200)
        b = box_of(page)
        stroke(page, trace_points(page, 1.0), b, jitter=0.007)
        page.mouse.up()
        page.wait_for_timeout(1400)
        ok = info(page)
        check("정확히 따라 쓰면 (조금 흔들려도) 통과", ok["ti"] == 1 or ok["locked"], ok)

        # ---------- 4. 4단계 흐린 가이드 ----------
        goto_stage(page, 4)
        page.wait_for_timeout(300)
        check("4단계는 흐린 가이드", info(page)["guide"] == "faint", info(page)["guide"])
        trace_whole(page)
        page.wait_for_timeout(1500)
        ok4 = info(page)
        check("4단계도 정확히 쓰면 통과", ok4["ti"] == 1 or ok4["locked"], ok4)

        # ---------- 5. 5단계 빈칸 혼자 쓰기 ----------
        goto_stage(page, 5)
        page.wait_for_timeout(400)
        inf5 = info(page)
        check("5단계는 백지", inf5["guide"] == "blank", inf5)
        guide_ink = page.evaluate("""() => {
            const c = document.querySelector('.guide-canvas');
            const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
            let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 20) n++;
            return n;
        }""")
        check("빈칸 칸에 글자 가이드가 없음", guide_ink == 0, guide_ink)
        row = page.eval_on_selector("#name-row", "el => el.textContent")
        check("이름에서 빈칸 글자만 '?'", row.count("?") == 1, row)
        check("힌트 버튼 있음", page.locator('[data-act="hint"]').count() == 1)
        page.click('[data-act="hint"]')
        page.wait_for_timeout(600)
        hint_vis = page.evaluate("""() => { const c = document.querySelector('.hint-canvas');
            const d = c.getContext('2d').getImageData(0,0,c.width,c.height).data; let n = 0;
            for (let i = 3; i < d.length; i += 4) if (d[i] > 20) n++;
            return {n, show: c.classList.contains('show')}; }""")
        check("힌트를 누르면 살짝 보여 줌", hint_vis["n"] > 200 and hint_vis["show"], hint_vis)
        check("힌트 사용 기록(별 점수 반영)", info(page)["hints"] == 1, info(page)["hints"])
        trace_whole(page)
        page.wait_for_timeout(1500)
        ok5 = info(page)
        check("5단계 백지 칸도 정확히 쓰면 통과", ok5["ti"] == 1 or ok5["locked"], ok5)

        # ---------- 6. 6단계 이름 전체 혼자 쓰기 ----------
        goto_stage(page, 6)
        page.wait_for_timeout(400)
        inf6 = info(page)
        check("6단계는 백지", inf6["guide"] == "blank", inf6)
        row6 = page.eval_on_selector("#name-row", "el => el.textContent")
        check("6단계는 이름 전체가 가려짐", row6.count("?") == inf6["targets"], row6)
        trace_whole(page)
        page.wait_for_timeout(1700)
        step = info(page)
        check("첫 글자를 쓰면 둘째 글자로 넘어감", step["ti"] == 1 and step["locked"] is False, step)
        row6b = page.eval_on_selector("#name-row", "el => el.textContent")
        check("첫 글자는 완성되어 보임", row6b.count("?") == inf6["targets"] - 1, row6b)

        # ---------- 7. 도감 ----------
        page.goto(base_url + "?reload=1#debug", wait_until="load")
        page.wait_for_timeout(1000)
        page.click('[data-act="start"]')
        page.wait_for_timeout(300)
        page.click('.dex-btn')
        page.wait_for_timeout(500)
        dex = page.evaluate("""() => {
            const items = [...document.querySelectorAll('.dex-item')];
            const chips = [...document.querySelectorAll('.gen-chip')].map(c => c.textContent);
            const badges = items.map(i => i.querySelector('.gen-badge')?.textContent || '');
            return {items: items.length, chips, badges: [...new Set(badges)].sort()};
        }""")
        check("도감에 모든 포켓몬 표시", dex["items"] == data["count"], dex["items"])
        check("도감에 1~9세대 배지", dex["badges"] == [f"{g}세대" for g in range(1, 10)], dex["badges"])
        check("도감 세대 필터 10개(전체+9)", len(dex["chips"]) == 10, dex["chips"])
        page.click('[data-act="dex-filter"][data-gen="9"]')
        page.wait_for_timeout(300)
        only9 = page.evaluate("() => [...document.querySelectorAll('.dex-item .gen-badge')].map(b => b.textContent)")
        check("9세대 필터가 9세대만 보여 줌", bool(only9) and set(only9) == {"9세대"}, only9)

        # ---------- 8. 단계 완료 → 보상 ----------
        # 처음 시작하는 상태로 되돌린다
        page.evaluate("() => localStorage.removeItem('pokemon-hangul-trace-v3')")
        page.goto(base_url + "?fresh=1#debug", wait_until="load")
        page.wait_for_timeout(1000)
        page.click('[data-act="start"]')
        page.wait_for_timeout(300)
        check("새 상태에서는 2단계가 잠겨 있음",
              page.evaluate("() => document.querySelector('.stage-card[data-id=\"2\"]').getAttribute('data-locked')") == "1")
        page.click('.stage-card[data-id="1"]')
        page.wait_for_timeout(500)
        guard = 0
        while guard < 12:
            inf = info(page)
            if not inf or inf["view"] != "quiz":
                break
            trace_whole(page)
            page.wait_for_timeout(1400)
            dismiss_catch(page)
            guard += 1
            if is_reward(page):
                break
        page.wait_for_timeout(600)
        reward = page.evaluate("""() => ({
            title: document.querySelector('.reward-title')?.textContent || '',
            stars: document.querySelectorAll('.reward-stars .star.on').length,
            next: document.querySelector('[data-act="next-stage"]')?.getAttribute('data-id') || null,
            poke: document.querySelector('.reward-poke img')?.getAttribute('data-id') || null
        })""")
        check("단계를 다 깨면 보상 화면", bool(reward["title"]), reward)
        check("보상 포켓몬 = 토게피(175)", reward["poke"] == "175", reward["poke"])
        check("별 3개", reward["stars"] == 3, reward["stars"])
        check("다음 단계 도전 버튼", reward["next"] == "2", reward["next"])
        saved = page.evaluate(f"() => JSON.parse(localStorage.getItem('{KEY}'))")
        check("1단계를 깨면 2단계 잠금 해제", saved["unlocked"] == 2, saved["unlocked"])
        check("잡은 포켓몬이 저장됨", len(saved["caught"]) >= 6, len(saved["caught"]))

        # ---------- 9. 한 파일(standalone) 버전 ----------
        page.goto(f"http://127.0.0.1:{port}/standalone.html#debug", wait_until="load")
        page.wait_for_timeout(800)
        page.evaluate("() => { window.__trace.unlockAll(); window.__trace.goto(1); }")
        page.wait_for_timeout(500)
        trace_whole(page)
        page.wait_for_timeout(1500)
        stand = info(page)
        check("standalone.html도 동작", stand is not None and (stand["ti"] == 1 or stand["locked"]), stand)

        # ---------- 10. 화면 크기별 레이아웃 ----------
        for w, h in [(360, 640), (390, 844), (430, 932), (768, 1024)]:
            pg = ctx.new_page()
            pg.set_viewport_size({"width": w, "height": h})
            pg.goto(base_url + f"?size={w}x{h}#debug", wait_until="load")
            pg.wait_for_timeout(700)
            pg.evaluate("() => { window.__trace.unlockAll(); window.__trace.goto(6); }")
            pg.wait_for_timeout(500)
            lay = pg.evaluate("""() => {
                const box = document.getElementById('box-wrap').getBoundingClientRect();
                const done = document.querySelector('[data-act="done"]').getBoundingClientRect();
                const hint = document.querySelector('[data-act="hint"]')?.getBoundingClientRect();
                return {box: {w: Math.round(box.width), bottom: Math.round(box.bottom)},
                        docW: document.documentElement.scrollWidth, winW: window.innerWidth,
                        doneVisible: done.top >= 0 && done.bottom <= window.innerHeight + 1,
                        hintVisible: !hint || (hint.top >= 0 && hint.bottom <= window.innerHeight + 1)};
            }""")
            check(f"{w}x{h}: 칸·버튼이 화면 안에 들어옴",
                  lay["box"]["w"] >= 160 and lay["doneVisible"] and lay["hintVisible"] and lay["docW"] <= lay["winW"] + 1,
                  lay)
            pg.close()

        check("자바스크립트 오류 없음", len(errors) == 0, errors[:3])

        ctx.close()
        browser.close()

    httpd.shutdown()

    fails = [r for r in results if not r[0]]
    print()
    print(f"{len(results) - len(fails)} / {len(results)} 통과")
    if fails:
        print("실패:")
        for _, name, detail in fails:
            print(" -", name, "|", detail)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
