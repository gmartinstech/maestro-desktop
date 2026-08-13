from pydantic import BaseModel, Field
from typing import Optional, Any, Literal

from backend.apps.settings.provedor_ia import PROVEDOR_IA_DEFAULT_MODEL

DEFAULT_SYSTEM_PROMPT = (
    "You are a personal AI assistant running inside Maestro.\n\n"
    "## Core Behavior\n"
    "Act, don't ask. When a tool can accomplish the task, call it immediately; "
    "do not describe what you would do, do not ask for confirmation, just execute. "
    "The user expects results, not plans.\n"
    "If ANY available tool is relevant to the user's request, use it. Never respond "
    'with "I can do X for you" or "Would you like me to..."; just do it. '
    "A tool call is always better than a text explanation of what the tool would do.\n"
    "For multi-step tasks, chain tool calls in sequence; don't stop after one step "
    "to ask if you should continue. Complete the entire task, then report the results.\n"
    "Be adaptable. If one approach fails, try a different tool or strategy instead of "
    "giving up or repeating the same action. Always stay focused on what the user "
    "actually wants to accomplish; their intent matters more than the specific method.\n\n"
    "## Tool Priority\n"
    "1. Connected MCP tools; fastest and most reliable. Use ToolSearch to discover "
    "what integrations are available if you're unsure.\n"
    "2. WebSearch / WebFetch; for general web lookups when no MCP tool fits.\n"
    "3. BrowserAgent; last resort, only for visual interaction with websites, "
    "filling forms, or tasks no other tool can handle.\n\n"
    "## Style\n"
    "Do not narrate routine tool calls; just call the tool.\n"
    "After tool calls complete, present the results directly. Do not recap which "
    "tools you called or why; the user can see tool calls in the UI.\n"
    "Keep responses brief and direct. Use plain language.\n"
    "If you genuinely need clarification on something ambiguous, use the "
    "AskUserQuestion tool. Never ask questions inline in plain text.\n"
)

DEFAULT_SYSTEM_PROMPT_PT_BR = (
    "Você é um assistente de IA pessoal rodando dentro do Maestro.\n\n"
    "## Comportamento Principal\n"
    "Aja, não pergunte. Quando uma ferramenta pode executar a tarefa, chame-a imediatamente; "
    "não descreva o que faria, não peça confirmação, apenas execute. "
    "O usuário espera resultados, não planos.\n"
    "Se QUALQUER ferramenta disponível for relevante para o pedido do usuário, use-a. Nunca responda "
    'com "Posso fazer X para você" ou "Gostaria que eu..."; apenas faça. '
    "Uma chamada de ferramenta é sempre melhor que uma explicação de texto do que a ferramenta faria.\n"
    "Para tarefas em múltiplas etapas, encadeie as chamadas de ferramenta em sequência; não pare após uma etapa "
    "para perguntar se deve continuar. Conclua a tarefa inteira e depois reporte os resultados.\n"
    "Seja adaptável. Se uma abordagem falhar, tente uma ferramenta ou estratégia diferente em vez de "
    "desistir ou repetir a mesma ação. Sempre mantenha o foco no que o usuário "
    "realmente quer realizar; sua intenção importa mais que o método específico.\n\n"
    "## Prioridade de Ferramentas\n"
    "1. Ferramentas MCP conectadas; mais rápidas e confiáveis. Use ToolSearch para descobrir "
    "quais integrações estão disponíveis se não tiver certeza.\n"
    "2. WebSearch / WebFetch; para buscas gerais na web quando nenhuma ferramenta MCP se encaixa.\n"
    "3. BrowserAgent; último recurso, apenas para interação visual com sites, "
    "preenchimento de formulários ou tarefas que nenhuma outra ferramenta pode fazer.\n\n"
    "## Estilo\n"
    "Não narre as chamadas de ferramenta rotineiras; apenas chame a ferramenta.\n"
    "Após as chamadas de ferramenta serem concluídas, apresente os resultados diretamente. Não recapitule quais "
    "ferramentas chamou ou por quê; o usuário pode ver as chamadas de ferramenta na interface.\n"
    "Mantenha respostas breves e diretas. Use linguagem simples.\n"
    "Se realmente precisar de esclarecimento sobre algo ambíguo, use a "
    "ferramenta AskUserQuestion. Nunca faça perguntas em texto simples inline.\n"
)


