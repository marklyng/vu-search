"""
build_site.py — Build docs/data/ from data/episodes_meta.json + data/transcripts/.

For each episode:
- Reads metadata from episodes_meta.json
- Optionally reads data/transcripts/{id}.json for full transcript text
- Tokenises title (weight 3) + description (weight 2) + transcript (weight 1)
- Builds an inverted index: { token -> [ep_id, ...] }
- Writes:
    docs/data/search_index.json  — inverted index + per-episode meta/snippet
    docs/data/index.json         — slim episode registry (for display, no index)
    docs/data/episodes/{id}.json — full episode data (fetched on demand)
    docs/data/viz.json           — pre-computed stats for data visualizations

Usage:
    python scripts/build_site.py

Exits 0. Prints a summary with index size.
"""

import datetime
import gzip
import json
import os
import re
import sys
from collections import defaultdict
from pathlib import Path

DATA_DIR = Path(__file__).parent.parent / "data"
TRANSCRIPTS_DIR = DATA_DIR / "transcripts"
SEGMENTS_DIR = DATA_DIR / "segments"
DOCS_DATA_DIR = Path(__file__).parent.parent / "docs" / "data"
EPISODES_DIR = DOCS_DATA_DIR / "episodes"

META_FILE = DATA_DIR / "episodes_meta.json"
INDEX_FILE = DOCS_DATA_DIR / "index.json"
SEARCH_INDEX_FILE = DOCS_DATA_DIR / "search_index.json"
EPISODE_META_FILE = DOCS_DATA_DIR / "meta.json"
VIZ_FILE = DOCS_DATA_DIR / "viz.json"

SNIPPET_LENGTH = 200  # characters for snippet in search results

# Danish stopwords — common words that add noise without search value
DANISH_STOPWORDS = {
    "af", "og", "i", "er", "til", "det", "en", "at", "de", "den",
    "med", "for", "på", "som", "et", "vi", "han", "hun", "men",
    "ikke", "der", "fra", "om", "var", "kan", "har", "sig", "så",
    "vil", "denne", "dette", "disse", "eller", "også", "ud", "ind",
    "over", "under", "efter", "da", "nu", "her", "sin", "sit",
    "hvad", "når", "hvis", "dem", "os", "jeg", "du", "man", "mere",
    "meget", "jo", "bare", "godt", "alt", "alle", "ingen", "anden",
    "andre", "vores", "deres", "hvert", "meget", "se", "lad", "få",
    "kom", "gå", "sige", "blive", "være", "have", "gøre", "tage",
}

FILTH_WORDS = [
    "penis", "sex", "orgasme", "lort", "sæd", "pik",
    "tissemand", "vagina", "tissekone", "afføring", "udflåd",
]

SCIENCE_WORDS = [
    # Biology / life sciences
    "dna", "evolution", "bakterie", "protein", "celle", "virus", "kromosom",
    "enzym", "hormon", "mutation", "fotosyntese", "metabolisme", "parasit",
    "immunsystem", "antibiotik", "vaccine", "kræft", "tumor",
    # Genetics / molecular
    "gen", "genom", "rna", "crispr", "allel", "epigenetik",
    # Neuroscience
    "neuron", "synapse", "kognition", "neurotransmitter", "cortex",
    # Physics
    "kvantemekanik", "relativitetsteori", "termodynamik", "elektromagnetisme",
    "atom", "partikel", "neutron", "proton", "elektron", "foton",
    "entropi", "hawking",
    # Chemistry
    "molekyle", "isotop", "radioaktiv", "oxidation", "polymer", "katalysator",
    # Astronomy / cosmology
    "galakse", "univers", "supernova", "asteroid", "komet",
    # Medicine / clinical
    "placebo", "randomiseret", "klinisk", "diagnose", "symptom",
]
# Multi-word science terms handled separately (can't use word-boundary regex on phrases)
SCIENCE_PHRASES = ["sort hul", "big bang"]

