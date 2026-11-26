"""Lettura di DataFrame serializzati con pickle, senza eseguire codice arbitrario.

`pickle.load` può chiamare qualunque funzione importabile: un DataFrame prodotto dal codice generato dall'LLM
(o un file di cache alterato) potrebbe far eseguire comandi al server. Qui si ammettono solo le classi e le
funzioni di ricostruzione di pandas e numpy che servono a un DataFrame; tutto il resto viene rifiutato.
"""

from __future__ import annotations

import importlib
import io
import pickle
import re
from typing import IO, Any

# moduli da cui possono arrivare le classi dei dati (non I/O, non estensioni, non eval)
_ALLOWED_MODULES = re.compile(r"^(pandas|pandas\.(arrays|core(\.[\w.]+)?|_libs(\.[\w.]+)?)|numpy|numpy\._?core(\.\w+)?)$")
_DENIED_MODULES = re.compile(r"^pandas\.core\.(computation|config_init)|^pandas\.io|^numpy\.(lib|ctypeslib|f2py|testing)")
# funzioni (non classi) ammesse: solo quelle di ricostruzione usate dal protocollo pickle di pandas e numpy
_ALLOWED_FUNCTIONS = re.compile(r"^(_reconstruct|_new_Index|_unpickle\w*|__pyx_unpickle\w*|_frombuffer|scalar|new_block)$")
_DENIED_CLASSES = {"memmap", "DataSource", "HDFStore", "ExcelWriter", "ExcelFile"}
_BUILTINS = {"slice", "set", "frozenset", "complex", "range", "bytearray"}


class UnsafePickleError(pickle.UnpicklingError):
    """Il file fa riferimento a qualcosa che un DataFrame non contiene."""


class _RestrictedUnpickler(pickle.Unpickler):
    def find_class(self, module: str, name: str) -> Any:
        if module == "builtins":
            if name in _BUILTINS:
                return super().find_class(module, name)
        elif _ALLOWED_MODULES.match(module) and not _DENIED_MODULES.match(module) and name not in _DENIED_CLASSES:
            obj = getattr(importlib.import_module(module), name, None)
            origin = getattr(obj, "__module__", "") or ""
            if _DENIED_MODULES.match(origin) or name in _DENIED_CLASSES:
                pass
            elif isinstance(obj, type) or (callable(obj) and _ALLOWED_FUNCTIONS.match(name)):
                return obj
        raise UnsafePickleError(f"riferimento non ammesso in un DataFrame: {module}.{name}")


def load(fh: IO[bytes]) -> Any:
    return _RestrictedUnpickler(fh).load()


def loads(data: bytes) -> Any:
    return load(io.BytesIO(data))


def load_path(path) -> Any:
    with open(path, "rb") as fh:
        return load(fh)
