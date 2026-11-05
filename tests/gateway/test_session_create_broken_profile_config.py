"""A profile whose config.yaml cannot be parsed refuses session.create by name, not as a crash.

The terminal policy fails closed on an unparseable profile config (tools/terminal_scope.py), and that
refusal escaped the authority dispatch as an exception the WebSocket boundary answered as -32603
``internal error``: the desktop showed "Session unavailable: internal error" with no hint that a merge
had left conflict markers in the profile's config.yaml.
"""
import json
from types import SimpleNamespace

import pytest

_CONFLICTED = """<<<<<<< HEAD
model:
  default: local-model
=======
model:
  default: remote-model
>>>>>>> origin/main
"""


def _owner(home, monkeypatch):
    from gateway import run
    from gateway.config import GatewayConfig
    from gateway.session import SessionStore
    from gateway.session_authority import SessionAuthority
    from gateway.session_controls import AuthorityConnection
    import hermes_state_runtime as rt
    home.mkdir(parents=True, exist_ok=True)
    (home / 'config.yaml').write_text(json.dumps({'model': {'default': 'm'}}))
    monkeypatch.setenv('HERMES_HOME', str(home))
    monkeypatch.setattr(run, '_hermes_home', home)
    store = SessionStore(home / 'sessions', GatewayConfig())
    db = store._db
    runner = SimpleNamespace(session_store=store, _session_db=db, adapters={}, _draining=False,
                             _evict_cached_agent=lambda route: None, _cached_agent_for=lambda route: None,
                             _handle_message=None, _peek_session_state=lambda key: None)
    runner._adapter_for_source = lambda source: runner.adapters.get(source.platform)
    authority = SessionAuthority(runner, profile_id='creative', instance_id='owner', db=db,
                                 epoch=rt.begin_runtime_epoch(db, instance_id='owner'))
    runner.session_authority = authority
    return store, authority, AuthorityConnection(authority, object(), {'user_id': 'human'})


@pytest.mark.asyncio
async def test_create_on_a_profile_with_a_conflicted_config_names_the_file(tmp_path, monkeypatch, caplog):
    home = tmp_path / 'root' / 'profiles' / 'creative'
    store, authority, owner = _owner(home, monkeypatch)
    (home / 'config.yaml').write_text(_CONFLICTED)
    try:
        with caplog.at_level('WARNING', logger='gateway.session_controls'):
            response = await owner.dispatch({'id': 'c1', 'method': 'session.create', 'params': dict(
                request_id='c1', source='gui', cwd=str(tmp_path), toolsets=[], model='m')})
        error = response['error']
        assert error['data'] == {'reason': 'profile_config_unavailable', 'file': 'config.yaml'}
        # The desktop toast shows the message verbatim only under 180 characters.
        assert 'config.yaml' in error['message'] and len(error['message']) < 180
        assert str(home) not in error['message']
        assert not authority.sessions
        # The operator keeps the parser's own diagnosis, with the line it choked on.
        assert any('profile_config_unavailable' in record.getMessage() and 'line 2' in record.getMessage()
                   for record in caplog.records)

        (home / 'config.yaml').write_text(json.dumps({'model': {'default': 'm'}}))
        fixed = await owner.dispatch({'id': 'c2', 'method': 'session.create', 'params': dict(
            request_id='c2', source='gui', cwd=str(tmp_path), toolsets=[], model='m')})
        assert 'result' in fixed, fixed
    finally:
        await owner.close()
        store.close_all_db_handles()


def test_the_refusal_scope_keeps_the_file_a_later_read_names(tmp_path):
    """Production reaches the dispatch through the refusal scope a turn binds up front, not the direct
    raise: the file to fix must survive that hop."""
    from tools.terminal_scope import (
        TerminalPolicyUnavailable, prepare_profile_terminal_scope, reset_terminal_scope, set_terminal_scope,
        terminal_env)
    (tmp_path / 'config.yaml').write_text(_CONFLICTED)
    token = set_terminal_scope(prepare_profile_terminal_scope(tmp_path))
    try:
        with pytest.raises(TerminalPolicyUnavailable) as raised:
            terminal_env('TERMINAL_CWD')
    finally:
        reset_terminal_scope(token)
    assert raised.value.filename == 'config.yaml'