BODY_PARTS = [
    "hjerne", "blod", "hjerte", "lever", "lunge", "nyre", "mave", "tarm",
    "knogle", "hud", "øje", "mund", "næse", "øre", "arm", "ben",
    "hånd", "fod", "ryg", "bryst",
]

# Danish animal name → taxonomy category.
# Sorted longest-first at runtime to prevent "ko" matching inside "koala"/"koral".
ANIMAL_CATEGORIES = {
    # Pattedyr (mammals)
    "træspidsmus": "pattedyr", "havrodder": "pattedyr", "havodder": "pattedyr",
    "orangutang": "pattedyr", "dværgspidsmus": "pattedyr",
    "størspidsmus": "pattedyr", "dværghamster": "pattedyr",
    "dværhamstre": "pattedyr", "dværhamster": "pattedyr",
    "handhamstre": "pattedyr", "vaskebjørn": "pattedyr", "flodhest": "pattedyr",
    "chimpanse": "pattedyr", "flagermus": "pattedyr", "flaggermus": "pattedyr", "blåhval": "pattedyr",
    "hunmuldvarp": "pattedyr",
    "dørhovedmyre": "insekt", "haddelfin": "pattedyr", "søløve": "pattedyr",
    "dovendyr": "pattedyr", "dårndyr": "pattedyr",
    "valer": "pattedyr",
    "næsehorn": "pattedyr", "kødkvæg": "pattedyr", "kængure": "pattedyr",
    "manguste": "pattedyr", "antilope": "pattedyr", "kangure": "pattedyr",
    "pindsvin": "pattedyr", "pungrotte": "pattedyr", "randstyr": "pattedyr",
    "grævling": "pattedyr", "spidsmus": "pattedyr", "muldvarp": "pattedyr",
    "gorille": "pattedyr", "elefant": "pattedyr", "mangust": "pattedyr",
    "kænguru": "pattedyr", "næbdyr": "pattedyr", "hamster": "pattedyr",
    "rensdyr": "pattedyr", "gorilla": "pattedyr", "mammut": "pattedyr",
    "marsvin": "pattedyr", "panda": "pattedyr", "egern": "pattedyr",
    "bjørn": "pattedyr", "bæver": "pattedyr", "delfin": "pattedyr",
    "dingo": "pattedyr", "elg": "pattedyr", "gepard": "pattedyr",
    "giraf": "pattedyr", "hjort": "pattedyr", "hyæne": "pattedyr",
    "kanin": "pattedyr", "koala": "pattedyr", "lemur": "pattedyr",
    "leopard": "pattedyr", "løvinde": "pattedyr", "løve": "pattedyr",
    "okapi": "pattedyr", "rådyr": "pattedyr", "rentyr": "pattedyr",
    "ræv": "pattedyr", "sæl": "pattedyr", "tapir": "pattedyr",
    "tiger": "pattedyr", "odder": "pattedyr", "kamel": "pattedyr",
    "ulv": "pattedyr", "zebra": "pattedyr", "abe": "pattedyr",
    "finerasse": "pattedyr", "kvæg": "pattedyr", "gris": "pattedyr", "hest": "pattedyr",
    "hund": "pattedyr", "hval": "pattedyr", "kat": "pattedyr",
    "mus": "pattedyr", "rotte": "pattedyr",
    "søer": "pattedyr",  # catches "søers" (sow possessive)
    "kø": "pattedyr",   # catches plural "køer" (cow)
    "ko": "pattedyr",
    "føl": "pattedyr",  # foal → horse
    # Fugle (birds)
    "fuglekonge": "fugl", "vandfugl": "fugl", "albatros": "fugl",
    "flamingo": "fugl", "jernspurv": "fugl", "kolibri": "fugl",
    "kalkun": "fugl", "musvit": "fugl", "papegøje": "fugl",
    "pelikan": "fugl", "pingvin": "fugl", "struds": "fugl",
    "isfugl": "fugl", "kiwi": "fugl", "måge": "fugl", "ænder": "fugl",   # catches plural of "and" (duck)
    "and": "fugl", "due": "fugl", "falk": "fugl", "glente": "fugl",
    "hane": "fugl", "høne": "fugl", "høns": "fugl", "krage": "fugl",
    "kylling": "fugl", "mejse": "fugl", "ravn": "fugl", "spurv": "fugl",
    "stork": "fugl", "stær": "fugl", "svane": "fugl", "ugle": "fugl",
    "ørn": "fugl", "gås": "fugl",
    # Insekter / edderkopper (insects / arachnids)
    "påfugleedderkoppe": "insekt", "fugleedderkoppe": "insekt",
    "æderkoppe": "insekt", "edderkoppe": "insekt", "kakerlak": "insekt",
    "sommerfugl": "insekt", "bananflug": "insekt", "bananflue": "insekt",
    "stikmyre": "insekt", "skorpion": "insekt", "termit": "insekt",
    "døgnflue": "insekt", "bille": "insekt", "hveps": "insekt",
    "loppe": "insekt", "lus": "insekt", "møl": "insekt",
    "knæler": "insekt", "thrurps": "insekt", "myre": "insekt", "myg": "insekt", "bi": "insekt",
    # Krybdyr / padder (reptiles / amphibians)
    "minikameleon": "reptil", "tyrannosaurus": "reptil", "krokodille": "reptil", "kameleon": "reptil",
    "kamælon": "reptil", "komodovar": "reptil", "salamander": "reptil",
    "skildpadde": "reptil", "firben": "reptil", "frø": "reptil",
    "gecko": "reptil", "slange": "reptil", "tudse": "reptil",
    # Fisk (fish)
    "hvalhai": "fisk", "pighvar": "fisk", "havhest": "fisk", "valhaj": "fisk",
    "ørred": "fisk", "haj": "fisk", "laks": "fisk",
    "pirat": "fisk",   # catches "pirater" (piranhaer transcription variant)
    "fisk": "fisk",   # catches generic fish facts
    "sild": "fisk", "torsk": "fisk", "ål": "fisk",
    # Andet (other / marine invertebrates)
    "ferskvandssnegl": "andet",  # compound form, canonical: snegl
    "søstjerne": "andet",
    "blæksprutte": "andet", "blæksprut": "andet",   # two Danish inflection forms
    "turritopsis": "andet", "vandmænd": "andet", "rankefød": "andet", "rankefod": "andet",
    "dolkhale": "andet", "vandmand": "andet", "sandorm": "andet",
    "hummer": "andet", "krabbe": "andet", "koral": "andet",
    "maneter": "andet", "meduse": "andet", "rejer": "andet",
    "snegl": "andet", "orm": "andet",
}
# Pre-sort keys longest-first so "ko" can't match inside "koala", "koral", etc.
_ANIMAL_KEYS_SORTED = sorted(ANIMAL_CATEGORIES.keys(), key=len, reverse=True)

