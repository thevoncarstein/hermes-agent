"""Project a hosted room member's live runtime events to the ``on_room_member_activity`` plugin hook.

A member turn runs on a hidden ``room_plumbing`` session with no client transport, so the tool /
approval / streaming frames the turn loop already emits bottom out at stdio and are lost. Between
``turn.started`` and ``turn.settled`` in the durable room log a client sees nothing. This module
re-routes those frames, stamped with the room coordinates the session carries in
``_hosted_room_task``, to plugins — off the token path, through the same bounded per-consumer
queues the ``on_stream_*`` observers use. Nothing is written to the room log: deltas at room-log
byte budgets would exhaust a room in minutes, and checkpoint replay must stay a pure function of
the durable events.

The same frames also keep each member's CURRENT step (running a tool, thinking, writing) in memory,
which ``groups.state`` attaches to that member's ``member_activity`` row so a client can say what the
member is doing, not only that it is busy. Only the latest step is kept, never a history.
"""

from __future__ import annotations

import threading
from collections.abc import Iterable, Mapping
from typing import Any

HOOK_NAME = "on_room_member_activity"

# Session event frame ``type`` -> room activity ``kind``. Frames not listed (session.info,
# status.update, message.start/complete, ...) are session chrome, not member activity.
KIND_BY_FRAME_TYPE: Mapping[str, str] = {
    "tool.start": "tool.started",
    "tool.complete": "tool.completed",
    "tool.output_risk": "tool.output_risk",
    "message.delta": "message.delta",
    "message.interim": "message.interim",
    "reasoning.delta": "reasoning.delta",
    "error": "turn.error",
}

_COORDINATE_FIELDS = ("room_id", "thread_id", "member_id", "turn_id", "task_id", "execution_generation")


def emit_room_member_activity(hosted_task: Mapping[str, Any], *, kind: str, payload: Mapping[str, Any] | None,
                              seq: int | None = None) -> bool:
    """Queue one activity event for every registered consumer; False when nobody listens."""
    from agent.plugin_stream_hooks import enqueue_plugin_stream_hook

    coordinates = {field: hosted_task.get(field) for field in _COORDINATE_FIELDS}
    return enqueue_plugin_stream_hook(HOOK_NAME, **coordinates, kind=kind, seq=seq, payload=dict(payload or {}))


# Server→client request frames (``{"id": "srq-…", "method": …}``) that are member activity.
KIND_BY_REQUEST_METHOD: Mapping[str, str] = {"approval": "request.opened"}


def project_room_member_activity(frame: Mapping[str, Any], sessions: Mapping[str, Mapping[str, Any]]) -> bool:
    """Fire the hook for an outgoing session frame (event notification or server→client request) when its
    session is running a room turn."""
    params = frame.get("params")
    if not isinstance(params, Mapping):
        return False
    if frame.get("method") == "event":
        kind = KIND_BY_FRAME_TYPE.get(str(params.get("type") or ""))
        payload = params.get("payload")
    elif "id" in frame:
        kind = KIND_BY_REQUEST_METHOD.get(str(frame.get("method") or ""))
        payload = {k: v for k, v in params.items() if k != "session_id"}
    else:
        return False
    if kind is None:
        return False
    session = sessions.get(str(params.get("session_id") or ""))
    hosted_task = session.get("_hosted_room_task") if isinstance(session, Mapping) else None
    if not isinstance(hosted_task, Mapping):
        return False
    payload = payload if isinstance(payload, Mapping) else None
    if frame.get("method") == "event":
        record_member_step(str(hosted_task.get("room_id") or ""), str(hosted_task.get("member_id") or ""),
                           step_for_event(str(params.get("type") or ""), payload),
                           task_id=hosted_task.get("task_id"))
    return emit_room_member_activity(hosted_task, kind=kind, payload=payload, seq=params.get("seq"))


# ── Current step per member ──────────────────────────────────────────────────────────────────────

# Session event type -> the step a member is on once that event fires; ``tool.start`` names the tool.
_STEP_BY_EVENT_TYPE: Mapping[str, str] = {
    "tool.complete": "thinking",
    "agent.step": "thinking",
    "reasoning.delta": "thinking",
    "thinking.delta": "thinking",
    "message.delta": "writing",
    "message.interim": "writing",
}
_MAX_STEP_DETAIL = 80

# (room_id, member_id) -> step. Room ids are minted unique per room, so one process serving several
# profiles' rooms never shares a key. A canonical member session reports by session id, mapped here.
_steps: dict[tuple[str, str], dict[str, Any]] = {}
_member_sessions: dict[str, tuple[str, str]] = {}
_steps_lock = threading.Lock()


def step_for_event(event_type: str, payload: Mapping[str, Any] | None) -> dict[str, Any] | None:
    """The step an event puts a member on, or None when it says nothing about what the member does."""
    payload = payload or {}
    if event_type == "tool.start":
        step = {"kind": "tool", "tool": str(payload.get("name") or payload.get("tool_name") or "tool")}
        if detail := " ".join(str(payload.get("context") or "").split())[:_MAX_STEP_DETAIL]:
            step["detail"] = detail
        return step
    kind = _STEP_BY_EVENT_TYPE.get(event_type)
    # A ``message.delta`` with no text is a segment boundary, not writing.
    if kind is None or (kind == "writing" and not payload.get("text")):
        return None
    return {"kind": kind}


def record_member_step(room_id: str, member_id: str, step: Mapping[str, Any] | None, *,
                       task_id: Any = None) -> None:
    if step is None or not room_id or not member_id:
        return
    entry = {**step, "task_id": str(task_id)} if task_id else dict(step)
    with _steps_lock:
        _steps[(room_id, member_id)] = entry


def clear_member_step(room_id: str, member_id: str) -> None:
    with _steps_lock:
        _steps.pop((room_id, member_id), None)


def bind_member_session(session_id: str, room_id: str, member_id: str) -> None:
    """A canonical member session (``gateway/session_hosted_rpc.py``) reports its events by session id."""
    with _steps_lock:
        _member_sessions[session_id] = (room_id, member_id)


def record_session_event(session_id: str, event_type: str, payload: Mapping[str, Any] | None) -> None:
    """Hot path (every streamed token): one dict read for a session that is not a room member."""
    member = _member_sessions.get(session_id)
    if member is not None:
        record_member_step(*member, step_for_event(event_type, payload))


def running_member_steps(room_id: str, running: Iterable[tuple[str, str]]) -> dict[str, dict[str, Any]]:
    """The step of each running ``(member_id, task_id)``; a member no longer running is forgotten,
    and a step recorded for an earlier task of the same member is not reported for this one."""
    running = dict(running)
    with _steps_lock:
        for key in [key for key in _steps if key[0] == room_id and key[1] not in running]:
            del _steps[key]
        steps = {member: dict(_steps[(room_id, member)]) for member in running if (room_id, member) in _steps}
    return {member: {k: v for k, v in step.items() if k != "task_id"} for member, step in steps.items()
            if step.get("task_id", running[member]) == running[member]}
