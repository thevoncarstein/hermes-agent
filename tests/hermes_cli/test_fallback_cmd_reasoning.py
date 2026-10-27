"""`hermes fallback add` / `reasoning`: a fallback's reasoning effort lives on its entry, never on the primary."""
from __future__ import annotations

import types
from pathlib import Path
from unittest.mock import patch

import pytest
import hermes_yaml as yaml


@pytest.fixture()
def isolated_home(tmp_path, monkeypatch):
    home = tmp_path / ".hermes"
    home.mkdir(exist_ok=True)
    monkeypatch.setenv("HERMES_HOME", str(home))
    return tmp_path


def _write_config(home: Path, data: dict) -> None:
    (home / ".hermes" / "config.yaml").write_text(yaml.safe_dump(data), encoding="utf-8")


def _read_config(home: Path) -> dict:
    return yaml.safe_load((home / ".hermes" / "config.yaml").read_text(encoding="utf-8")) or {}


def test_add_records_the_picked_effort_on_the_entry_and_keeps_the_primary_effort(isolated_home):
    _write_config(isolated_home, {
        "model": {"provider": "anthropic", "default": "claude-sonnet-4-6"},
        "agent": {"reasoning_effort": "xhigh"},
    })

    def fake_picker(args=None):
        # The real picker saves the model, then its effort step writes agent.reasoning_effort.
        from hermes_cli.config import load_config, save_config
        cfg = load_config()
        cfg["model"] = {"provider": "openrouter", "default": "openai/gpt-5.4-mini"}
        cfg["agent"]["reasoning_effort"] = "high"
        save_config(cfg)

    with patch("hermes_cli.main.select_provider_and_model", side_effect=fake_picker), \
            patch("hermes_cli.main._require_tty"):
        from hermes_cli.fallback_cmd import cmd_fallback_add
        cmd_fallback_add(types.SimpleNamespace())

    cfg = _read_config(isolated_home)
    assert cfg["agent"]["reasoning_effort"] == "xhigh"
    assert cfg["fallback_providers"] == [
        {"provider": "openrouter", "model": "openai/gpt-5.4-mini", "reasoning_effort": "high"}]


def test_reasoning_sets_and_clears_an_entry_effort(isolated_home):
    _write_config(isolated_home, {
        "model": {"provider": "anthropic", "default": "claude-sonnet-4-6"},
        "fallback_providers": [{"provider": "openrouter", "model": "openai/gpt-5.4-mini"}],
    })
    from hermes_cli.fallback_cmd import cmd_fallback_reasoning
    levels = patch("hermes_cli.main_provider_setup._main_model_reasoning_efforts", return_value=["low", "medium", "high"])
    levels.start()

    with patch("hermes_cli.setup._curses_prompt_choice", return_value=0), \
            patch("hermes_cli.main_provider_setup._prompt_reasoning_effort_selection", return_value="medium"):
        cmd_fallback_reasoning(types.SimpleNamespace())
    assert _read_config(isolated_home)["fallback_providers"][0]["reasoning_effort"] == "medium"

    # "" is the inherit row.
    with patch("hermes_cli.setup._curses_prompt_choice", return_value=0), \
            patch("hermes_cli.main_provider_setup._prompt_reasoning_effort_selection", return_value=""):
        cmd_fallback_reasoning(types.SimpleNamespace())
    assert "reasoning_effort" not in _read_config(isolated_home)["fallback_providers"][0]
    levels.stop()
