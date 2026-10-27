"""A fallback entry's own ``reasoning_effort`` wins over the main reasoning settings on activation."""

from types import SimpleNamespace
from unittest.mock import patch

from agent.route_binding import _reresolve_fallback_reasoning_config

_CONFIG = {"agent": {"reasoning_effort": "low", "reasoning_overrides": {"fb-model": "medium"}}}


def _agent():
    return SimpleNamespace(model="fb-model", reasoning_config={"enabled": True, "effort": "low"})


def test_entry_effort_beats_override_and_global():
    agent = _agent()
    with patch("hermes_cli.config.load_config", return_value=_CONFIG):
        _reresolve_fallback_reasoning_config(agent, {"provider": "p", "model": "fb-model", "reasoning_effort": "high"})
    assert agent.reasoning_config == {"enabled": True, "effort": "high"}


def test_entry_can_disable_reasoning():
    agent = _agent()
    with patch("hermes_cli.config.load_config", return_value=_CONFIG):
        _reresolve_fallback_reasoning_config(agent, {"provider": "p", "model": "fb-model", "reasoning_effort": False})
    assert agent.reasoning_config == {"enabled": False}


def test_entry_without_effort_keeps_the_override_ladder():
    agent = _agent()
    with patch("hermes_cli.config.load_config", return_value=_CONFIG):
        _reresolve_fallback_reasoning_config(agent, {"provider": "p", "model": "fb-model"})
    assert agent.reasoning_config == {"enabled": True, "effort": "medium"}
