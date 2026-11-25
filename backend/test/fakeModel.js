// Modello finto e deterministico per i test: restituisce in ordine le risposte preparate, senza rete.
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage } from "@langchain/core/messages";

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
  async _generate() {
    const next = this.responses[this.calls++];
    if (next instanceof Error) throw next;
    const message = typeof next === "string" ? new AIMessage(next) : new AIMessage(next);
    return { generations: [{ text: typeof next === "string" ? next : "", message }] };
  }
}
