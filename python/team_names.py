"""队名归一化与解析：ESPN 队名 -> 训练数据里的队名。

XGBoost 推理链路专用：把 ESPN 的队名、比赛时钟解析成模型可用的输入。
"""

from __future__ import annotations

import unicodedata
from typing import Dict, Iterable, Optional

_STOPWORDS = {
    "fc", "afc", "cf", "sc", "ac", "as", "ss", "ssc", "us", "ud",
    "cd", "sd", "rc", "ca", "club", "calcio", "the", "of", "de",
    "vfb", "vfl", "tsg", "fsv", "bsc", "sv", "rcd", "spvgg",
    "stade", "aj", "sco", "foot", "estac",
}

ALIASES: Dict[str, str] = {
    "manchester united": "Man United", "man utd": "Man United", "man united": "Man United",
    "manchester city": "Man City", "man city": "Man City",
    "nottingham forest": "Nott'm Forest", "nottm forest": "Nott'm Forest",
    "tottenham hotspur": "Tottenham", "spurs": "Tottenham",
    "wolverhampton wanderers": "Wolves", "wolverhampton": "Wolves",
    "newcastle united": "Newcastle", "west ham united": "West Ham",
    "brighton and hove albion": "Brighton", "brighton hove albion": "Brighton",
    "leicester city": "Leicester", "ipswich town": "Ipswich", "leeds united": "Leeds",
    "luton town": "Luton", "afc bournemouth": "Bournemouth", "sheffield utd": "Sheffield United",
    "atletico madrid": "Ath Madrid", "athletic club": "Ath Bilbao", "athletic bilbao": "Ath Bilbao",
    "real betis": "Betis", "real sociedad": "Sociedad", "celta vigo": "Celta",
    "rayo vallecano": "Vallecano", "espanyol barcelona": "Espanol", "deportivo alaves": "Alaves",
    "real valladolid": "Valladolid", "las palmas": "Las Palmas", "leganes": "Leganes",
    "real oviedo": "Oviedo", "girona": "Girona", "osasuna": "Osasuna", "mallorca": "Mallorca",
    "getafe": "Getafe", "valencia": "Valencia", "sevilla": "Sevilla", "villarreal": "Villarreal",
    "almeria": "Almeria", "granada": "Granada", "cadiz": "Cadiz", "levante": "Levante",
    "real madrid": "Real Madrid",
    "bayern munich": "Bayern Munich", "bayern": "Bayern Munich",
    "borussia dortmund": "Dortmund", "dortmund": "Dortmund",
    "bayer leverkusen": "Leverkusen", "leverkusen": "Leverkusen", "rb leipzig": "RB Leipzig",
    "eintracht frankfurt": "Ein Frankfurt", "frankfurt": "Ein Frankfurt",
    "borussia monchengladbach": "M'gladbach", "monchengladbach": "M'gladbach",
    "koln": "FC Koln", "cologne": "FC Koln", "union berlin": "Union Berlin",
    "werder bremen": "Werder Bremen", "stuttgart": "Stuttgart", "freiburg": "Freiburg",
    "wolfsburg": "Wolfsburg", "mainz": "Mainz", "augsburg": "Augsburg",
    "hoffenheim": "Hoffenheim", "heidenheim": "Heidenheim", "st pauli": "St Pauli",
    "holstein kiel": "Holstein Kiel", "bochum": "Bochum", "hertha berlin": "Hertha",
    "hertha": "Hertha", "hamburg": "Hamburg", "hamburger sv": "Hamburg",
    "schalke": "Schalke 04", "darmstadt": "Darmstadt",
    "inter": "Inter", "inter milan": "Inter", "internazionale": "Inter",
    "milan": "Milan", "ac milan": "Milan", "juventus": "Juventus", "napoli": "Napoli",
    "roma": "Roma", "lazio": "Lazio", "atalanta": "Atalanta", "fiorentina": "Fiorentina",
    "bologna": "Bologna", "torino": "Torino", "udinese": "Udinese", "genoa": "Genoa",
    "cagliari": "Cagliari", "empoli": "Empoli", "hellas verona": "Verona", "verona": "Verona",
    "lecce": "Lecce", "monza": "Monza", "salernitana": "Salernitana", "sassuolo": "Sassuolo",
    "frosinone": "Frosinone", "cremonese": "Cremonese", "como": "Como", "parma": "Parma",
    "venezia": "Venezia", "spezia": "Spezia", "sampdoria": "Sampdoria", "pisa": "Pisa",
    "paris saint germain": "Paris SG", "paris st germain": "Paris SG", "psg": "Paris SG",
    "paris fc": "Paris FC", "marseille": "Marseille", "olympique marseille": "Marseille",
    "lyon": "Lyon", "olympique lyonnais": "Lyon", "monaco": "Monaco", "lille": "Lille",
    "nice": "Nice", "lens": "Lens", "rennes": "Rennes", "stade rennais": "Rennes",
    "brest": "Brest", "stade brestois": "Brest", "brestois": "Brest", "montpellier": "Montpellier", "nantes": "Nantes",
    "strasbourg": "Strasbourg", "toulouse": "Toulouse", "reims": "Reims",
    "auxerre": "Auxerre", "angers": "Angers", "le havre": "Le Havre", "metz": "Metz",
    "lorient": "Lorient", "clermont": "Clermont", "troyes": "Troyes", "ajaccio": "Ajaccio",
    "saint etienne": "St Etienne", "st etienne": "St Etienne",
    # 中超：ESPN 的写法在不同赛季之间不统一（全大写、带 FC / Professional 后缀），
    # 训练数据里存的是 fetch_csl.py 规范化后的名字，这里补齐映射。
    "zhejiang professional": "Zhejiang", "zhejiang": "Zhejiang",
    "shanghai port": "Shanghai Port", "shanghai shenhua": "Shanghai Shenhua",
    "dalian yingbo": "Dalian Yingbo", "dalian pro": "Dalian Pro",
    "shenzhen xinpengcheng": "Shenzhen Xinpengcheng", "shenzhen": "Shenzhen FC",
    "qingdao west coast": "Qingdao West Coast", "qingdao hainiu": "Qingdao Hainiu",
    "chongqing tonglianglong": "Chongqing Tonglianglong",
    "liaoning tieren": "Liaoning Tieren", "yunnan yukun": "Yunnan Yukun",
    "wuhan three towns": "Wuhan Three Towns", "tianjin jinmen tiger": "Tianjin Jinmen Tiger",
    "cangzhou mighty lions": "Cangzhou Mighty Lions", "meizhou hakka": "Meizhou Hakka",
    "nantong zhiyun": "Nantong Zhiyun", "changchun yatai": "Changchun Yatai",
    "shandong taishan": "Shandong Taishan", "beijing guoan": "Beijing Guoan",
    "chengdu rongcheng": "Chengdu Rongcheng", "henan": "Henan",
}


