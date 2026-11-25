"""Genera il dataset sintetico delle campagne Wayfare Media e il relativo ground truth.

Uso:
    python data/generator/generate_dataset.py            # scrive data/campagne_wayfare.csv
                                                          # e data/generator/ground_truth.json

Il dataset è riproducibile (seed fisso) e contiene di proposito anomalie realistiche
(duplicati, valori mancanti, formati incoerenti, valori fuori range) per mettere alla
prova la pulizia dati autonoma del data agent.

Il modulo espone anche `reference_clean()`: l'implementazione di riferimento delle regole
di qualità descritte in data/dizionario_dati.md. Serve SOLO per calcolare il ground truth
usato dai test: il data agent non la vede e deve arrivare alla pulizia da solo.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

SEED = 23
DATA_DIR = Path(__file__).resolve().parents[1]
CSV_PATH = DATA_DIR / "campagne_wayfare.csv"
GROUND_TRUTH_PATH = Path(__file__).resolve().parent / "ground_truth.json"

DATA_ESTRAZIONE = date(2026, 9, 30)  # data di estrazione del report
PRIMO_FLIGHT = date(2024, 11, 4)  # campagne già in corso a inizio periodo
INIZIO_PERIODO = date(2025, 1, 1)  # primo giorno incluso nell'estrazione
N_CAMPAGNE = 180

# --- Parametri di business (devono coincidere con la knowledge base) -----------------

LISTINO_CPM = {  # EUR per 1.000 impression, listino 2025-2026
    "Gate Screen": 18.0,
    "Digital Totem": 14.0,
    "Lounge Screen": 32.0,
    "Wi-Fi Portal": 9.0,
    "Baggage Claim Wall": 12.0,
}
SCONTI_VOLUME = [(6_000_000, 0.20), (3_000_000, 0.15), (1_000_000, 0.10)]  # soglie su impression pianificate
SCONTO_EXTRA_MAX = 0.05  # sconto aggiuntivo massimo con approvazione Head of Sales
SCONTO_MASSIMO = 0.25  # tetto complessivo (sconto volume + extra)
SOGLIA_MAKE_GOOD = 0.95

AEROPORTI = {  # peso di traffico relativo e terminal con inventario
    "FCO": (1.00, ["T1", "T3"]),
    "MXP": (0.80, ["T1", "T2"]),
    "BGY": (0.45, ["T1"]),
    "VCE": (0.40, ["T1"]),
    "NAP": (0.40, ["T1"]),
    "LIN": (0.35, ["T1"]),
    "CTA": (0.35, ["T1"]),
    "BLQ": (0.30, ["T1"]),
}

FORMATI = {  # impression giornaliere base per linea (aeroporto peso 1), dwell medio sec, tasso QR base
    "Gate Screen": (60_000, 45, 0.0022),
    "Digital Totem": (35_000, 18, 0.0030),
    "Lounge Screen": (9_000, 160, 0.0060),
    "Wi-Fi Portal": (25_000, 9, 0.0045),
    "Baggage Claim Wall": (40_000, 240, 0.0012),
}
PESO_FORMATI = [0.30, 0.22, 0.13, 0.17, 0.18]
AEROPORTI_LOUNGE = ["FCO", "MXP", "LIN", "VCE", "NAP"]
INSERZIONISTI_ALCOLICI = {"Vigna Antica"}

SEGMENTI = ["Business", "Leisure", "Luxury Traveller", "Famiglie", "Giovani Esploratori"]

INSERZIONISTI = [  # nome fittizio, settore canonico
    ("Aurelia Gioielli", "Lusso"), ("Maison Verbena", "Lusso"), ("Orologeria Castelli", "Lusso"),
    ("Atelier Brera", "Moda"), ("Nordvik Outdoor", "Moda"), ("Linea Sartori", "Moda"),
    ("Lumen Beauty", "Beauty"), ("Essenza Profumi", "Beauty"),
    ("Velocar Auto", "Automotive"), ("Elettra Motors", "Automotive"),
    ("Banca Meridiana", "Finanza"), ("Fintrust Pay", "Finanza"),
    ("Orizzonte Viaggi", "Travel"), ("Sole Resort Group", "Travel"), ("RentaGo", "Travel"),
    ("Caffè Montano", "Food & Beverage"), ("Dolce Alpi", "Food & Beverage"), ("Vigna Antica", "Food & Beverage"),
    ("TelcoNova", "Telco"), ("SkyRoam eSIM", "Telco"),
    ("Pixelia Tech", "Tecnologia"), ("Soundwave Audio", "Tecnologia"),
]
AFFINITA_SEGMENTO = {  # pesi dei segmenti per settore
    "Lusso": [0.25, 0.10, 0.55, 0.05, 0.05],
    "Moda": [0.15, 0.30, 0.25, 0.10, 0.20],
    "Beauty": [0.15, 0.30, 0.30, 0.10, 0.15],
    "Automotive": [0.45, 0.20, 0.20, 0.10, 0.05],
    "Finanza": [0.60, 0.15, 0.15, 0.05, 0.05],
    "Travel": [0.10, 0.40, 0.10, 0.25, 0.15],
    "Food & Beverage": [0.10, 0.40, 0.05, 0.30, 0.15],
    "Telco": [0.25, 0.30, 0.05, 0.10, 0.30],
    "Tecnologia": [0.35, 0.20, 0.10, 0.05, 0.30],
}
MOLTIPLICATORE_SEGMENTO_QR = {
    "Business": 0.9, "Leisure": 1.0, "Luxury Traveller": 1.5, "Famiglie": 0.8, "Giovani Esploratori": 1.3,
}
STAGIONALITA = {1: 0.80, 2: 0.78, 3: 0.90, 4: 1.00, 5: 1.05, 6: 1.15,
                7: 1.30, 8: 1.35, 9: 1.10, 10: 1.00, 11: 0.85, 12: 1.05}
CRESCITA_ANNUA = {2024: 0.95, 2025: 1.00, 2026: 1.06}

# Lavori di ristrutturazione al terminal di Venezia: schermi spenti a rotazione
LAVORI_VCE = (date(2026, 1, 12), date(2026, 3, 29))

MESI_IT = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"]


def sconto_volume(impression_pianificate: float) -> float:
    for soglia, sconto in SCONTI_VOLUME:
        if impression_pianificate >= soglia:
            return sconto
    return 0.0


@dataclass
class Campagna:
    id: str
    inserzionista: str
    settore: str
    formato: str
    segmento: str
    aeroporti: list[str]
    inizio: date
    fine: date
    creativita_in_ritardo: bool
    profilo_erogazione: str  # "regolare" | "sotto" | "ritardo"


# --- Generazione del dataset pulito -----------------------------------------------------

# Le prenotazioni seguono la stagionalità del traffico: più campagne in primavera-estate e a dicembre
PESO_PRENOTAZIONI_MESE = {1: 0.6, 2: 0.6, 3: 0.8, 4: 1.0, 5: 1.1, 6: 1.3,
                          7: 1.4, 8: 1.2, 9: 1.0, 10: 0.9, 11: 0.9, 12: 1.2}


def data_partenza(rng: np.random.Generator, finestra: int) -> date:
    giorni = [PRIMO_FLIGHT + timedelta(days=d) for d in range(finestra - 7)]
    pesi = np.array([PESO_PRENOTAZIONI_MESE[g.month] * CRESCITA_ANNUA[g.year] for g in giorni])
    return giorni[int(rng.choice(len(giorni), p=pesi / pesi.sum()))]


def genera_campagne(rng: np.random.Generator) -> list[Campagna]:
    campagne = []
    finestra = (DATA_ESTRAZIONE - PRIMO_FLIGHT).days
    for i in range(N_CAMPAGNE):
        inserzionista, settore = INSERZIONISTI[rng.integers(len(INSERZIONISTI))]
        formato = rng.choice(list(FORMATI), p=PESO_FORMATI)
        if inserzionista in INSERZIONISTI_ALCOLICI:  # policy contenuti (handbook 7.2)
            formato = rng.choice(["Lounge Screen", "Baggage Claim Wall"])
        segmento = rng.choice(SEGMENTI, p=AFFINITA_SEGMENTO[settore])
        if formato == "Lounge Screen" and settore == "Lusso":
            segmento = "Luxury Traveller"
        n_aeroporti = rng.choice([1, 2, 3], p=[0.35, 0.40, 0.25])
        candidati = AEROPORTI_LOUNGE if formato == "Lounge Screen" else list(AEROPORTI)  # handbook 2.3
        pesi = np.array([AEROPORTI[a][0] for a in candidati])
        aeroporti = list(rng.choice(candidati, size=n_aeroporti, replace=False, p=pesi / pesi.sum()))
        durata = int(rng.choice([14, 21, 28, 35, 42], p=[0.15, 0.25, 0.30, 0.18, 0.12]))
        inizio = data_partenza(rng, finestra)
        fine = inizio + timedelta(days=durata - 1)
        ritardo = rng.random() < 0.10
        if ritardo:
            profilo = "ritardo"
        elif rng.random() < 0.09:
            profilo = "sotto"
        else:
            profilo = "regolare"
        campagne.append(Campagna(
            id=f"WM-{inizio.year}-{i + 1:04d}", inserzionista=inserzionista, settore=settore,
            formato=str(formato), segmento=str(segmento), aeroporti=[str(a) for a in aeroporti],
            inizio=inizio, fine=fine, creativita_in_ritardo=ritardo, profilo_erogazione=profilo,
        ))
    return campagne


def genera_righe(campagne: list[Campagna], rng: np.random.Generator) -> pd.DataFrame:
    righe = []
    sconti_fuori_policy = set(rng.choice([c.id for c in campagne], size=7, replace=False))
    for c in campagne:
        base, dwell_base, qr_base = FORMATI[c.formato]
        terminal = {a: str(rng.choice(AEROPORTI[a][1])) for a in c.aeroporti}
        giorni = [c.inizio + timedelta(days=d) for d in range((c.fine - c.inizio).days + 1)]
        giorni = [g for g in giorni if INIZIO_PERIODO <= g <= DATA_ESTRAZIONE]  # campagne a cavallo del periodo: dati parziali

        # Pianificato: calcolato sull'intero flight (anche oltre la data di estrazione) per lo sconto volume
        def pianificato_giorno(aeroporto: str, g: date) -> float:
            return base * AEROPORTI[aeroporto][0] * STAGIONALITA[g.month] * CRESCITA_ANNUA[g.year]

        tot_pianificato = sum(
            pianificato_giorno(a, c.inizio + timedelta(days=d))
            for a in c.aeroporti for d in range((c.fine - c.inizio).days + 1)
        )
        sconto = sconto_volume(tot_pianificato)
        if c.id in sconti_fuori_policy:
            sconto = round(float(rng.uniform(0.28, 0.35)), 2)  # oltre il massimo consentito (sconto volume + 5%)
        elif rng.random() < 0.25:
            sconto += round(float(rng.uniform(0.0, SCONTO_EXTRA_MAX)), 2)  # extra approvato, entro policy
        cpm_listino = LISTINO_CPM[c.formato]
        cpm_contrattuale = round(cpm_listino * (1 - sconto), 2)
        frequenza = rng.uniform(1.6, 2.4)
        tasso_erogazione = {
            "regolare": rng.uniform(0.97, 1.07),
            "sotto": rng.uniform(0.84, 0.935),
            "ritardo": rng.uniform(0.80, 0.92),  # creatività arrivate tardi: partenza ritardata
        }[c.profilo_erogazione]

        for a in c.aeroporti:
            for g in giorni:
                pianificate = int(round(pianificato_giorno(a, g) * rng.normal(1.0, 0.03)))
                tasso = tasso_erogazione * rng.normal(1.0, 0.025)
                if a == "VCE" and LAVORI_VCE[0] <= g <= LAVORI_VCE[1]:
                    tasso *= rng.uniform(0.70, 0.82)
                if c.profilo_erogazione == "ritardo" and (g - c.inizio).days < 3:
                    tasso *= 0.25  # primi giorni quasi senza erogazione
                erogate = max(0, int(round(pianificate * tasso)))
                reach = int(round(erogate / frequenza))
                dwell = max(3.0, rng.normal(dwell_base, dwell_base * 0.12))
                tasso_qr = qr_base * MOLTIPLICATORE_SEGMENTO_QR[c.segmento]
                if c.settore == "Lusso" and a in ("FCO", "MXP"):
                    tasso_qr *= 1.7  # hub internazionali: audience alto-spendente più ricettiva
                if c.formato == "Baggage Claim Wall":
                    tasso_qr *= 0.8
                qr = int(rng.binomial(erogate, min(tasso_qr, 0.2)))
                conversioni = int(rng.binomial(qr, rng.uniform(0.08, 0.20)))
                righe.append({
                    "data": g,
                    "id_campagna": c.id,
                    "inserzionista": c.inserzionista,
                    "settore": c.settore,
                    "aeroporto": a,
                    "terminal": terminal[a],
                    "formato": c.formato,
                    "segmento_audience": c.segmento,
                    "data_inizio_flight": c.inizio,
                    "data_fine_flight": c.fine,
                    "impression_pianificate": pianificate,
                    "impression_erogate": erogate,
                    "reach": reach,
                    "dwell_medio_sec": round(dwell, 1),
                    "scansioni_qr": qr,
                    "conversioni": conversioni,
                    "cpm_listino": cpm_listino,
                    "cpm_contrattuale": cpm_contrattuale,
                    "spesa_eur": round(erogate * cpm_contrattuale / 1000, 2),
                    "creativita_in_ritardo": c.creativita_in_ritardo,
                })
    df = pd.DataFrame(righe).sort_values(["data", "id_campagna", "aeroporto"]).reset_index(drop=True)
    df.insert(0, "id_riga", [f"R{i + 1:06d}" for i in range(len(df))])
    return df


# --- Iniezione delle anomalie ----------------------------------------------------------

def sporca(df: pd.DataFrame, rng: np.random.Generator) -> tuple[pd.DataFrame, dict]:
    df = df.copy()
    n = len(df)
    log: dict[str, int] = {}

    def campiona(frazione: float, maschera: pd.Series | None = None) -> pd.Index:
        candidati = df.index if maschera is None else df.index[maschera]
        k = int(round(n * frazione))
        return pd.Index(rng.choice(candidati, size=min(k, len(candidati)), replace=False))

    # Valori numerici mancanti o impossibili
    idx = campiona(0.012)
    df.loc[idx, "impression_erogate"] = np.nan
    log["impression_erogate_mancanti"] = len(idx)
    idx = campiona(0.004, df["impression_erogate"].notna() & (df["impression_erogate"] > 0))
    df.loc[idx, "impression_erogate"] = -df.loc[idx, "impression_erogate"]
    log["impression_erogate_negative"] = len(idx)
    idx = campiona(0.015)
    df.loc[idx, "spesa_eur"] = np.nan
    log["spesa_mancante"] = len(idx)
    idx = campiona(0.003, df["impression_erogate"] > 1000)
    df.loc[idx, "scansioni_qr"] = (df.loc[idx, "impression_erogate"] * rng.uniform(2, 5, len(idx))).round()
    log["scansioni_qr_maggiori_di_impression"] = len(idx)
    idx = campiona(0.003)
    df.loc[idx, "dwell_medio_sec"] = rng.choice([0.0, 99999.0], size=len(idx))
    log["dwell_fuori_range"] = len(idx)
    idx = campiona(0.01)
    df.loc[idx, "segmento_audience"] = np.nan
    log["segmento_mancante"] = len(idx)

    # Formati incoerenti
    df["cpm_contrattuale"] = df["cpm_contrattuale"].astype(object)
    idx = campiona(0.15)
    df.loc[idx, "cpm_contrattuale"] = [f"{v:.2f}".replace(".", ",") + " €" for v in df.loc[idx, "cpm_contrattuale"]]
    log["cpm_come_testo_valuta"] = len(idx)

    df["data"] = df["data"].astype(object)
    idx = campiona(0.20)
    df.loc[idx, "data"] = [d.strftime("%d/%m/%Y") for d in df.loc[idx, "data"]]
    log["date_formato_gg_mm_aaaa"] = len(idx)
    idx = campiona(0.08, df["data"].map(lambda v: isinstance(v, date)))
    df.loc[idx, "data"] = [f"{d.day} {MESI_IT[d.month - 1]} {d.year}" for d in df.loc[idx, "data"]]
    log["date_formato_testuale"] = len(idx)
    df["data"] = df["data"].map(lambda v: v.isoformat() if isinstance(v, date) else v)

    varianti_settore = {
        "Lusso": ["lusso", "LUSSO ", "Luxury"], "Moda": ["moda", "Fashion"],
        "Food & Beverage": ["Food&Beverage", "food & beverage"], "Tecnologia": ["Tech", "tecnologia"],
    }
    idx = campiona(0.06, df["settore"].isin(varianti_settore))
    df.loc[idx, "settore"] = [rng.choice(varianti_settore[s]) for s in df.loc[idx, "settore"]]
    log["settore_scritto_diversamente"] = len(idx)
    idx = campiona(0.02)
    df.loc[idx, "aeroporto"] = [rng.choice([a.lower(), f" {a}", f"{a} "]) for a in df.loc[idx, "aeroporto"]]
    log["aeroporto_scritto_diversamente"] = len(idx)

    df["creativita_in_ritardo"] = df["creativita_in_ritardo"].astype(object)
    idx = campiona(0.05)
    df.loc[idx, "creativita_in_ritardo"] = [
        rng.choice(["sì", "si", "1"]) if v else rng.choice(["no", "0"]) for v in df.loc[idx, "creativita_in_ritardo"]
    ]
    log["creativita_flag_testuale"] = len(idx)

    # Duplicati esatti (stesso id_riga): export ripetuto dal sistema di ad serving
    idx = campiona(0.02)
    df = pd.concat([df, df.loc[idx]]).sort_values(["id_riga"], kind="stable").reset_index(drop=True)
    log["righe_duplicate"] = len(idx)
    return df, log


# --- Pulizia di riferimento (regole di data/dizionario_dati.md) ------------------------

SETTORI_CANONICI = {
    "lusso": "Lusso", "luxury": "Lusso", "moda": "Moda", "fashion": "Moda", "beauty": "Beauty",
    "automotive": "Automotive", "finanza": "Finanza", "travel": "Travel",
    "food & beverage": "Food & Beverage", "food&beverage": "Food & Beverage",
    "telco": "Telco", "tecnologia": "Tecnologia", "tech": "Tecnologia",
}


def _parse_data(v) -> pd.Timestamp:
    s = str(v).strip()
    parti = s.split()
    if len(parti) == 3 and parti[1].lower() in MESI_IT:
        return pd.Timestamp(int(parti[2]), MESI_IT.index(parti[1].lower()) + 1, int(parti[0]))
    if "/" in s:
        return pd.to_datetime(s, format="%d/%m/%Y")
    return pd.to_datetime(s, format="%Y-%m-%d")


def _parse_cpm(v) -> float:
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).replace("€", "").strip()
    if "," in s:  # formato italiano "1.234,50": il punto separa le migliaia
        s = s.replace(".", "").replace(",", ".")
    return float(s)  # formato già numerico "16.2": il punto è il separatore decimale


def _parse_bool(v) -> bool:
    return str(v).strip().lower() in {"true", "1", "sì", "si", "yes"}


def reference_clean(raw: pd.DataFrame) -> pd.DataFrame:
    df = raw.drop_duplicates(subset="id_riga", keep="first").copy()
    df["data"] = df["data"].map(_parse_data)
    df["data_inizio_flight"] = pd.to_datetime(df["data_inizio_flight"])
    df["data_fine_flight"] = pd.to_datetime(df["data_fine_flight"])
    df["aeroporto"] = df["aeroporto"].str.strip().str.upper()
    df["settore"] = df["settore"].str.strip().str.lower().map(SETTORI_CANONICI)
    df["segmento_audience"] = df["segmento_audience"].fillna("Non classificato")
    df["cpm_contrattuale"] = df["cpm_contrattuale"].map(_parse_cpm)
    df["creativita_in_ritardo"] = df["creativita_in_ritardo"].map(_parse_bool)
    df.loc[df["impression_erogate"] < 0, "impression_erogate"] = np.nan
    df["riga_valida"] = df["impression_erogate"].notna()
    mancante = df["spesa_eur"].isna() & df["riga_valida"]
    df.loc[mancante, "spesa_eur"] = (df.loc[mancante, "impression_erogate"] * df.loc[mancante, "cpm_contrattuale"] / 1000).round(2)
    df.loc[df["scansioni_qr"] > df["impression_erogate"], "scansioni_qr"] = np.nan
    df.loc[~df["dwell_medio_sec"].between(1, 1800), "dwell_medio_sec"] = np.nan
    return df.reset_index(drop=True)


# --- Ground truth ------------------------------------------------------------------------

def calcola_ground_truth(raw: pd.DataFrame, clean: pd.DataFrame, log: dict) -> dict:
    v = clean[clean["riga_valida"]]
    campagne = v.groupby("id_campagna").agg(
        inserzionista=("inserzionista", "first"), formato=("formato", "first"),
        fine=("data_fine_flight", "first"), ritardo=("creativita_in_ritardo", "first"),
        cpm=("cpm_contrattuale", "first"), cpm_listino=("cpm_listino", "first"),
        pianificate=("impression_pianificate", "sum"), erogate=("impression_erogate", "sum"),
    )
    campagne["tasso_erogazione"] = campagne["erogate"] / campagne["pianificate"]
    concluse = campagne[campagne["fine"] <= pd.Timestamp(DATA_ESTRAZIONE)]
    sotto = concluse[concluse["tasso_erogazione"] < SOGLIA_MAKE_GOOD]
    aventi_diritto = sotto[~sotto["ritardo"]].copy()
    aventi_diritto["valore_make_good_eur"] = ((aventi_diritto["pianificate"] - aventi_diritto["erogate"]) * aventi_diritto["cpm"] / 1000).round(2)
    esclusi = sotto[sotto["ritardo"]]

    # policy commerciale: lo sconto complessivo sul listino non può superare il 25%
    sconto_effettivo = 1 - campagne["cpm"] / campagne["cpm_listino"]
    fuori_policy = sconto_effettivo[sconto_effettivo > SCONTO_MASSIMO + 0.001]

    v_mese = v.assign(mese=v["data"].dt.to_period("M").astype(str))
    lusso = v[v["settore"] == "Lusso"].dropna(subset=["scansioni_qr"])
    qr_lusso = (lusso.groupby("aeroporto")["scansioni_qr"].sum() / lusso.groupby("aeroporto")["impression_erogate"].sum() * 100)
    cpm_eff = v.groupby("formato")["spesa_eur"].sum() / v.groupby("formato")["impression_erogate"].sum() * 1000
    vce = v[v["aeroporto"] == "VCE"].assign(mese=lambda d: d["data"].dt.to_period("M").astype(str))
    vce_mensile = vce.groupby("mese").apply(lambda d: d["impression_erogate"].sum() / d["impression_pianificate"].sum(), include_groups=False)

    return {
        "descrizione": "Valori veri calcolati con reference_clean() secondo le regole di data/dizionario_dati.md.",
        "data_estrazione": DATA_ESTRAZIONE.isoformat(),
        "righe_grezze": int(len(raw)),
        "righe_dopo_deduplica": int(len(clean)),
        "righe_valide_per_kpi_erogazione": int(clean["riga_valida"].sum()),
        "anomalie_iniettate": log,
        "n_campagne": int(clean["id_campagna"].nunique()),
        "totale_impression_erogate": int(v["impression_erogate"].sum()),
        "totale_spesa_eur": round(float(v["spesa_eur"].sum()), 2),
        "cpm_effettivo_per_formato": {k: round(float(x), 2) for k, x in cpm_eff.items()},
        "impression_erogate_per_mese": {k: int(x) for k, x in v_mese.groupby("mese")["impression_erogate"].sum().items()},
        "tasso_qr_lusso_per_aeroporto_pct": {k: round(float(x), 3) for k, x in qr_lusso.sort_values(ascending=False).items()},
        "tasso_erogazione_vce_per_mese": {k: round(float(x), 3) for k, x in vce_mensile.items()},
        "make_good": {
            "regola": "campagne concluse entro la data di estrazione, erogato < 95% del pianificato, creatività consegnate in tempo",
            "campagne_aventi_diritto": {
                i: {"inserzionista": r.inserzionista, "formato": r.formato,
                    "tasso_erogazione": round(float(r.tasso_erogazione), 4), "valore_eur": float(r.valore_make_good_eur)}
                for i, r in aventi_diritto.sort_values("valore_make_good_eur", ascending=False).iterrows()
            },
            "valore_totale_eur": round(float(aventi_diritto["valore_make_good_eur"].sum()), 2),
            "escluse_per_creativita_in_ritardo": sorted(esclusi.index.tolist()),
        },
        "campagne_sconto_fuori_policy": {i: round(float(x), 3) for i, x in fuori_policy.sort_values(ascending=False).items()},
    }


def main() -> None:
    rng = np.random.default_rng(SEED)
    pulito = genera_righe(genera_campagne(rng), rng)
    raw, log = sporca(pulito, rng)
    raw.to_csv(CSV_PATH, index=False)
    raw_riletto = pd.read_csv(CSV_PATH)  # il ground truth si calcola sul file così come lo leggerà l'agente
    clean = reference_clean(raw_riletto)
    gt = calcola_ground_truth(raw_riletto, clean, log)
    GROUND_TRUTH_PATH.write_text(json.dumps(gt, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"{CSV_PATH.name}: {len(raw)} righe, {gt['n_campagne']} campagne")
    print(f"make-good: {len(gt['make_good']['campagne_aventi_diritto'])} campagne, {gt['make_good']['valore_totale_eur']} EUR")
    print(f"sconti fuori policy: {len(gt['campagne_sconto_fuori_policy'])}")


if __name__ == "__main__":
    main()
