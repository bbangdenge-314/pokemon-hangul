#!/usr/bin/env python3
"""포켓몬 한글 따라쓰기 v4 - 브라우저 자동 테스트

정적 파일을 로컬 서버로 띄우고 실제 브라우저(Playwright Chromium)에서 검사합니다.

- 데이터: 전국도감 1~1025, 1~9세대, 한국어 이름·타입, 단계별 문제 은행
- 인식: 정확한 따라쓰기 통과 / 위쪽만·오른쪽 모음 빼고 쓰기 거부 / 마구 낙서 거부
- 채점 시점: 획을 긋는 중에는 절대 채점하지 않고, 손을 뗀 뒤 잠깐 뒤에 저절로 채점
- 5·6단계 백지 칸과 힌트
- 울음소리: .ogg 주소 로딩·재생, 실패 시 한국어 목소리 대신
- 도감: 1025마리, 세대 필터, 검색, 더 보기, 상세·울음소리
- 단계 완료 → 보상, 세대 고르기, 화면 크기별 레이아웃

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
KEY = "pokemon-hangul-v4"
GEN_COUNTS = {1: 151, 2: 100, 3: 135, 4: 107, 5: 156, 6: 72, 7: 88, 8: 96, 9: 120}

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
    page.wait_for_timeout(450)


def dismiss_catch(page):
    page.evaluate("() => { const ov = document.getElementById('catch-overlay'); if (ov) ov.click(); }")
    page.wait_for_timeout(500)


def is_reward(page):
    return bool(page.evaluate("() => !!document.querySelector('.reward-title')"))


def open_map(page, force=False):
    if force or not page.evaluate("() => !!document.querySelector('.stage-card')"):
        page.evaluate("() => { const b = document.querySelector('[data-act=\"map\"]'); if (b) b.click(); }")
        page.wait_for_timeout(400)


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
            const ids = D.POKE_IDS.slice();
            const gens = {};
            ids.forEach(id => { const g = D.POKEMON[id].gen; gens[g] = (gens[g] || 0) + 1; });
            const names = ids.map(id => D.POKEMON[id].name);
            const noType = ids.filter(id => !D.POKEMON[id].types.length || !D.POKEMON[id].types[0]);
            const pools = {};
            for (let s = 1; s <= 6; s++) { pools[s] = D.stagePool(s, 0).length; }
            const perGen = {};
            for (let s = 1; s <= 6; s++) {
              perGen[s] = [];
              for (let g = 1; g <= 9; g++) perGen[s].push(D.stagePool(s, g).length);
            }
            const used = new Set();
            for (let s = 1; s <= 6; s++) D.stagePool(s, 0).forEach(id => used.add(id));
            return {
              count: ids.length,
              first: ids[0], last: ids[ids.length - 1],
              gens, pools, perGen,
              stages: D.STAGES.map(s => ({id: s.id, guide: s.guide, count: s.count, title: s.title})),
              dupNames: names.filter((n, i) => names.indexOf(n) !== i),
              emptyNames: names.filter(n => !n).length,
              noType, usedCount: used.size,
              genCount: D.GEN_COUNT
            };
        }""")
        check("전국도감 1~1025 (1,025마리)", data["count"] == 1025 and data["first"] == 1 and data["last"] == 1025, data["count"])
        check("1~9세대 모두 · 세대별 마리 수", {int(k): v for k, v in data["gens"].items()} == GEN_COUNTS, data["gens"])
        check("모든 포켓몬에 한국어 이름", data["emptyNames"] == 0, data["emptyNames"])
        check("이름 중복 없음", len(data["dupNames"]) == 0, data["dupNames"][:5])
        check("모든 포켓몬에 타입", len(data["noType"]) == 0, data["noType"][:5])
        check("6단계 구성", [s["id"] for s in data["stages"]] == [1, 2, 3, 4, 5, 6], data["stages"])
        check("1~3단계 진한 가이드, 4 흐림, 5·6 백지",
              [s["guide"] for s in data["stages"]] == ["strong", "strong", "strong", "faint", "blank", "blank"],
              [s["guide"] for s in data["stages"]])
        check("단계마다 문제 4개 이상", all(s["count"] >= 4 for s in data["stages"]), [s["count"] for s in data["stages"]])
        check("1,025마리 모두 어느 단계에서는 나올 수 있음", data["usedCount"] == 1025, data["usedCount"])
        check("모든 단계 × 세대 조합에 나올 포켓몬이 있음",
              all(min(x) > 0 for x in data["perGen"].values()), data["perGen"])
        pools = {int(k): v for k, v in data["pools"].items()}
        pool_reasonable = pools[1] >= 1000 and pools[2] >= 50 and pools[6] >= 300
        check("단계별 문제 은행 크기 (첫 글자·짧은 이름·혼자 쓰기)", pool_reasonable, data["pools"])

        # 문제 뽑기: 6개, 서로 다른 포켓몬, 글자 위치가 이름 안에 있음
        qdata = page.evaluate("""() => {
            window.__trace.unlockAll();
            window.__trace.setGen(0);
            window.__trace.goto(1);
            const s1 = window.__trace.questions();
            window.__trace.goto(6);
            const s6 = window.__trace.questions();
            const bad = s1.concat(s6).filter(id => !window.POKE_DATA.POKEMON[id]);
            return {s1, s6, bad};
        }""")
        check("1단계 문제 6개·중복 없음", len(qdata["s1"]) == 6 and len(set(qdata["s1"])) == 6, qdata["s1"])
        check("6단계 문제 4개·중복 없음", len(qdata["s6"]) == 4 and len(set(qdata["s6"])) == 4, qdata["s6"])
        check("문제의 포켓몬이 모두 도감에 있음", len(qdata["bad"]) == 0, qdata["bad"])

        # ---------- 2. 울음소리 파일 ----------
        audio = page.evaluate("""async () => {
            const AC = new (window.AudioContext || window.webkitAudioContext)();
            const ids = [1, 25, 151, 482, 906, 1025];
            const out = {};
            for (const id of ids) {
              const url = window.POKE_DATA.cryUrl(id);
              try {
                const res = await fetch(url);
                const buf = await res.arrayBuffer();
                const dec = await AC.decodeAudioData(buf.slice(0));
                out[id] = {status: res.status, bytes: buf.byteLength, dur: Number(dec.duration.toFixed(2))};
              } catch (e) { out[id] = {error: String(e)}; }
            }
            return out;
        }""")
        ok_audio = all(audio[str(i)].get("status") == 200 and audio[str(i)].get("dur", 0) > 0.1 for i in [1, 25, 151, 482, 906, 1025])
        check("울음소리 .ogg 6개 로딩·디코딩 성공", ok_audio, audio)

        alt = page.evaluate("""async () => {
            const res = await fetch(window.POKE_DATA.cryAltUrl(25), {method: 'GET'});
            return {status: res.status, type: res.headers.get('content-type')};
        }""")
        check("울음소리 대체 주소(jsDelivr)도 200", alt["status"] == 200, alt)

        imgs = page.evaluate("""async () => {
            const load = (src) => new Promise(r => { const i = new Image(); i.onload = () => r({ok: i.naturalWidth > 0}); i.onerror = () => r({ok: false}); i.src = src; });
            const out = {};
            for (const id of [1, 25, 151, 1025]) {
              out['art' + id] = await load(window.POKE_DATA.artworkUrl(id));
              out['spr' + id] = await load(window.POKE_DATA.spriteUrl(id));
            }
            return out;
        }""")
        check("공식 아트워크·스프라이트 주소 정상", all(v.get("ok") for v in imgs.values()), imgs)

        # ---------- 3. 획을 긋는 중에는 채점하지 않는다 ----------
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
        check("손을 뗀 직후 바로 채점하지 않음 (잠깐 기다림)", early["locked"] is False, early["locked"])

        page.wait_for_timeout(1400)
        done = info(page)
        check("글자를 다 쓰면 손을 뗀 뒤 저절로 정답 처리", done["ti"] == 1 or done["locked"], done["ti"])
        check("포켓몬을 잡으면 포획 연출", page.evaluate("() => !!document.querySelector('#catch-overlay')"),
              page.evaluate("() => document.querySelector('#catch-overlay') !== null"))

        # ---------- 4. 울음소리 재생 (포획 성공) ----------
        page.wait_for_timeout(900)
        cry = page.evaluate("() => window.__trace.lastCry()")
        caught_id = done.get("pokemon")
        check("포획할 때 울음소리 재생", cry and cry["status"] == "ok" and cry["id"] == caught_id, cry)
        check("울음소리 주소가 포켓몬 번호와 일치",
              cry and cry["url"].endswith("/latest/%d.ogg" % caught_id), cry and cry["url"])
        dismiss_catch(page)

        # ---------- 5. 4단계 흐린 가이드 ----------
        goto_stage(page, 4)
        check("4단계는 흐린 가이드", info(page)["guide"] == "faint", info(page)["guide"])
        trace_whole(page)
        page.wait_for_timeout(1600)
        ok4 = info(page)
        check("4단계도 정확히 쓰면 통과", ok4["ti"] == 1 or ok4["locked"], ok4)
        dismiss_catch(page)

        # ---------- 6. 일부만 쓰면 통과하지 않는다 ----------
        goto_stage(page, 3)
        page.wait_for_timeout(300)
        q0 = info(page)
        page.click('[data-act="done"]')
        page.wait_for_timeout(300)
        none = info(page)
        msg = page.eval_on_selector("#check-msg", "el => el.textContent")
        check("거의 안 썼는데 버튼을 눌러도 통과 안 함", none["locked"] is False and none["ti"] == 0, none)
        check("안내 문구 표시", len(msg) > 3, msg)

        page.click('[data-act="clear"]')
        page.wait_for_timeout(200)
        b = box_of(page)
        stroke(page, trace_points(page, 1.0, {"maxY": 0.5}), b)
        page.mouse.up()
        page.wait_for_timeout(1300)
        half = info(page)
        a = analyze(page)
        check("글자 위쪽만 쓰면 통과 안 함", half["locked"] is False, {"cov": round(a["cov"], 3)})
        check("덮음이 모자라 거부", "coverage" in (a["reasons"] or []), {"reasons": a["reasons"], "cov": round(a["cov"], 3)})
        check("그림을 지우지 않고 그대로 둠", half["strokes"] >= 1, half["strokes"])

        # '다 썼어요!'를 여러 번 눌러도 통과하지 않는다
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
        page.wait_for_timeout(1300)
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
        page.wait_for_timeout(1300)
        scr = info(page)
        a = analyze(page)
        check("마구 낙서하면 통과 안 함", scr["locked"] is False, {"cov": round(a["cov"], 3)})
        check("글자 밖 벗어남으로 거부", "off" in (a["reasons"] or []),
              {"reasons": a["reasons"], "off": round(a["offRatio"], 3), "max": a["offMax"]})

        # 정확한 따라쓰기 (손떨림 조금)
        page.click('[data-act="clear"]')
        page.wait_for_timeout(200)
        b = box_of(page)
        stroke(page, trace_points(page, 1.0), b, jitter=0.007)
        page.mouse.up()
        page.wait_for_timeout(1500)
        ok = info(page)
        check("정확히 따라 쓰면 (조금 흔들려도) 통과", ok["ti"] == 1 or ok["locked"], ok)
        dismiss_catch(page)

        # ---------- 7. 5단계 빈칸 혼자 쓰기 ----------
        goto_stage(page, 5)
        page.wait_for_timeout(400)
        inf5 = info(page)
        check("5단계는 백지", inf5["guide"] == "blank", inf5["guide"])
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
        page.wait_for_timeout(1700)
        ok5 = info(page)
        check("5단계 백지 칸도 정확히 쓰면 통과", ok5["ti"] == 1 or ok5["locked"], ok5)
        dismiss_catch(page)

        # ---------- 8. 6단계 이름 전체 혼자 쓰기 ----------
        goto_stage(page, 6)
        page.wait_for_timeout(400)
        inf6 = info(page)
        check("6단계는 백지", inf6["guide"] == "blank", inf6["guide"])
        row6 = page.eval_on_selector("#name-row", "el => el.textContent")
        check("6단계는 이름 전체가 가려짐", row6.count("?") == inf6["targets"], row6)
        trace_whole(page)
        page.wait_for_timeout(1800)
        step = info(page)
        check("첫 글자를 쓰면 둘째 글자로 넘어감", step["ti"] == 1 and step["locked"] is False, step)
        row6b = page.eval_on_selector("#name-row", "el => el.textContent")
        check("첫 글자는 완성되어 보임", row6b.count("?") == inf6["targets"] - 1, row6b)

        # ---------- 9. 소리 끄기 ----------
        page.evaluate("() => { const b = document.querySelector('.hud-btn[data-act=\"sound\"]'); if (b) b.click(); }")
        page.wait_for_timeout(250)
        muted = page.evaluate("() => JSON.parse(localStorage.getItem('%s')).muted" % KEY)
        check("HUD에서 소리 끄기 저장", muted is True, muted)
        page.evaluate("() => { const b = document.querySelector('.hud-btn[data-act=\"sound\"]'); if (b) b.click(); }")
        page.wait_for_timeout(250)

        # ---------- 10. 울음소리가 안 되면 한국어 목소리로 대신 ----------
        page.evaluate("() => window.__trace.cryFail(true)")
        goto_stage(page, 1)
        page.wait_for_timeout(400)
        trace_whole(page)
        page.wait_for_timeout(1600)
        fallback = page.evaluate("() => ({cry: window.__trace.lastCry(), speech: window.__trace.lastSpeech()})")
        nm = info(page).get("name") or ""
        check("울음소리 실패 시 상태 fail", fallback["cry"] and fallback["cry"]["status"] == "fail", fallback["cry"])
        check("울음소리 실패 시 '이름! 잡았다!' 목소리",
              bool(fallback["speech"]) and "잡았다" in fallback["speech"], fallback["speech"])
        page.evaluate("() => window.__trace.cryFail(false)")
        dismiss_catch(page)

        # ---------- 11. 세대 고르기 ----------
        page.evaluate("() => { const b = document.querySelector('[data-act=\"back\"]'); if (b) b.click(); }")
        page.wait_for_timeout(500)
        open_map(page)
        page.evaluate("() => { const c = document.querySelector('.gen-chip[data-gen=\"3\"]'); if (c) c.click(); }")
        page.wait_for_timeout(500)
        gen3 = page.evaluate("""() => {
            const cards = [...document.querySelectorAll('.stage-card')];
            return {pools: cards.map(c => (c.querySelector('.sc-pool') || {}).textContent || ''), on: !!document.querySelector('.gen-chip.on[data-gen="3"]')};
        }""")
        check("지도에서 3세대를 고르면 카드에 3세대 마리 수", gen3["on"] and "135" in gen3["pools"][0], gen3["pools"][:2])
        page.evaluate("() => { window.__trace.goto(3); }")
        page.wait_for_timeout(500)
        q3 = page.evaluate("() => window.__trace.questions().map(id => window.POKE_DATA.POKEMON[id].gen)")
        check("고른 세대 포켓몬만 문제로 나옴", q3 and set(q3) == {3}, q3)
        page.evaluate("() => window.__trace.setGen(0)")

        # ---------- 12. 도감 ----------
        page.evaluate("() => { const b = document.querySelector('[data-act=\"back\"]'); if (b) b.click(); }")
        page.wait_for_timeout(500)
        open_map(page)
        page.evaluate("() => { const b = document.querySelector('[data-act=\"dex\"]'); if (b) b.click(); }")
        page.wait_for_timeout(700)
        dex = page.evaluate("""() => ({
            items: document.querySelectorAll('.dex-item').length,
            shown: window.__trace.dexShown(),
            count: document.querySelector('.dex-count').textContent.trim(),
            chips: document.querySelectorAll('.gen-chip').length,
            search: !!document.getElementById('dex-search')
        })""")
        check("도감에 1,025마리 (첫 묶음 60마리)", dex["shown"]["total"] == 1025 and dex["items"] == 60, dex["shown"])
        check("도감 진행률 표시", dex["count"].replace(" ", "").endswith("/1025마리"), dex["count"])
        check("도감 세대 필터 10개(전체+9) · 검색창 있음", dex["chips"] == 10 and dex["search"], dex["chips"])
        page.evaluate("() => { document.getElementById('dex-more').click(); }")
        page.wait_for_timeout(400)
        check("'더 보기'로 다음 묶음", page.evaluate("() => document.querySelectorAll('.dex-item').length") == 120,
              page.evaluate("() => document.querySelectorAll('.dex-item').length"))
        page.evaluate("() => { document.querySelector('.gen-chip[data-gen=\"9\"]').click(); }")
        page.wait_for_timeout(500)
        d9 = page.evaluate("""() => ({
            total: window.__trace.dexShown().total,
            gens: [...new Set([...document.querySelectorAll('.dex-item')].map(i => window.POKE_DATA.POKEMON[Number(i.dataset.id)].gen))]
        })""")
        check("9세대 필터 = 120마리", d9["total"] == 120 and d9["gens"] == [9], d9)
        page.evaluate("() => window.__trace.dexSearch('피카츄')")
        page.wait_for_timeout(400)
        search1 = page.evaluate("""() => [...document.querySelectorAll('.dex-item')].map(i => Number(i.dataset.id))""")
        check("이름으로 찾기 (피카츄)", search1 == [25], search1)
        page.evaluate("() => window.__trace.dexSearch('25')")
        page.wait_for_timeout(400)
        search2 = page.evaluate("""() => [...document.querySelectorAll('.dex-item')].map(i => Number(i.dataset.id))""")
        check("번호로 찾기 (25)", search2 == [25], search2)
        page.evaluate("() => window.__trace.dexSearch('')")
        page.wait_for_timeout(300)
        page.evaluate("() => { document.querySelector('.gen-chip[data-gen=\"0\"]').click(); }")
        page.wait_for_timeout(500)

        # 잡은 포켓몬 상세 + 울음소리
        caught_id = page.evaluate("() => JSON.parse(localStorage.getItem('%s')).caught[0]" % KEY)
        page.evaluate("(id) => window.__trace.dexSearch(String(id))", caught_id)
        page.wait_for_timeout(400)
        page.evaluate("() => { const first = document.querySelector('.dex-item.got'); if (first) first.click(); }")
        page.wait_for_timeout(600)
        detail = page.evaluate("""() => ({
            open: !!document.getElementById('dex-detail'),
            cry: !!document.querySelector('[data-act="detail-cry"]'),
            name: (document.querySelector('.detail-name') || {}).textContent || '',
            types: document.querySelectorAll('.detail-card .type-chip').length,
            gen: !!document.querySelector('.detail-card .gen-badge')
        })""")
        check("잡은 포켓몬 상세: 이름·타입·세대·울음소리 버튼", detail["open"] and detail["cry"] and detail["name"] and detail["types"] >= 1 and detail["gen"], detail)
        page.evaluate("() => { const b = document.querySelector('[data-act=\"detail-cry\"]'); if (b) b.click(); }")
        page.wait_for_timeout(1200)
        dcr = page.evaluate("() => window.__trace.lastCry()")
        check("도감 상세에서 울음소리 다시 듣기", dcr and dcr["status"] == "ok", dcr)
        page.evaluate("() => { const b = document.querySelector('[data-act=\"close-detail\"]'); if (b) b.click(); }")
        page.wait_for_timeout(300)

        # 못 잡은 포켓몬은 잠김 안내
        page.evaluate("() => window.__trace.dexSearch('1025')")
        page.wait_for_timeout(400)
        page.evaluate("() => { const miss = document.querySelector('.dex-item:not(.got)'); if (miss) miss.click(); }")
        page.wait_for_timeout(400)
        lock = page.evaluate("() => !!document.querySelector('.detail-lock')")
        check("못 잡은 포켓몬은 잠김 안내", lock is True, lock)
        page.evaluate("() => { const b = document.querySelector('[data-act=\"close-detail\"]'); if (b) b.click(); }")
        page.wait_for_timeout(300)

        # ---------- 13. 단계 완료 → 보상 ----------
        page.evaluate("() => { window.__trace.clearStorage(); }")
        page.goto(base_url + "?fresh=1#debug", wait_until="load")
        page.wait_for_timeout(900)
        page.evaluate("() => { const b = document.querySelector('[data-act=\"start\"]'); if (b) b.click(); }")
        page.wait_for_timeout(400)
        check("새 상태에서는 2단계가 잠겨 있음",
              page.evaluate("() => document.querySelector('.stage-card[data-id=\"2\"]').getAttribute('data-locked')") == "1")
        page.evaluate("() => document.querySelector('.stage-card[data-id=\"1\"]').click()")
        page.wait_for_timeout(500)
        first_q = info(page)
        guard = 0
        while guard < 14:
            inf = info(page)
            if not inf or inf["view"] != "quiz":
                break
            if inf["locked"]:
                dismiss_catch(page)
            else:
                trace_whole(page)
                page.wait_for_timeout(1500)
                if page.evaluate("() => !!document.querySelector('#catch-overlay')"):
                    dismiss_catch(page)
            guard += 1
            if is_reward(page):
                break
        page.wait_for_timeout(700)
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
        saved = page.evaluate("() => JSON.parse(localStorage.getItem('%s'))" % KEY)
        check("1단계를 깨면 2단계 잠금 해제", saved["unlocked"] == 2, saved["unlocked"])
        check("잡은 포켓몬이 저장됨 (6마리 + 보상)", len(saved["caught"]) == 7, len(saved["caught"]))
        check("잡은 포켓몬이 모두 도감에 있는 번호", all(1 <= int(i) <= 1025 for i in saved["caught"]), saved["caught"])
        rcry = page.evaluate("() => window.__trace.lastCry()")
        check("보상 포켓몬도 울음소리", rcry and rcry["id"] == 175, rcry)

        # ---------- 14. 한 파일(standalone) 버전 ----------
        page.goto(f"http://127.0.0.1:{port}/standalone.html#debug", wait_until="load")
        page.wait_for_timeout(900)
        stand = page.evaluate("""() => ({
            count: window.POKE_DATA.COUNT,
            trace: !!window.__trace,
            home: !!document.querySelector('.home-title')
        })""")
        page.evaluate("() => { window.__trace.unlockAll(); window.__trace.goto(1); }")
        page.wait_for_timeout(500)
        trace_whole(page)
        page.wait_for_timeout(1600)
        sinfo = info(page)
        check("standalone.html도 1,025마리로 동작", stand["count"] == 1025 and stand["home"] and (sinfo["ti"] == 1 or sinfo["locked"]), stand)
        scry = page.evaluate("() => window.__trace.lastCry()")
        check("standalone에서도 울음소리", scry and scry["status"] == "ok", scry)

        # ---------- 15. 화면 크기별 레이아웃 ----------
        for w, h in [(360, 640), (390, 844), (430, 932), (768, 1024)]:
            pg = ctx.new_page()
            pg.set_viewport_size({"width": w, "height": h})
            pg.goto(base_url + f"?size={w}x{h}#debug", wait_until="load")
            pg.wait_for_timeout(700)
            pg.evaluate("() => { window.__trace.unlockAll(); window.__trace.previewQuestion(695, 1); }")
            pg.wait_for_timeout(500)
            lay = pg.evaluate("""() => {
                const box = document.getElementById('box-wrap').getBoundingClientRect();
                const done = document.querySelector('[data-act="done"]').getBoundingClientRect();
                const hint = document.querySelector('[data-act="hint"]')?.getBoundingClientRect();
                const row = document.getElementById('name-row').getBoundingClientRect();
                const kids = [...document.getElementById('name-row').children].map(c => c.getBoundingClientRect().right);
                return {box: {w: Math.round(box.width), bottom: Math.round(box.bottom)},
                        docW: document.documentElement.scrollWidth, winW: window.innerWidth,
                        doneVisible: done.top >= 0 && done.bottom <= window.innerHeight + 1,
                        hintVisible: !hint || (hint.top >= 0 && hint.bottom <= window.innerHeight + 1),
                        rowFits: Math.max(...kids) <= row.right + 1};
            }""")
            check(f"{w}x{h}: 칸·버튼·긴 이름이 화면 안에 들어옴",
                  lay["box"]["w"] >= 150 and lay["doneVisible"] and lay["hintVisible"] and lay["docW"] <= lay["winW"] + 1 and lay["rowFits"],
                  lay)
            pg.close()

        check("자바스크립트 오류 없음 (콘솔 포함)", len(errors) == 0, errors[:3])

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
