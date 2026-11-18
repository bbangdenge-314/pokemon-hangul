#!/usr/bin/env python3
"""포켓몬 전국도감 데이터(1~1025)를 만들어 pokemon-data.js 로 저장합니다.

자료: PokeAPI 데이터 파일(CSV)
  - pokemon_species.csv        번호 · 세대
  - pokemon_species_names.csv  한국어 이름 (local_language_id = 3)
  - pokemon.csv                종족마다 기본 모습(is_default)의 포켓몬 번호
  - pokemon_types.csv          타입 (slot 1, 2)
  - types.csv                  타입 이름

처음 실행할 때 CSV를 내려받아 build/csv/ 에 저장하고, 그다음부터는 그 파일을 씁니다.
결과: pokemon-data.js — window.POKEMON_DATA.LIST[번호-1] = [이름, 세대, 타입1, 타입2]

    python3 build/build_data.py
"""
import csv
import json
import pathlib
import sys
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
CSV_DIR = ROOT / "build" / "csv"
BASE = "https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv/"
FILES = ["pokemon_species.csv", "pokemon_species_names.csv", "pokemon.csv", "pokemon_types.csv", "types.csv"]
COUNT = 1025
KO_LANG_ID = "3"

TYPE_KO = {
    "normal": "노말", "fire": "불꽃", "water": "물", "electric": "전기", "grass": "풀",
    "ice": "얼음", "fighting": "격투", "poison": "독", "ground": "땅", "flying": "비행",
    "psychic": "에스퍼", "bug": "벌레", "rock": "바위", "ghost": "고스트", "dragon": "드래곤",
    "dark": "악", "steel": "강철", "fairy": "페어리",
}


def download(name: str) -> pathlib.Path:
    CSV_DIR.mkdir(parents=True, exist_ok=True)
    dest = CSV_DIR / name
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    print("내려받기:", name)
    with urllib.request.urlopen(BASE + name, timeout=120) as r:
        data = r.read()
    dest.write_bytes(data)
    return dest


def rows(name: str):
    path = download(name)
    with path.open(encoding="utf-8", newline="") as f:
        yield from csv.DictReader(f)


def main() -> int:
    species = {}
    for r in rows("pokemon_species.csv"):
        species[int(r["id"])] = int(r["generation_id"])

    names = {}
    for r in rows("pokemon_species_names.csv"):
        if r["local_language_id"] == KO_LANG_ID:
            names[int(r["pokemon_species_id"])] = r["name"].strip()

    default_pokemon = {}
    for r in rows("pokemon.csv"):
        if r["is_default"] == "1":
            default_pokemon[int(r["species_id"])] = int(r["id"])

    type_names = {int(r["id"]): TYPE_KO.get(r["identifier"], r["identifier"]) for r in rows("types.csv")}

    types = {}
    for r in rows("pokemon_types.csv"):
        types.setdefault(int(r["pokemon_id"]), []).append((int(r["slot"]), int(r["type_id"])))

    out = []
    problems = []
    for pid in range(1, COUNT + 1):
        if pid not in species:
            problems.append(f"#{pid} 종족 없음")
            continue
        name = names.get(pid)
        if not name:
            problems.append(f"#{pid} 한국어 이름 없음")
            name = ""
        pk = default_pokemon.get(pid)
        tl = sorted(types.get(pk, [])) if pk else []
        t1 = type_names.get(tl[0][1], "") if len(tl) > 0 else ""
        t2 = type_names.get(tl[1][1], "") if len(tl) > 1 else ""
        if not t1:
            problems.append(f"#{pid} 타입 없음")
        out.append([name, species[pid], t1, t2])

    if problems:
        print("문제:", problems[:20], "…" if len(problems) > 20 else "", file=sys.stderr)
        return 1

    lens = {}
    for name, _, _, _ in out:
        lens[len(name)] = lens.get(len(name), 0) + 1
    gens = {}
    for _, gen, _, _ in out:
        gens[gen] = gens.get(gen, 0) + 1

    body = ",\n".join(
        '  ' + json.dumps(row, ensure_ascii=False) for row in out
    )
    js = (
        "/* 포켓몬 전국도감 1~1025 — build/build_data.py 가 PokeAPI 자료로 만든 파일입니다. 직접 고치지 마세요.\n"
        "   LIST[번호-1] = [한국어 이름, 세대, 타입1, 타입2]  (타입2는 없으면 \"\") */\n"
        "window.POKEMON_DATA = {\n"
        f"  COUNT: {COUNT},\n"
        "  LIST: [\n" + body + "\n  ]\n"
        "};\n"
    )
    (ROOT / "pokemon-data.js").write_text(js, encoding="utf-8")
    print(f"pokemon-data.js: {COUNT}마리, {len(js):,} bytes")
    print("  세대별:", dict(sorted(gens.items())))
    print("  이름 길이:", dict(sorted(lens.items())))
    print("  이름 중복:", len(out) - len({r[0] for r in out}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
