// Risorse della macchina (o del container) e valutazione dei modelli di embedding locali.
// Nei container i limiti veri sono quelli del cgroup, non la RAM e le CPU dell'host: si leggono entrambi.
import { existsSync, readFileSync, statfsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { downloadSizeMb } from "./catalog.js";

// piattaforme per cui onnxruntime-node include i binari precompilati (solo CPU)
const SUPPORTED = new Set(["linux-x64", "linux-arm64", "darwin-arm64", "win32-x64", "win32-arm64"]);
const MB = 1024 * 1024;

const read = (file) => {
  try {
    return readFileSync(file, "utf8").trim();
  } catch {
    return null;
  }
};

function cgroupMemory() {
  const max = read("/sys/fs/cgroup/memory.max") ?? read("/sys/fs/cgroup/memory/memory.limit_in_bytes");
  const current = read("/sys/fs/cgroup/memory.current") ?? read("/sys/fs/cgroup/memory/memory.usage_in_bytes");
  const limit = max && max !== "max" ? Number(max) : null;
  // cgroup v1 senza limite riporta un numero enorme
  return limit && limit < os.totalmem() ? { limit, current: Number(current) || 0 } : null;
}

function cgroupCpus() {
  const [quota, period] = (read("/sys/fs/cgroup/cpu.max") ?? "max").split(" ");
  return quota !== "max" && Number(period) > 0 ? Number(quota) / Number(period) : null;
}

function memAvailable() {
  const line = read("/proc/meminfo")?.split("\n").find((l) => l.startsWith("MemAvailable:"));
  return line ? Number(line.split(/\s+/)[1]) * 1024 : os.freemem();
}

function diskFree(dir) {
  let probe = path.resolve(dir);
  while (!existsSync(probe) && path.dirname(probe) !== probe) probe = path.dirname(probe);
  try {
    const s = statfsSync(probe);
    return s.bavail * s.bsize;
  } catch {
    return null;
  }
}

export function machineInfo(modelsDir) {
  const libc = process.platform === "linux" ? (process.report.getReport().header.glibcVersionRuntime ? "glibc" : "musl") : null;
  const cg = cgroupMemory();
  const cpuLimit = cgroupCpus();
  const total = cg ? Math.min(cg.limit, os.totalmem()) : os.totalmem();
  const available = cg ? Math.min(memAvailable(), cg.limit - cg.current) : memAvailable();
  const free = diskFree(modelsDir);
  return {
    platform: process.platform,
    arch: process.arch,
    libc,
    runtimeSupported: SUPPORTED.has(`${process.platform}-${process.arch}`) && libc !== "musl",
    container: existsSync("/.dockerenv") || cg !== null,
    cpus: Math.max(1, Math.floor(Math.min(os.availableParallelism(), cpuLimit ?? Infinity))),
    memTotalMb: Math.round(total / MB),
    memAvailableMb: Math.round(Math.max(0, available) / MB),
    memLimitedByContainer: cg !== null,
    diskFreeMb: free === null ? null : Math.round(free / MB),
  };
}

/**
 * Giudizio su un modello per questa macchina: ok | limite | insufficiente | non_supportato, con le ragioni.
 * La RAM richiesta è il picco misurato durante l'indicizzazione; serve margine per il resto del servizio.
 */
export function assessModel(model, machine, { downloaded = false, chunks = 40 } = {}) {
  const reasons = [];
  if (!machine.runtimeSupported) {
    const why = machine.libc === "musl"
      ? "le immagini basate su musl (es. Alpine) non sono supportate dal runtime ONNX: usa un'immagine Debian/Ubuntu"
      : `piattaforma ${machine.platform}-${machine.arch} non supportata dal runtime ONNX`;
    return { verdict: "non_supportato", reasons: [why], indexSeconds: null };
  }
  let verdict = "ok";
  const worse = (v) => {
    const order = ["ok", "limite", "insufficiente"];
    if (order.indexOf(v) > order.indexOf(verdict)) verdict = v;
  };

  const need = model.ramMb;
  const avail = machine.memAvailableMb;
  if (avail >= need * 1.5) reasons.push(`Memoria: servono circa ${need} MB, disponibili ${avail} MB.`);
  else if (avail >= need * 1.1) {
    worse("limite");
    reasons.push(`Memoria al limite: servono circa ${need} MB, disponibili ${avail} MB. Funziona, ma lascia poco margine agli altri servizi.`);
  } else {
    worse("insufficiente");
    reasons.push(`Memoria insufficiente: servono circa ${need} MB, disponibili solo ${avail} MB${machine.memLimitedByContainer ? " (limite del container)" : ""}.`);
  }

  if (!downloaded) {
    const size = downloadSizeMb(model);
    if (machine.diskFreeMb !== null && machine.diskFreeMb < size * 1.2) {
      worse("insufficiente");
      reasons.push(`Spazio su disco insufficiente: il download è di ${size} MB, liberi ${machine.diskFreeMb} MB.`);
    } else reasons.push(`Download una tantum di ${size} MB.`);
  } else reasons.push("Già scaricato.");

  const indexSeconds = Math.round(((model.msPerChunk * 4) / machine.cpus) * chunks / 1000);
  if (machine.cpus < 2) {
    worse("limite");
    reasons.push(`Una sola CPU: l'indicizzazione di ${chunks} passaggi richiede circa ${indexSeconds} s.`);
  } else reasons.push(`Indicizzazione stimata: circa ${indexSeconds} s per ${chunks} passaggi con ${machine.cpus} CPU.`);

  return { verdict, reasons, indexSeconds };
}