# Map variant/plural detection keys → canonical display name used in the bestiary.
_ANIMAL_CANONICAL: dict[str, str] = {
    "kø": "ko",                  # plural stem of "ko" (cow)
    "blæksprut": "blæksprutte",  # definite-form variant
    "gorille": "gorilla",        # plural stem
    "kængure": "kænguru",        # plural stem
    "kangure": "kænguru",        # alternate spelling plural
    "ænder": "and",              # plural of "and" (duck)
    "randstyr": "rensdyr",       # Haiku transcription error
    "valhaj": "hvalhai",         # alternate spelling
    "kamælon": "kameleon",       # alternate spelling
    "søer": "gris",              # sow → generic pig
    "dværhamster": "hamster",    # compound form
    "dværhamstre": "hamster",
    "dværghamster": "hamster",
    "handhamstre": "hamster",
    "bananflug": "bananflue",    # plural stem
    "rankefød": "rankefod",      # plural stem
    "vandmænd": "vandmand",      # plural form
    "stikmyre": "myre",          # compound → generic
    "æderkoppe": "edderkoppe",   # alternate spelling
    "thrurps": "hveps",          # English-ish name Haiku kept
    "størspidsmus": "spidsmus",  # compound form
    "kødkvæg": "kvæg",           # compound form
    "minikameleon": "kameleon",  # compound form
    "pirat": "piranha",          # piranha transcription variant
    "finerasse": "gris",         # specific pig breed → generic
    "valer": "hval",             # plural stem of "hval" (whale)
    "haddelfin": "delfin",       # harbor dolphin → generic dolphin
    "søløve": "sæl",             # sea lion → sæl category
    "dørhovedmyre": "myre",      # door-head ant → generic ant
    "dårndyr": "dovendyr",       # Whisper mishearing of "dovendyr" (sloth)
    "ferskvandssnegl": "snegl",  # compound form → generic snail
    "føl": "hest",               # foal → horse
    "flaggermus": "flagermus",        # double-g variant → canonical single-g spelling
    "hunmuldvarp": "muldvarp",        # hun-muldvarp compound → generic mole
    "havrodder": "havodder",          # alternate spelling
    "havodder": "odder",              # sea otter → otter category
    "dværgspidsmus": "spidsmus",      # compound → generic
    "størspidsmus": "spidsmus",       # compound → generic
    "påfugleedderkoppe": "edderkoppe",
    "fugleedderkoppe": "edderkoppe",
}