def normalize_name(name: str) -> str:
    text = unicodedata.normalize("NFKD", name or "")
    text = "".join(ch for ch in text if not unicodedata.combining(ch)).lower()
    text = (
        text.replace("&", " and ")
        .replace("'", "")
        .replace("`", "")
        .replace(".", " ")
        .replace("-", " ")
    )
    tokens = [tok for tok in text.split() if tok and tok not in _STOPWORDS and not tok.isdigit()]
    return " ".join(tokens)


class TeamResolver:
    """ESPN 队名 -> 训练数据里的队名。"""

    def __init__(self, known: Iterable[str]):
        import difflib

        self._difflib = difflib
        self.known = set(known)
        self.index: Dict[str, str] = {}
        for team in self.known:
            self.index.setdefault(normalize_name(team), team)
        for alias, team in ALIASES.items():
            if team in self.known:
                self.index.setdefault(normalize_name(alias), team)

    def resolve(self, name: Optional[str]) -> Optional[str]:
        if not name:
            return None
        if name in self.known:
            return name
        norm = normalize_name(name)
        if not norm:
            return None
        if norm in self.index:
            return self.index[norm]
        match = self._difflib.get_close_matches(norm, list(self.index), n=1, cutoff=0.85)
        return self.index[match[0]] if match else None

    def add(self, name: str) -> None:
        """登记一支新球队（升班马），后续同一进程内可直接解析到它。"""
        if not name:
            return
        self.known.add(name)
        self.index.setdefault(normalize_name(name), name)


def parse_minute(clock: Optional[str], state: str = "pre") -> float:
    """'67'' -> 67；'HT' -> 45；解析不到时按 45 处理。"""
    if state != "in":
        return 0.0
    text = str(clock or "").strip()
    digits = "".join(ch if ch.isdigit() else " " for ch in text).split()
    if digits:
        try:
            return float(min(120, max(0, int(digits[0]))))
        except ValueError:
            pass
    upper = text.upper()
    if "2ND" in upper or "SECOND" in upper:
        return 60.0
    return 45.0
