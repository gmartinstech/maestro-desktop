"""Agent run entry points for AgentManager: launch a new top-level run and the
invoke_agent helper (fork-and-send a sub-agent). The no-SDK mock fallback lives in MockAgent.
Split into a mixin to keep the manager file under the size ceiling; self.run_agent_loop /
self.sessions resolve across the MRO exactly as before."""

import logging
import os
from datetime import datetime
from uuid import uuid4

from typing import Dict, List, Optional

from typeguard import typechecked

from backend.apps.agents.core.models import (
    AgentConfig, AgentSession, Message, MessageBranch,
)
from backend.apps.agents.core.ws_manager import ws_manager
from backend.apps.settings.settings import load_settings
from backend.config.state_paths import home_state_dir, p_state_home
from backend.apps.agents.manager.session.session_store import load_session_data
from backend.apps.agents.manager.session.apply_context_window import apply_context_window
from backend.apps.agents.manager.session.workspace_git import (
    detect_git_identity,
    ensure_cwd_git_repo,
)
from backend.apps.agents.manager.prompt.tool_catalog import get_all_tool_names
from backend.apps.agents.manager.prompt.prompt_context import resolve_mode

logger = logging.getLogger(__name__)


from backend.apps.agents.manager.AgentManagerProtocol import AgentManagerProtocol


