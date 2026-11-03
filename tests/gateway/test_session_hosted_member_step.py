"""A canonical room member's live tool step reaches ``groups.state``: the member session's own execution
events name the member's current step, and a callback from a stale generation never does."""

from gateway.hosted_room_driver import TaskIdentity
from hermes_state_runtime import claim_session_input
from tui_gateway.hosted_room_member_activity import running_member_steps


def test_member_execution_events_name_its_current_step(hosted_owner):
    from gateway.session_contract import SessionRef
    from gateway.session_hosted_rpc import HostedRoomAuthorityRPC
    authority, loop, principal, _ = hosted_owner
    rpc = HostedRoomAuthorityRPC(authority, loop, room_id='room', member_id='member', profile='default',
                                 principal=principal, authorize=lambda *args: True)
    coords = dict(profile='default', source='bot_room')
    sid = rpc.create(**coords, title='Group: room')['session_id']
    rpc.submit(**coords, session_id=sid, prompt='input', task=TaskIdentity('room', 'task', 'thread', 'turn'),
               execution_generation=1, on_terminal=lambda receipt: None)
    row = claim_session_input(authority.db, epoch=authority.epoch, session_id=sid)
    authority._stamp_claim(SessionRef(authority.profile_id, sid), authority.sessions[sid], row)
    running = [('member', 'task')]

    # A late callback from another generation is not this turn's step.
    authority.publish_execution(sid, row['generation'] + 1, 'tool.start', {'name': 'terminal', 'context': 'rm -rf'})
    assert running_member_steps('room', running) == {}

    authority.publish_execution(sid, row['generation'], 'tool.start',
                                {'name': 'terminal', 'context': 'npm   test', 'args': {'command': 'npm test'}})
    assert running_member_steps('room', running) == {
        'member': {'kind': 'tool', 'tool': 'terminal', 'detail': 'npm test'}}
    authority.publish_execution(sid, row['generation'], 'message.delta', {'text': 'Done'})
    assert running_member_steps('room', running) == {'member': {'kind': 'writing'}}

    # The member's next turn starts with no step until it reports one.
    rpc.submit(**coords, session_id=sid, prompt='again', task=TaskIdentity('room', 'task-2', 'thread', 'turn-2'),
               execution_generation=1, on_terminal=lambda receipt: None)
    assert running_member_steps('room', [('member', 'task-2')]) == {}
