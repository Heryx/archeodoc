"""
Porting Python di shared/normalize_us_code.ts (ArcheoDoc, TypeScript).
Deve restare comportamentalmente identico a quel file: se cambia uno, cambia l'altro.
Non reimplementare con logica diversa.
"""
import re

_US_PREFIXES = [
    ("US", ["US", "U.S."]),
    ("USM", ["USM"]),
    ("USR", ["USR"]),
    ("USS", ["USS"]),
    ("UVS", ["UVS"]),
    ("UT", ["UT"]),
    ("SAS", ["SAS"]),
    ("F", ["F"]),
    ("T", ["T"]),
    ("SB", ["SB"]),
    ("SF", ["SF"]),
]


def _sanitize_code(raw: str) -> str:
    return re.sub(r"\s+", "", raw.strip().upper())


def _normalize_prefix(value: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", value.upper())


def _normalize_numeric_suffix(value: str) -> str:
    numeric = value.lstrip("0")
    return numeric or "0"


def normalize_us_code(value) -> str:
    raw = _sanitize_code(str(value) if value is not None else "")
    if not raw:
        return ""

    compact = re.sub(r"[^A-Z0-9]", "", raw)
    if not compact:
        return ""

    if compact.isdigit():
        return f"US {_normalize_numeric_suffix(compact)}"

    for canonical, aliases in _US_PREFIXES:
        normalized_aliases = [_normalize_prefix(a) for a in aliases]
        matched = next((a for a in normalized_aliases if compact.startswith(a)), None)
        if matched is None:
            continue

        rest = compact[len(matched):]
        if not rest:
            return canonical
        if rest.isdigit():
            return f"{canonical} {_normalize_numeric_suffix(rest)}"
        return f"{canonical} {rest}"

    return compact


def us_code_key(value) -> str:
    normalized = re.sub(r"[^A-Z0-9]", "", normalize_us_code(value))
    if not normalized:
        return ""

    if normalized.isdigit():
        return f"US{_normalize_numeric_suffix(normalized)}"

    for canonical, _aliases in _US_PREFIXES:
        if not normalized.startswith(canonical):
            continue
        rest = normalized[len(canonical):]
        if not rest:
            return canonical
        if rest.isdigit():
            return f"{canonical}{_normalize_numeric_suffix(rest)}"
        return f"{canonical}{rest}"

    return normalized
