"""Stall and collapse detectors for a text stop: whether the final reply is a dangling
announcement of the next action or a degenerate fragment, so the turn re-prompts instead of ending.

Split out of ``agent/agent_runtime_helpers.py`` (code-health size ratchet); read by
``agent/turn_final_response.py``.
"""

import re
from typing import Any


# Degenerate-final detector (#103483): after real tool work a text stop whose ENTIRE answer is a
# fragment — a stray wrong-script word ("пар" in an English conversation), a token starting
# mid-punctuation ("?warming up") — is a provider-side collapse, not an answer, yet the loop
# accepted it and the turn reported completed. Shape alone cannot PROVE a collapse, so this is
# deliberately narrower than "short": a terse legitimate answer ("42", "SQLite", "report.csv",
# "€12.50", "你好。", "Done.", ":8080", "да" to a Russian prompt) never matches, English-script
# fragments ("the", "ing") are knowingly not covered, and the re-prompt it triggers asks for the
# same answer again if it was complete. ``turn_finalizer._SENTENCE_END`` encodes a sibling
# "≤ 24 chars, no terminal" heuristic for the finish explainer.
_DEGENERATE_FINAL_MAX_CHARS = 24
_SENTENCE_TERMINALS = (".", "!", "?", "\u3002", "\uff01", "\uff1f")
# Punctuation no answer begins with when a letter follows ("?warming"); "$5", "#123", "-1",
# "/tmp", ".env", "(a)", ":8080", ":)", ";;" all stay answers.
_DEGENERATE_LEADING_PUNCT = "?!,;:)]}"


def looks_like_degenerate_final(text: str, user_message: Any = None) -> bool:
    """Whether a text stop reads as a collapsed fragment rather than a (terse) answer.

    "Wrong script" is judged against the conversation: when the user's own message carries
    non-ASCII letters, a terse non-Latin reply ("是", "Готово") is an answer, not a collapse.
    """
    t = (text or "").strip()
    if not t or len(t) > _DEGENERATE_FINAL_MAX_CHARS or t.endswith(_SENTENCE_TERMINALS):
        return False
    if t[0] in _DEGENERATE_LEADING_PUNCT and len(t) > 1 and t[1].isalpha():
        return True
    if not any(ch.isalpha() for ch in t) or any(ch.isascii() and ch.isalnum() for ch in t):
        return False
    from agent.codex_responses_adapter import _summarize_user_message_for_log
    user_text = _summarize_user_message_for_log(user_message) if user_message else ""
    return not any(ch.isalpha() and not ch.isascii() for ch in user_text)


def tool_results_this_turn(messages: list[dict[str, Any]]) -> int:
    """Tool-result rows after the most recent user row — whether the turn did real tool work.

    ANY user row ends the window, the continuation nudges included: that is what bounds the
    degenerate-final guard to one re-prompt per collapse. Skipping synthetic user rows here
    would turn it into a two-nudge loop.
    """
    count = 0
    for msg in reversed(messages or ()):
        if not isinstance(msg, dict):
            continue
        if msg.get("role") == "user":
            break
        if msg.get("role") == "tool":
            count += 1
    return count


# Narrow "trailing continue-intent" detector for the stall guard (agent.stall_guards): only the
# message TAIL announcing a next action, so mid-sentence "I will" never trips it.
_TRAILING_CONTINUE_INTENT_RE = re.compile(
    r"(?:\blet me now\b|\bi(?:['\u2019])?ll now\b|\bi will now\b"
    r"|\bnow i(?:['\u2019]ll| will)\b|\bnext[,:] i\b|\bnow,? let me\b(?!\s+know\b))"
    r"[^.!?\n]{0,100}[.:\u2026]?\s*$", re.IGNORECASE,
)

# After tool work this turn, a reply whose LAST sentence is "Let me <act> ..." is a stalled step,
# not an answer: the model just read tool output and announced the next call without making it.
# Without tool work the same tail is ordinary prose, so it never fires there. "Let me know" is an
# offer, and a colon or "!" means the content (or a remark) was delivered in that sentence.
_TRAILING_LET_ME_AFTER_TOOLS_RE = re.compile(
    r"(?:^|[.!?\u2026\n]\s*)let me\b(?!\s+know\b)[^.!?:\n]{1,160}[.\u2026]?\s*$", re.IGNORECASE,
)