def tokenise(text: str) -> list[str]:
    """
    Lowercase, keep only letters (including Danish æøå), split on non-letter chars.
    Returns a list of tokens, stopwords filtered out.
    """
    text = text.lower()
    tokens = re.findall(r"[a-zæøåA-ZÆØÅ]{2,}", text)
    return [t for t in tokens if t not in DANISH_STOPWORDS]


def make_snippet(description: str, transcript: str | None, length: int = SNIPPET_LENGTH) -> str:
    """Pick the best snippet: prefer description if substantial, else start of transcript."""
    if description and len(description) > 40:
        return description[:length].rstrip()
    if transcript:
        return transcript[:length].rstrip()
    return ""


def short_id(full_id: str) -> str:
    """Use first 16 chars of the Acast GUID as the short key in the index."""
    return full_id[:16]


def load_transcript(ep_id: str) -> str | None:
    """Load transcript text for an episode, or return None if not available."""
    gz_path = TRANSCRIPTS_DIR / f"{ep_id}.json.gz"
    json_path = TRANSCRIPTS_DIR / f"{ep_id}.json"
    try:
        if gz_path.exists():
            data = json.loads(gzip.decompress(gz_path.read_bytes()).decode("utf-8"))
        elif json_path.exists():
            data = json.loads(json_path.read_text(encoding="utf-8"))
        else:
            return None
        return data.get("text") or None
    except (json.JSONDecodeError, OSError) as e:
        print(f"  WARNING: Could not read transcript for {ep_id}: {e}", file=sys.stderr)
        return None


def load_segments(ep_id: str) -> dict | None:
    """Load extracted segments (dyrfakt, listener_question) for an episode."""
    path = SEGMENTS_DIR / f"{ep_id}.json"
    if not path.exists():
        return None
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        print(f"  WARNING: Could not read segments for {ep_id}: {e}", file=sys.stderr)
        return None