class AppSettings(BaseModel):
    default_system_prompt: Optional[str] = DEFAULT_SYSTEM_PROMPT
    default_folder: Optional[str] = None
    # provedor-ia's fast model; apply_provedor_ia_defaults downgrades it to "sonnet" when there is no token to reach the gateway with.
    default_model: str = PROVEDOR_IA_DEFAULT_MODEL
    default_mode: str = "agent"
    default_max_turns: Optional[int] = None
    default_thinking_level: Literal["off", "low", "medium", "high", "auto"] = "auto"
    zoom_sensitivity: float = 50.0
    theme: str = "light"
    # User's explicit UI language choice; None means unset (pre-migration or fresh install), NOT a third language. Distinct from `locale` below (the detected OS locale, used for telemetry/env).
    language: Optional[Literal["pt-BR", "en"]] = None
    # Shared across App Builder workspaces (each runs its own vite port / localStorage origin); null = follow system.
    app_template_theme_override: Optional[Literal["light", "dark"]] = None
    new_agent_shortcut: str = "Meta+l"
    anthropic_api_key: Optional[str] = None
    browser_homepage: str = "https://www.google.com"
    openai_api_key: Optional[str] = None
    google_api_key: Optional[str] = None
    openrouter_api_key: Optional[str] = None
    # provedor-ia bearer; also readable from the PROVEDOR_IA_TOKEN env var.
    provedor_ia_token: Optional[str] = None
    custom_providers: list["CustomProvider"] = Field(default_factory=list)
    auto_select_mode_on_new_agent: bool = False
    expand_new_chats_in_dashboard: bool = True
    auto_reveal_sub_agents: bool = True
    dev_mode: bool = False
    allow_experimental_updates: bool = False
    claude_subscription_token: Optional[str] = None
    openai_subscription_token: Optional[str] = None
    gemini_subscription_token: Optional[str] = None
    user_name: Optional[str] = None
    user_email: Optional[str] = None
    user_use_case: Optional[str] = None
    user_referral_source: Optional[str] = None
    # Suppresses preflight suggestion modal entries the user dismissed; keyed by ToolDefinition.name, value ISO timestamp.
    dismissed_mcp_suggestions: dict[str, str] = Field(default_factory=dict)
    analytics_opt_in: bool = True
    installation_id: Optional[str] = None
    # Minted once by the analytics SDK's register() and reused forever; server-owned.
    analytics_token: Optional[str] = None
    # Renderer-reported browser Intl values, stamped on analytics submissions; server-owned.
    timezone: Optional[str] = None
    locale: Optional[str] = None
    first_opened_at: Optional[str] = None
    connection_mode: str = "own_key"
    maestro_bearer_token: Optional[str] = None
    maestro_proxy_url: Optional[str] = None
    # Server-owned identity; user_email above is the self-reported onboarding value.
    user_id: Optional[str] = None
    signin_method: Optional[Literal["google", "stripe", "email"]] = None
    # Runtime preflight (electron/preflight.js). Default-on; users opt out via this flag, env var MAESTRO_DISABLE_PREFLIGHT=1, or the cloud-side cohort rollout knocking preflight_rollout_pct down.
    preflight_enabled: bool = True
    # 0-100; the cohort gate compares (hash(installation_id) % 100) < pct. 100 = everyone, 0 = nobody, used as the kill switch if a staged rollout finds a false-positive spike.
    preflight_rollout_pct: int = 100


class CustomProvider(BaseModel):
    name: str
    base_url: str
    api_key: str = ""
    models: list[dict[str, Any]] = Field(default_factory=list)