# Content longer than this is a substantive reply, not a dangling ack.
_TRAILING_CONTINUE_INTENT_MAX_CHARS = 400


def trailing_continue_intent(text: str, *, after_tool_work: bool = False) -> bool:
    """Whether ``text`` is a short reply ENDING on an announced next action (stall-guard re-prompt trigger).

    ``after_tool_work``: the turn ran tools since the last user row, which widens the trigger to a
    bare "Let me <act> ..." final sentence.
    """
    t = (text or "").strip()
    if not t or len(t) > _TRAILING_CONTINUE_INTENT_MAX_CHARS:
        return False
    tail = t[-200:]
    return bool(
        _TRAILING_CONTINUE_INTENT_RE.search(tail)
        or (after_tool_work and _TRAILING_LET_ME_AFTER_TOOLS_RE.search(tail))
    )


# Broader tail detector for PROMOTED REASONING only (reasoning-only clean stop with tools offered
# and no tool call). Visible content keeps the narrow ``let me now`` shape above because a real
# reply legitimately says "I'll" mid-text; chain-of-thought that ENDS on a first-person plan
# ("Let me batch the terminal calls and run them in parallel.", "I need to check the log.") is a
# stalled model whose turn would otherwise report "complete" with zero tool calls (#111761).
# Tail-only and anchored on the last sentence, so reasoning that merely mentions a plan before
# stating its answer ("...Let me check. The answer is 42.") still promotes.
# Thai (unsegmented script, so no \b after the trigger, unlike the English group) shares the same
# tail shape: a first-person future-action marker immediately followed by more Thai text, often
# preceded by an em/en dash rather than sentence punctuation (#116495). Trigger glosses, in
# pattern order: "I will give you" / "I will", "next I('ll)" + one of {start,try,check,fix,send,
# do,look}, "please let me" + one of {start,try,check,fix,send,do,look}, "I('ll)" + one of
# {start,try,check,fix,send,do,look,run,fire}.
_PROMOTED_REASONING_PLAN_TAIL_RE = re.compile(
    r"(?:^|[.!?:\u3002\uff01\uff1f\u2014\u2013\n]\s*|\u2026\s*)"
    r"(?:let(?:['\u2019]s| me)\b|i(?:['\u2019]ll| will| need to| should| am going to|['\u2019]m going to)\b"
    r"|next[,:]? i\b|now i(?:['\u2019]ll| will| need to)\b|first[,:]? i(?:['\u2019]ll| will| need to)\b"
    r"|\u0e08\u0e30\u0e43\u0e2b\u0e49\u0e1c\u0e21|\u0e1c\u0e21\u0e08\u0e30"
    r"|\u0e15\u0e48\u0e2d\u0e44\u0e1b(?:\u0e08\u0e30|\u0e1c\u0e21\u0e08\u0e30)"
    r"|\u0e02\u0e2d(?:\u0e40\u0e23\u0e34\u0e48\u0e21|\u0e25\u0e2d\u0e07|\u0e15\u0e23\u0e27\u0e08|\u0e41\u0e01\u0e49|\u0e2a\u0e48\u0e07|\u0e17\u0e33|\u0e14\u0e39)"
    r"|\u0e08\u0e30(?:\u0e40\u0e23\u0e34\u0e48\u0e21|\u0e25\u0e2d\u0e07|\u0e15\u0e23\u0e27\u0e08|\u0e41\u0e01\u0e49|\u0e2a\u0e48\u0e07|\u0e17\u0e33|\u0e14\u0e39|\u0e23\u0e31\u0e19|\u0e22\u0e34\u0e07))"
    r"[^.!?\n\u3002\uff01\uff1f]{0,160}(?:[.:\u2026]+)?\s*$",
    re.IGNORECASE,
)


def promoted_reasoning_announces_action(text: str) -> bool:
    """Whether promoted reasoning ENDS on a first-person plan to act (stall, not an answer).

    No overall length cap: the reasoning block of a stalled model is often 300-1600 chars of
    planning monologue; only the tail decides.
    """
    t = (text or "").strip()
    if not t:
        return False
    return bool(_PROMOTED_REASONING_PLAN_TAIL_RE.search(t[-240:]))