def build(
    episodes: list[dict],
    transcripts: dict[str, str | None],
    segments: dict[str, dict | None],
) -> tuple[dict, list[dict]]:
    """
    Build inverted index and slim registry.

    Returns:
        search_index: { "index": {token: [sid, ...]}, "meta": {sid: {...}} }
        registry: list of slim episode dicts for index.json
    """
    scores: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    meta: dict[str, dict] = {}
    registry: list[dict] = []

    for ep in episodes:
        ep_id = ep["id"]
        sid = short_id(ep_id)
        title = ep.get("title") or ""
        description = ep.get("description") or ""
        transcript = transcripts[ep_id]
        has_transcript = transcript is not None
        seg = segments[ep_id]

        # Tokenise each field with its weight
        for token in tokenise(title):
            scores[token][sid] += 3.0
        for token in tokenise(description):
            scores[token][sid] += 2.0
        if transcript:
            for token in tokenise(transcript):
                scores[token][sid] += 1.0
        if seg:
            for token in tokenise(seg.get("dyrfakt") or ""):
                scores[token][sid] += 4.0
            for token in tokenise(seg.get("listener_question") or ""):
                scores[token][sid] += 3.0

        snippet = make_snippet(description, transcript)

        meta[sid] = {
            "id": ep_id,
            "title": title,
            "date": ep.get("date") or "",
            "snippet": snippet,
            "has_transcript": has_transcript,
            "dyrfakt": seg.get("dyrfakt") if seg else None,
            "listener_question": seg.get("listener_question") if seg else None,
            "image_url": ep.get("image_url") or "",
        }

        registry.append({
            "id": ep_id,
            "title": title,
            "date": ep.get("date") or "",
            "duration": ep.get("duration") or "",
            "episode_number": ep.get("episode_number"),
            "has_transcript": has_transcript,
            "image_url": ep.get("image_url") or "",
        })

    # Convert scores to sorted posting lists (highest score first within each token)
    index: dict[str, list[str]] = {}
    for token, sid_scores in scores.items():
        sorted_sids = sorted(sid_scores, key=lambda s: sid_scores[s], reverse=True)
        index[token] = sorted_sids

    search_index = {"index": index, "meta": meta}
    return search_index, meta, registry


def write_episode_files(
    episodes: list[dict],
    transcripts: dict[str, str | None],
    segments: dict[str, dict | None],
) -> None:
    """Write one docs/data/episodes/{id}.json per episode."""
    EPISODES_DIR.mkdir(parents=True, exist_ok=True)
    for ep in episodes:
        ep_id = ep["id"]
        seg = segments[ep_id]
        out = {
            "id": ep_id,
            "title": ep.get("title") or "",
            "date": ep.get("date") or "",
            "audio_url": ep.get("audio_url") or "",
            "episode_url": ep.get("episode_url") or "",
            "description": ep.get("description") or "",
            "duration": ep.get("duration") or "",
            "episode_number": ep.get("episode_number"),
            "image_url": ep.get("image_url") or "",
            "transcript": transcripts[ep_id],
            "dyrfakt": seg.get("dyrfakt") if seg else None,
            "listener_question": seg.get("listener_question") if seg else None,
        }
        path = EPISODES_DIR / f"{ep_id}.json"
        with open(path, "w", encoding="utf-8") as f:
            json.dump(out, f, ensure_ascii=False, separators=(",", ":"))


def _count_word(text: str, word: str) -> int:
    """Count occurrences of word (plus inflected forms) in text."""
    return len(re.findall(r"\b" + re.escape(word) + r"\w*", text))


def _detect_animal(dyrfakt_text: str, animal_field: str | None) -> tuple[str, str]:
    """
    Return (canonical_animal_name, category) for a dyrfakt.
    Prefers the structured `animal` field if present; falls back to dict scan.

    Short animal names (≤4 chars, e.g. "ko", "bi", "and") only match within
    the first 70 chars — the animal almost always leads the fact, and \\w* suffix
    otherwise catches unrelated Danish words (kolonien, kønsorganer, biologi…).
    """
    if animal_field:
        raw = animal_field.lower()
        canonical = _ANIMAL_CANONICAL.get(raw, raw)
        cat = ANIMAL_CATEGORIES.get(canonical, ANIMAL_CATEGORIES.get(raw, "andet"))
        return canonical, cat
    text_lower = dyrfakt_text.lower()
    for animal in _ANIMAL_KEYS_SORTED:
        search_in = text_lower[:70] if len(animal) <= 4 else text_lower
        # Short animals (≤3 chars): bounded suffix prevents "bi" matching "biosfæren",
        # "mus" matching "musselinende", etc.
        if len(animal) <= 3:
            pat = r"\b" + re.escape(animal) + r"[a-zæøå]{0,6}\b"
        else:
            pat = r"\b" + re.escape(animal) + r"\w*"
        if re.search(pat, search_in):
            canonical = _ANIMAL_CANONICAL.get(animal, animal)
            cat = ANIMAL_CATEGORIES.get(canonical, ANIMAL_CATEGORIES[animal])
            return canonical, cat
    return "andet", "andet"


