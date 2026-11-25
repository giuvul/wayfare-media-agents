// Parser minimale di Server-Sent Events su fetch (EventSource non supporta POST).
// Riceve i pezzi di testo così come arrivano dalla rete e restituisce gli eventi completi.
export function createSseParser(onEvent) {
  let buffer = "";
  return (chunk) => {
    buffer += chunk.replace(/\r\n/g, "\n");
    let boundary;
    while ((boundary = buffer.indexOf("\n\n")) !== -1) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      let event = "message";
      const data = [];
      for (const line of block.split("\n")) {
        if (line.startsWith(":")) continue; // commento (keep-alive)
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
      }
      if (data.length) onEvent(event, JSON.parse(data.join("\n")));
    }
  };
}