class AgentLaunch(AgentManagerProtocol):
    @typechecked
    async def launch_agent(self, config: AgentConfig) -> AgentSession:
        session_id = uuid4().hex
        # Phase log: a silent prompt drop used to leave NOTHING in the log to reason from. Each phase below names itself so a future one is diagnosable from a user's backend.log alone. Prompt length only, never its content.
        carried = len((config.initial_message.prompt if config.initial_message else "") or "")
        logger.info(
            "[launch %s] phase=start mode=%s model=%s target_dir=%s carries_prompt=%s prompt_chars=%d",
            session_id, config.mode, config.model, bool(config.target_directory), config.initial_message is not None, carried,
        )

        # Editing an existing App: when the user selected exactly one App card in App Builder mode, point the chat at that app's workspace so it edits in place. Without this the view-builder seed below fires (no target_directory) and registers a fresh empty "Untitled App" dupe.
        if (
            config.mode == "view-builder"
            and not config.target_directory
            and config.selected_app_output_ids
            and len(config.selected_app_output_ids) == 1
        ):
            from backend.apps.outputs.workspace_io import app_workspace_dir
            bound = app_workspace_dir(config.selected_app_output_ids[0])
            if bound:
                config.target_directory = bound

        mode_tools, _, mode_folder = resolve_mode(config.mode, get_all_tool_names)
        tools = mode_tools

        global_settings = load_settings()
        effective_cwd = (
            config.target_directory
            or mode_folder
            or global_settings.default_folder
            or p_state_home()
        )

        if config.mode in ("view-builder", "skill-builder") and not config.target_directory:
            effective_cwd = os.path.join(effective_cwd, session_id)

        os.makedirs(effective_cwd, exist_ok=True)
        logger.info("[launch %s] phase=cwd_resolved cwd=%s", session_id, effective_cwd)

        # Canvas-chat App Builder launch: when the user picks "App Builder" mode from the chat-input dropdown (no preexisting workspace, no target_directory passed in), the legacy code path only created an empty folder, so the agent could write files but the app never showed up in the Apps sidebar (no Output row, which is what the sidebar reads). Mirror the /workspace/seed endpoint's behavior here: seed the React template + register an Output row with workspace_id = session_id. Idempotent; safe if the session is ever re-launched with the same id.
        if config.mode == "view-builder" and not config.target_directory:
            try:
                from backend.apps.outputs.outputs import (
                    ensure_webapp_workspace_seeded_and_registered,
                )
                from backend.apps.outputs.workspace_io import load as load_output
                output_id = ensure_webapp_workspace_seeded_and_registered(
                    workspace_id=session_id,
                    folder=effective_cwd,
                    session_id=session_id,
                )
                logger.info("[launch %s] phase=workspace_seeded output_id=%s", session_id, output_id)
                if output_id:
                    # Broadcast the new row so the Apps sidebar lights up immediately, even before the user clicks into it. The row name is still the placeholder ("Untitled App") at this point; the post-session meta-sync below fires a second upsert with the real name once the agent has written meta.json.
                    try:
                        new_output = load_output(output_id)
                        await ws_manager.broadcast_global("agent:output_upserted", {
                            "output": new_output.model_dump(mode="json"),
                        })
                    except Exception:
                        logger.exception("post-seed output_upserted broadcast failed")
            except Exception:
                logger.exception(
                    "view-builder workspace seed/register failed; session will "
                    "still launch but the app may not appear in Apps sidebar"
                )

        # If the fallback chain landed on the state-home directory (no project dir, no default_folder set), re-route to a dedicated scratch workspace under <state_home>/.maestro/workspaces/<session_id>. This prevents us from writing .git/ (or anything else) into the real $HOME (or MAESTRO_STATE_HOME override) directly and gives the CLI's Agent tool a clean repo to do worktree isolation inside. Users with a default_folder or target_directory set keep whatever they configured.
        home = p_state_home()
        if os.path.abspath(effective_cwd) == os.path.abspath(home):
            effective_cwd = home_state_dir("workspaces", session_id)
            os.makedirs(effective_cwd, exist_ok=True)

        ensure_cwd_git_repo(effective_cwd, home)

        repo_url, branch_name = detect_git_identity(effective_cwd)

        session = AgentSession(
            id=session_id,
            name=config.name,
            provider=getattr(config, "provider", "anthropic"),
            model=config.model,
            mode=config.mode,
            system_prompt=config.system_prompt,
            allowed_tools=tools,
            max_turns=config.max_turns,
            cwd=effective_cwd,
            repo_url=repo_url,
            branch=branch_name,
            dashboard_id=config.dashboard_id,
            workflow_run_id=config.workflow_run_id,
            workflow_edit_id=config.workflow_edit_id,
            thinking_level=getattr(global_settings, "default_thinking_level", "auto"),
        )
        apply_context_window(session, global_settings)
        self.sessions[session_id] = session


        await ws_manager.send_to_session(session_id, "agent:status", {
            "session_id": session_id,
            "status": "running",
            "session": session.model_dump(mode="json"),
        })

        try:
            from backend.apps.service.analytics.client import track_agent_created
            track_agent_created(id=session.id, dashboard_id=session.dashboard_id)
        except Exception:
            pass

        # The session exists and is registered; delivery of any carried prompt happens next, in the endpoint, and logs its own phase.
        logger.info("[launch %s] phase=session_registered awaiting_prompt=%s", session_id, config.initial_message is not None)
        return session

    @typechecked
    async def invoke_agent(
        self,
        source_session_id: str,
        message: str,
        parent_session_id: Optional[str] = None,
        dashboard_id: Optional[str] = None,
    ) -> Dict:
        """Fork an existing session and send it a new message, returning the result."""
        source = self.sessions.get(source_session_id)
        if not source:
            data = load_session_data(source_session_id)
            if data is None:
                raise ValueError(f"Session {source_session_id} not found")
            source = AgentSession(**data)
            apply_context_window(source)

        source_name = source.name

        old_to_new_msg: Dict[str, str] = {}
        new_messages: List[Message] = []
        for msg in source.messages:
            new_id = uuid4().hex
            old_to_new_msg[msg.id] = new_id
            new_messages.append(Message(
                id=new_id,
                role=msg.role,
                content=msg.content,
                timestamp=msg.timestamp,
                branch_id=msg.branch_id,
                parent_id=old_to_new_msg.get(msg.parent_id) if msg.parent_id else None,
                # Sub-agents do NOT inherit parent's attached files. Each parent-message base64-expansion would re-fire in the sub-agent (cost explosion: a 25 MB PDF in parent + 5 InvokeAgent calls = 125 MB transmitted). The sub-agent receives the user's new message only; if it needs the file content, the parent message text from the prior turn already carries the model's summary.
                context_paths=None,
                attached_skills=msg.attached_skills,
                forced_tools=msg.forced_tools,
                images=msg.images,
            ))

        new_branches: Dict[str, MessageBranch] = {}
        for bid, branch in source.branches.items():
            new_branches[bid] = MessageBranch(
                id=bid,
                parent_branch_id=branch.parent_branch_id,
                fork_point_message_id=(
                    old_to_new_msg.get(branch.fork_point_message_id)
                    if branch.fork_point_message_id else None
                ),
                created_at=branch.created_at,
            )

        fork = AgentSession(
            id=uuid4().hex,
            name=f"{source_name} (invoked)",
            status="running",
            model=source.model,
            mode="invoked-agent",
            sdk_session_id=source.sdk_session_id,
            system_prompt=source.system_prompt,
            allowed_tools=list(source.allowed_tools),
            max_turns=source.max_turns or 25,
            cwd=source.cwd,
            created_at=datetime.now(),
            messages=new_messages,
            branches=new_branches,
            active_branch_id=source.active_branch_id,
            tool_group_meta=dict(source.tool_group_meta),
            dashboard_id=dashboard_id or source.dashboard_id,
            parent_session_id=parent_session_id,
        )
        apply_context_window(fork)

        self.sessions[fork.id] = fork

        await ws_manager.broadcast_global("agent:status", {
            "session_id": fork.id,
            "status": fork.status,
            "session": fork.model_dump(mode="json"),
        })

        user_msg = Message(
            role="user",
            content=message,
            branch_id=fork.active_branch_id,
        )
        fork.messages.append(user_msg)
        await ws_manager.send_to_session(fork.id, "agent:message", {
            "session_id": fork.id,
            "message": user_msg.model_dump(mode="json"),
        })

        await self.run_agent_loop(fork.id, message, fork_session=True)

        last_assistant = None
        for msg in reversed(fork.messages):
            if msg.role == "assistant":
                content = msg.content
                if isinstance(content, str):
                    last_assistant = content
                elif isinstance(content, list):
                    texts = [b.get("text", "") for b in content if isinstance(b, dict) and b.get("type") == "text"]
                    last_assistant = "\n".join(texts)
                else:
                    last_assistant = str(content)
                break

        return {
            "forked_session_id": fork.id,
            "source_name": source_name,
            "response": last_assistant or "No response from invoked agent.",
            "cost_usd": fork.cost_usd,
        }