def _parse_duration_min(duration_str: str) -> int:
    """Parse 'H:MM:SS' or 'M:SS' to whole minutes."""
    if not duration_str:
        return 0
    parts = duration_str.strip().split(":")
    try:
        if len(parts) == 3:
            return int(parts[0]) * 60 + int(parts[1])
        if len(parts) == 2:
            return int(parts[0])
        return int(float(parts[0]))
    except (ValueError, IndexError):
        return 0


def build_viz_data(
    episodes: list[dict],
    transcripts: dict[str, str | None],
    segments: dict[str, dict | None],
) -> dict:
    """
    Pre-compute all visualization data from episodes, transcripts, and segments.
    Returns the full viz.json dict.
    """
    seismograph = []
    scatter = []
    hosts = []
    body_map: dict[str, int] = {part: 0 for part in BODY_PARTS}
    totals = {"flemming": 0, "mark": 0, "transcribed": 0}

    bestiary_acc: dict[str, dict] = {}  # animal → {category, facts[]}

    unmatched_warnings: list[str] = []

    for ep in episodes:
        ep_id = ep["id"]
        sid = short_id(ep_id)
        title = ep.get("title") or ""
        date = ep.get("date") or ""
        ep_num = ep.get("episode_number")
        ep_label = f"#{ep_num}: {title}" if ep_num else title
        transcript = transcripts[ep_id]
        seg = segments[ep_id]

        # --- Bestiary ---
        if seg and seg.get("dyrfakt"):
            fact_text = seg["dyrfakt"]
            animal_field = seg.get("animal")
            animal, category = _detect_animal(fact_text, animal_field)
            if animal == "andet" and not animal_field:
                unmatched_warnings.append(
                    f"  WARNING: no animal matched for ep {ep_label!r}: {fact_text[:60]!r}"
                )
            if animal not in bestiary_acc:
                bestiary_acc[animal] = {"animal": animal, "category": category, "count": 0, "facts": []}
            bestiary_acc[animal]["count"] += 1
            bestiary_acc[animal]["facts"].append({
                "ep": ep_num,
                "sid": sid,
                "title": ep_label,
                "fact": fact_text,
            })

        if transcript is None:
            continue

        text_lower = transcript.lower()

        # --- Seismograph ---
        filth_counts = {w: _count_word(text_lower, w) for w in FILTH_WORDS}
        total_filth = sum(filth_counts.values())
        dominant = max(filth_counts, key=filth_counts.get) if total_filth > 0 else "none"
        seismograph.append({
            "sid": sid,
            "ep": ep_num,
            "title": ep_label,
            "date": date,
            "filth": filth_counts,
            "total_filth": total_filth,
            "dominant": dominant,
        })

        # --- Scatter ---
        science_score = sum(_count_word(text_lower, w) for w in SCIENCE_WORDS)
        science_score += sum(text_lower.count(phrase) for phrase in SCIENCE_PHRASES)
        scatological_score = total_filth
        scatter.append({
            "sid": sid,
            "ep": ep_num,
            "title": ep_label,
            "date": date,
            "duration_min": _parse_duration_min(ep.get("duration") or ""),
            "science_score": science_score,
            "scatological_score": scatological_score,
        })

        # --- Body map ---
        for part in BODY_PARTS:
            body_map[part] += _count_word(text_lower, part)

        # --- Hosts ---
        flemming_count = len(re.findall(r"\bflemming\b", text_lower))
        mark_count = len(re.findall(r"\bmark\b", text_lower))
        hosts.append({
            "sid": sid,
            "ep": ep_num,
            "title": ep_label,
            "date": date,
            "flemming": flemming_count,
            "mark": mark_count,
        })
        totals["flemming"] += flemming_count
        totals["mark"] += mark_count
        totals["transcribed"] += 1

    # Print unmatched animal warnings
    for w in unmatched_warnings:
        print(w, file=sys.stderr)

    bestiary = sorted(bestiary_acc.values(), key=lambda x: x["count"], reverse=True)

    return {
        "generated": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "seismograph": seismograph,
        "bestiary": bestiary,
        "scatter": scatter,
        "body_map": body_map,
        "hosts": hosts,
        "totals": totals,
    }


