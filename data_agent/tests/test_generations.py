"""Id delle generazioni OpenRouter restituiti al back end per mostrare il modello che ha risposto davvero."""

from langchain_core.messages import AIMessage, HumanMessage

from app.agent import _generation_id


def test_id_della_generazione_openrouter():
    assert _generation_id(AIMessage("ok", response_metadata={"id": "gen-123-abc"})) == "gen-123-abc"


def test_messaggi_senza_id_openrouter_ignorati():
    assert _generation_id(AIMessage("ok", response_metadata={"id": "chatcmpl-1"})) is None
    assert _generation_id(AIMessage("ok")) is None
    assert _generation_id(HumanMessage("domanda")) is None
    assert _generation_id(None) is None
