// Modello finto e deterministico per i test: restituisce in ordine le risposte preparate, senza rete.
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage, AIMessageChunk } from "@langchain/core/messages";
import { ChatGenerationChunk } from "@langchain/core/outputs";

export class ScriptedChatModel extends BaseChatModel {
  constructor(responses) {
    super({});
    this.responses = responses;
    this.calls = 0;
  }
  _llmType() {
    return "scripted";
  }
  bindTools() {
    return this;
  }
  /** Come un provider reale: prima il testo a pezzi, poi i frammenti della chiamata allo strumento. */
  async *_streamResponseChunks(_messages, _options, runManager) {
    const next = this.responses[this.calls++];
    if (next instanceof Error) throw next;
    const { content = "", tool_calls: calls = [] } = typeof next === "string" ? { content: next } : next;
    const id = `scripted-${this.calls}`; // come un provider reale: un id diverso per ogni chiamata
    for (let i = 0; i < content.length; i += 7) {
      const text = content.slice(i, i + 7);
      const chunk = new ChatGenerationChunk({ text, message: new AIMessageChunk({ content: text, id }) });
      yield chunk;
      await runManager?.handleLLMNewToken(text, undefined, undefined, undefined, undefined, { chunk }); // stream "messages"
    }
    for (const [index, c] of calls.entries()) {
      const chunk = new ChatGenerationChunk({
        text: "",
        message: new AIMessageChunk({ content: "", id, tool_call_chunks: [{ id: c.id, name: c.name, args: JSON.stringify(c.args), index, type: "tool_call_chunk" }] }),
      });
      yield chunk;
      await runManager?.handleLLMNewToken("", undefined, undefined, undefined, undefined, { chunk });
    }
  }

  async _generate() {
    const next = this.responses[this.calls++];
    if (next instanceof Error) throw next;
    const message = typeof next === "string" ? new AIMessage(next) : new AIMessage(next);
    return { generations: [{ text: typeof next === "string" ? next : "", message }] };
  }
}