def main():
    if not META_FILE.exists():
        print(f"ERROR: {META_FILE} not found. Run scripts/rss_fetch.py first.", file=sys.stderr)
        sys.exit(1)

    with open(META_FILE, encoding="utf-8") as f:
        episodes = json.load(f)

    if not episodes:
        print("ERROR: No episodes found in episodes_meta.json.", file=sys.stderr)
        sys.exit(1)

    print(f"Building site data for {len(episodes)} episodes...")

    DOCS_DATA_DIR.mkdir(parents=True, exist_ok=True)

    print("  Loading transcripts and segments...")
    transcripts = {ep["id"]: load_transcript(ep["id"]) for ep in episodes}
    segments = {ep["id"]: load_segments(ep["id"]) for ep in episodes}

    print("  Writing episode files...")
    write_episode_files(episodes, transcripts, segments)

    print("  Building search index...")
    search_index, episode_meta, registry = build(episodes, transcripts, segments)

    print("  Writing search_index.json...")
    with open(SEARCH_INDEX_FILE, "w", encoding="utf-8") as f:
        json.dump(search_index["index"], f, ensure_ascii=False, separators=(",", ":"))

    print("  Writing meta.json...")
    with open(EPISODE_META_FILE, "w", encoding="utf-8") as f:
        json.dump(episode_meta, f, ensure_ascii=False, separators=(",", ":"))

    print("  Writing index.json...")
    with open(INDEX_FILE, "w", encoding="utf-8") as f:
        json.dump(registry, f, ensure_ascii=False, separators=(",", ":"))

    print("  Building viz data...")
    viz = build_viz_data(episodes, transcripts, segments)
    print("  Writing viz.json...")
    with open(VIZ_FILE, "w", encoding="utf-8") as f:
        json.dump(viz, f, ensure_ascii=False, separators=(",", ":"))

    # Report
    n_with_transcript = sum(1 for v in transcripts.values() if v is not None)
    n_with_segments = sum(1 for v in segments.values() if v is not None)
    index_size_kb = SEARCH_INDEX_FILE.stat().st_size / 1024
    meta_size_kb = EPISODE_META_FILE.stat().st_size / 1024
    viz_size_kb = VIZ_FILE.stat().st_size / 1024
    ep_dir_size_kb = sum(
        f.stat().st_size for f in EPISODES_DIR.iterdir() if f.is_file()
    ) / 1024

    print(f"\nDone.")
    print(f"  {len(episodes)} episodes total")
    print(f"  {n_with_transcript} with transcripts ({len(episodes) - n_with_transcript} description-only)")
    print(f"  {n_with_segments} with segments (dyrfakt/lytterspørgsmål extracted)")
    print(f"  search_index.json: {index_size_kb:.1f} KB")
    print(f"  meta.json:         {meta_size_kb:.1f} KB")
    print(f"  viz.json:          {viz_size_kb:.1f} KB")
    print(f"  episodes/ dir:     {ep_dir_size_kb:.1f} KB total")
    print(f"  Unique tokens in index: {len(search_index['index'])}")


if __name__ == "__main__":
    main()
