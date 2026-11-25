// Modelli di embedding eseguibili in locale (ONNX quantizzato int8, via Transformers.js).
// Catalogo curato e non "qualsiasi modello": ogni famiglia vuole il suo pooling e i suoi prefissi
// (E5 si aspetta "query: " e "passage: "), e i requisiti di memoria sono stati misurati.
//
// Revisioni e hash sono fissati: si scarica sempre esattamente lo stesso file, verificato con SHA-256.
// ramMb = picco di memoria misurato durante l'indicizzazione dell'handbook (40 passaggi, blocchi da 8),
// arrotondato per eccesso; msPerChunk = tempo misurato su 4 vCPU.

export const LOCAL_MODELS = [
  {
    id: "Xenova/multilingual-e5-small",
    name: "Multilingual E5 Small",
    revision: "761b726dd34fb83930e26aab4e9ac3899aa1fa78",
    dims: 384,
    pooling: "mean",
    queryPrefix: "query: ",
    passagePrefix: "passage: ",
    license: "MIT",
    ramMb: 700,
    msPerChunk: 105,
    description: "Il più leggero. Qualità buona su testi italiani, adatto anche a macchine piccole.",
    files: [
      { path: "config.json", size: 658 },
      { path: "tokenizer_config.json", size: 443 },
      { path: "tokenizer.json", size: 17082730, sha256: "0b44a9d7b51c3c62626640cda0e2c2f70fdacdc25bbbd68038369d14ebdf4c39" },
      { path: "onnx/model_quantized.onnx", size: 118308185, sha256: "f80102d3f2a1229f387d3c81909990d8945513e347b0eab049f7de3c6f98c193" },
    ],
  },
  {
    id: "Xenova/multilingual-e5-base",
    name: "Multilingual E5 Base",
    revision: "1ec9243030a27d1a115d5c340572074c125b58b2",
    dims: 768,
    pooling: "mean",
    queryPrefix: "query: ",
    passagePrefix: "passage: ",
    license: "MIT",
    ramMb: 900,
    msPerChunk: 305,
    description: "Compromesso tra qualità e risorse: vettori più ricchi, circa tre volte più lento del Small.",
    files: [
      { path: "config.json", size: 686 },
      { path: "tokenizer_config.json", size: 418 },
      { path: "tokenizer.json", size: 17082660, sha256: "62c24cdc13d4c9952d63718d6c9fa4c287974249e16b7ade6d5a85e7bbb75626" },
      { path: "onnx/model_quantized.onnx", size: 278647662, sha256: "df7a9a29309e3ad491e1783adf8baee710262cc06079c7cbab63c630277fac94" },
    ],
  },
  {
    id: "Xenova/bge-m3",
    name: "BGE-M3",
    revision: "4de13258303883538bd53b696b452bf8099f0858",
    dims: 1024,
    pooling: "cls",
    queryPrefix: "",
    passagePrefix: "",
    license: "MIT",
    ramMb: 1300,
    msPerChunk: 1020,
    description: "Il più accurato tra quelli locali e con testi lunghi, ma richiede più memoria ed è lento senza GPU.",
    files: [
      { path: "config.json", size: 770 },
      { path: "tokenizer_config.json", size: 1173 },
      { path: "tokenizer.json", size: 17082821, sha256: "6710678b12670bc442b99edc952c4d996ae309a7020c1fa0096dd245c2faf790" },
      { path: "onnx/model_quantized.onnx", size: 569694530, sha256: "0826f8c1ab9edf1801db86c61919d4d108e8bfc0b809ec823ad366882ff0b77d" },
    ],
  },
];

export const findLocalModel = (id) => LOCAL_MODELS.find((m) => m.id === id) ?? null;
export const downloadSizeMb = (m) => Math.round(m.files.reduce((s, f) => s + f.size, 0) / 1e6);
