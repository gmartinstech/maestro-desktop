import i18n from '@/shared/i18n/i18n';

export interface ToolLabel {
  present: string;
  past: string;
}

// djb2 hash; same seed always picks the same variant so rows don't flicker.
function _stableIndex(seed: string | undefined, n: number): number {
  if (n <= 1 || !seed) return 0;
  let h = 5381;
  for (let i = 0; i < seed.length; i++) {
    h = ((h << 5) + h + seed.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % n;
}

function _pick<T>(variants: T[], seed?: string): T {
  return variants[_stableIndex(seed, variants.length)];
}

// Index 0 is the safe default; single-entry pools mean no seeded variation.
const EN_VARIANTS: Record<string, ToolLabel[]> = {
  read: [
    { present: 'Reading', past: 'Read' },
    { present: 'Skimming', past: 'Skimmed' },
    { present: 'Peeking at', past: 'Peeked at' },
    { present: 'Glancing at', past: 'Glanced at' },
    { present: 'Diving into', past: 'Dove into' },
    { present: 'Eyeballing', past: 'Eyeballed' },
    { present: 'Cracking open', past: 'Cracked open' },
  ],
  write: [
    { present: 'Writing', past: 'Wrote' },
    { present: 'Saving', past: 'Saved' },
    { present: 'Jotting down', past: 'Jotted down' },
    { present: 'Drafting', past: 'Drafted' },
    { present: 'Putting together', past: 'Put together' },
    { present: 'Penning', past: 'Penned' },
  ],
  edit: [
    { present: 'Editing', past: 'Edited' },
    { present: 'Tweaking', past: 'Tweaked' },
    { present: 'Polishing', past: 'Polished' },
    { present: 'Touching up', past: 'Touched up' },
    { present: 'Refining', past: 'Refined' },
    { present: 'Tuning', past: 'Tuned' },
  ],
  multiedit: [
    { present: 'Editing', past: 'Edited' },
    { present: 'Tweaking', past: 'Tweaked' },
    { present: 'Reworking', past: 'Reworked' },
    { present: 'Patching up', past: 'Patched up' },
    { present: 'Touching up', past: 'Touched up' },
  ],
  strreplace: [
    { present: 'Editing', past: 'Edited' },
    { present: 'Tweaking', past: 'Tweaked' },
    { present: 'Swapping in', past: 'Swapped in' },
  ],
  bash: [
    { present: 'Running command', past: 'Ran command' },
    { present: 'Cooking up', past: 'Cooked up' },
    { present: 'Working on it', past: 'Worked on it' },
    { present: 'Tinkering', past: 'Tinkered' },
    { present: 'Crunching', past: 'Crunched' },
  ],
  glob: [
    { present: 'Hunting for files', past: 'Found files' },
    { present: 'Scanning files', past: 'Scanned files' },
    { present: 'Browsing files', past: 'Browsed files' },
    { present: 'Sniffing out files', past: 'Sniffed out files' },
    { present: 'Rounding up files', past: 'Rounded up files' },
  ],
  grep: [
    { present: 'Searching files', past: 'Searched files' },
    { present: 'Combing through', past: 'Combed through' },
    { present: 'Hunting through', past: 'Hunted through' },
    { present: 'Digging through', past: 'Dug through' },
    { present: 'Sifting through', past: 'Sifted through' },
  ],
  ripgrep: [
    { present: 'Searching files', past: 'Searched files' },
    { present: 'Combing through', past: 'Combed through' },
    { present: 'Digging through', past: 'Dug through' },
  ],
  ls: [
    { present: 'Listing folder', past: 'Listed folder' },
    { present: 'Peeking inside', past: 'Peeked inside' },
    { present: 'Poking around in', past: 'Poked around in' },
  ],
  websearch: [
    { present: 'Searching the web', past: 'Searched the web' },
    { present: 'Googling', past: 'Googled' },
    { present: 'Crawling the web', past: 'Scoured the web' },
    { present: 'Trawling the web', past: 'Trawled the web' },
    { present: 'Hunting online', past: 'Hunted online' },
  ],
  webfetch: [
    { present: 'Reading webpage', past: 'Read webpage' },
    { present: 'Peeking at', past: 'Peeked at' },
    { present: 'Pulling up', past: 'Pulled up' },
    { present: 'Loading up', past: 'Loaded up' },
    { present: 'Skimming', past: 'Skimmed' },
  ],
  notebookedit: [
    { present: 'Editing notebook', past: 'Edited notebook' },
    { present: 'Tweaking notebook', past: 'Tweaked notebook' },
  ],
  todowrite: [
    { present: 'Updating the plan', past: 'Updated the plan' },
    { present: 'Jotting down a plan', past: 'Jotted down a plan' },
    { present: 'Sketching a plan', past: 'Sketched a plan' },
    { present: 'Mapping it out', past: 'Mapped it out' },
    { present: 'Pencilling in steps', past: 'Pencilled in steps' },
  ],
  todoread: [
    { present: 'Checking the plan', past: 'Checked the plan' },
    { present: 'Glancing at the plan', past: 'Glanced at the plan' },
  ],
  taskcreate: [
    { present: 'Starting a side task', past: 'Started a side task' },
    { present: 'Kicking off a side task', past: 'Kicked off a side task' },
    { present: 'Spinning off a side task', past: 'Spun off a side task' },
  ],
  taskupdate: [
    { present: 'Updating task', past: 'Updated task' },
    { present: 'Nudging the task', past: 'Nudged the task' },
  ],
  taskoutput: [
    { present: 'Peeking at the task', past: 'Peeked at the task' },
    { present: 'Checking on the task', past: 'Checked on the task' },
  ],
  taskstop: [
    { present: 'Stopping the task', past: 'Stopped the task' },
    { present: 'Wrapping up the task', past: 'Wrapped up the task' },
  ],
  tasklist: [
    { present: 'Listing tasks', past: 'Listed tasks' },
    { present: 'Rounding up tasks', past: 'Rounded up tasks' },
  ],
  taskget: [
    { present: 'Loading task', past: 'Loaded task' },
    { present: 'Pulling up the task', past: 'Pulled up the task' },
  ],
  toolsearch: [
    { present: 'Looking through the toolbox', past: 'Looked through the toolbox' },
    { present: 'Hunting for the right tool', past: 'Found a tool' },
    { present: 'Browsing the toolbox', past: 'Browsed the toolbox' },
    { present: 'Rummaging the toolbox', past: 'Rummaged the toolbox' },
    { present: 'Digging through the toolbox', past: 'Dug through the toolbox' },
  ],
  mcpsearch: [
    { present: 'Looking through the toolbox', past: 'Looked through the toolbox' },
    { present: 'Hunting for the right tool', past: 'Found a tool' },
    { present: 'Browsing the toolbox', past: 'Browsed the toolbox' },
    { present: 'Rummaging the toolbox', past: 'Rummaged the toolbox' },
  ],
  // getToolLabelWithInput has the brand-aware version; this is the seedless fallback.
  mcpactivate: [
    { present: 'Connecting', past: 'Connected' },
    { present: 'Plugging in', past: 'Plugged in' },
    { present: 'Hooking up', past: 'Hooked up' },
    { present: 'Wiring up', past: 'Wired up' },
    { present: 'Linking up', past: 'Linked up' },
  ],
  mcplist: [
    { present: 'Listing tools', past: 'Listed tools' },
    { present: 'Browsing the toolbox', past: 'Browsed the toolbox' },
  ],
  settingsread: [
    { present: 'Checking your settings', past: 'Checked your settings' },
    { present: 'Reading your settings', past: 'Read your settings' },
    { present: 'Looking at your settings', past: 'Looked at your settings' },
  ],
  settingswrite: [
    { present: 'Updating your settings', past: 'Updated your settings' },
    { present: 'Saving your settings', past: 'Saved your settings' },
    { present: 'Adjusting your settings', past: 'Adjusted your settings' },
  ],
  outputactivate: [
    { present: 'Loading the app', past: 'Loaded the app' },
    { present: 'Spinning up the app', past: 'Spun up the app' },
    { present: 'Wiring up the app', past: 'Wired up the app' },
  ],
  outputlist: [
    { present: 'Browsing apps', past: 'Browsed apps' },
    { present: 'Listing apps', past: 'Listed apps' },
  ],
  outputsearch: [
    { present: 'Hunting for the right app', past: 'Found an app' },
    { present: 'Browsing apps', past: 'Browsed apps' },
    { present: 'Sifting through apps', past: 'Sifted through apps' },
  ],
  renderoutput: [
    { present: 'Showing the app', past: 'Showed the app' },
    { present: 'Painting the app', past: 'Painted the app' },
    { present: 'Mounting the app', past: 'Mounted the app' },
    { present: 'Bringing up the app', past: 'Brought up the app' },
  ],
  askuserquestion: [
    { present: 'Asking', past: 'Asked' },
    { present: 'Checking with you', past: 'Checked with you' },
    { present: 'Pinging you', past: 'Pinged you' },
  ],
  invokeagent: [
    { present: 'Sending a copilot', past: 'Sent a copilot' },
    { present: 'Asking a helper', past: 'Asked a helper' },
    { present: 'Calling in backup', past: 'Called in backup' },
    { present: 'Tagging in a helper', past: 'Tagged in a helper' },
  ],
  agent: [
    { present: 'Spinning up a helper', past: 'Spun up a helper' },
    { present: 'Sending a copilot', past: 'Sent a copilot' },
    { present: 'Calling in backup', past: 'Called in backup' },
    { present: 'Hatching a helper', past: 'Hatched a helper' },
  ],
  createbrowseragent: [
    { present: 'Opening a browser', past: 'Opened a browser' },
    { present: 'Firing up a browser', past: 'Fired up a browser' },
    { present: 'Booting up a browser', past: 'Booted up a browser' },
  ],
  browseragent: [
    { present: 'Driving the browser', past: 'Drove the browser' },
    { present: 'Using the browser', past: 'Used the browser' },
    { present: 'Steering the browser', past: 'Steered the browser' },
  ],
  browseragents: [
    { present: 'Driving the browsers', past: 'Drove the browsers' },
    { present: 'Steering the browsers', past: 'Steered the browsers' },
  ],
  enterplanmode: [
    { present: 'Switching to plan mode', past: 'Switched to plan mode' },
    { present: 'Stepping into plan mode', past: 'Stepped into plan mode' },
  ],
  exitplanmode: [
    { present: 'Leaving plan mode', past: 'Left plan mode' },
    { present: 'Stepping out of plan mode', past: 'Stepped out of plan mode' },
  ],
  enterworktree: [
    { present: 'Setting up a workspace', past: 'Set up a workspace' },
    { present: 'Carving out a workspace', past: 'Carved out a workspace' },
  ],
  exitworktree: [
    { present: 'Cleaning up the workspace', past: 'Cleaned up the workspace' },
    { present: 'Tearing down the workspace', past: 'Tore down the workspace' },
  ],
  pushnotification: [
    { present: 'Notifying', past: 'Notified' },
    { present: 'Pinging you', past: 'Pinged you' },
    { present: 'Tapping your shoulder', past: 'Tapped your shoulder' },
  ],
  remotetrigger: [
    { present: 'Triggering', past: 'Triggered' },
    { present: 'Pulling the trigger', past: 'Pulled the trigger' },
  ],
  croncreate: [
    { present: 'Scheduling', past: 'Scheduled' },
    { present: 'Setting a reminder', past: 'Set a reminder' },
    { present: 'Pinning to the calendar', past: 'Pinned to the calendar' },
    { present: 'Lining up a check-in', past: 'Lined up a check-in' },
  ],
  cronlist: [
    { present: 'Listing schedules', past: 'Listed schedules' },
    { present: 'Checking the calendar', past: 'Checked the calendar' },
  ],
  crondelete: [
    { present: 'Cancelling schedule', past: 'Cancelled schedule' },
    { present: 'Calling off the schedule', past: 'Called off the schedule' },
  ],
  monitor: [
    { present: 'Watching', past: 'Watched' },
    { present: 'Keeping an eye on', past: 'Kept an eye on' },
    { present: 'Tailing', past: 'Tailed' },
  ],
  schedulewakeup: [
    { present: 'Setting a check-in', past: 'Set a check-in' },
    { present: 'Scheduling a wake-up', past: 'Scheduled a wake-up' },
  ],
};

const PT_BR_VARIANTS: Record<string, ToolLabel[]> = {
  read: [
    { present: 'Lendo', past: 'Leu' },
    { present: 'Folheando', past: 'Folheou' },
    { present: 'Espiando', past: 'Espiou' },
    { present: 'Dando uma olhada', past: 'Deu uma olhada' },
    { present: 'Mergulhando', past: 'Mergulhou' },
    { present: 'Analisando', past: 'Analisou' },
    { present: 'Abrindo', past: 'Abriu' },
  ],
  write: [
    { present: 'Escrevendo', past: 'Escreveu' },
    { present: 'Salvando', past: 'Salvou' },
    { present: 'Anotando', past: 'Anotou' },
    { present: 'Rascunhando', past: 'Rascunhou' },
    { present: 'Montando', past: 'Montou' },
    { present: 'Redigindo', past: 'Redigiu' },
  ],
  edit: [
    { present: 'Editando', past: 'Editou' },
    { present: 'Ajustando', past: 'Ajustou' },
    { present: 'Polindo', past: 'Poliu' },
    { present: 'Retocando', past: 'Retocou' },
    { present: 'Refinando', past: 'Refinou' },
    { present: 'Afinando', past: 'Afinou' },
  ],
  multiedit: [
    { present: 'Editando', past: 'Editou' },
    { present: 'Ajustando', past: 'Ajustou' },
    { present: 'Refazendo', past: 'Refez' },
    { present: 'Consertando', past: 'Consertou' },
    { present: 'Retocando', past: 'Retocou' },
  ],
  strreplace: [
    { present: 'Editando', past: 'Editou' },
    { present: 'Ajustando', past: 'Ajustou' },
    { present: 'Trocando', past: 'Trocou' },
  ],
  bash: [
    { present: 'Executando comando', past: 'Executou comando' },
    { present: 'Preparando', past: 'Preparou' },
    { present: 'Trabalhando', past: 'Trabalhou' },
    { present: 'Mexendo', past: 'Mexeu' },
    { present: 'Triturando', past: 'Triturou' },
  ],
  glob: [
    { present: 'Procurando arquivos', past: 'Encontrou arquivos' },
    { present: 'Vasculhando arquivos', past: 'Vasculhou arquivos' },
    { present: 'Navegando arquivos', past: 'Navegou arquivos' },
    { present: 'Farejando arquivos', past: 'Farejou arquivos' },
    { present: 'Arredondando arquivos', past: 'Arredondou arquivos' },
  ],
  grep: [
    { present: 'Pesquisando', past: 'Pesquisou' },
    { present: 'Peneirando', past: 'Peneirou' },
    { present: 'Vasculhando', past: 'Vasculhou' },
    { present: 'Cavucando', past: 'Cavucou' },
    { present: 'Peneirando', past: 'Peneirou' },
  ],
  ripgrep: [
    { present: 'Pesquisando', past: 'Pesquisou' },
    { present: 'Peneirando', past: 'Peneirou' },
    { present: 'Cavucando', past: 'Cavucou' },
  ],
  ls: [
    { present: 'Listando pasta', past: 'Listou pasta' },
    { present: 'Espiando', past: 'Espiou' },
    { present: 'Mexendo', past: 'Mexeu' },
  ],
  websearch: [
    { present: 'Pesquisando na web', past: 'Pesquisou na web' },
    { present: 'Googleando', past: 'Googleou' },
    { present: 'Rastreando a web', past: 'Rastreou a web' },
    { present: 'Cavando a web', past: 'Cavou a web' },
    { present: 'Caçando online', past: 'Caçou online' },
  ],
  webfetch: [
    { present: 'Lendo página', past: 'Leu página' },
    { present: 'Espiando', past: 'Espiou' },
    { present: 'Trazendo', past: 'Trouxe' },
    { present: 'Carregando', past: 'Carregou' },
    { present: 'Folheando', past: 'Folheou' },
  ],
  notebookedit: [
    { present: 'Editando notebook', past: 'Editou notebook' },
    { present: 'Ajustando notebook', past: 'Ajustou notebook' },
  ],
  todowrite: [
    { present: 'Atualizando plano', past: 'Atualizou plano' },
    { present: 'Anotando plano', past: 'Anotou plano' },
    { present: 'Esboçando plano', past: 'Esboçou plano' },
    { present: 'Mapeando', past: 'Mapeou' },
    { present: 'Planejando passos', past: 'Planejou passos' },
  ],
  todoread: [
    { present: 'Verificando plano', past: 'Verificou plano' },
    { present: 'Dando uma olhada no plano', past: 'Deu uma olhada no plano' },
  ],
  taskcreate: [
    { present: 'Iniciando tarefa', past: 'Iniciou tarefa' },
    { present: 'Disparando tarefa', past: 'Disparou tarefa' },
    { present: 'Criando tarefa', past: 'Criou tarefa' },
  ],
  taskupdate: [
    { present: 'Atualizando tarefa', past: 'Atualizou tarefa' },
    { present: 'Ajudando tarefa', past: 'Ajudou tarefa' },
  ],
  taskoutput: [
    { present: 'Espiando tarefa', past: 'Espiou tarefa' },
    { present: 'Verificando tarefa', past: 'Verificou tarefa' },
  ],
  taskstop: [
    { present: 'Parando tarefa', past: 'Parou tarefa' },
    { present: 'Finalizando tarefa', past: 'Finalizou tarefa' },
  ],
  tasklist: [
    { present: 'Listando tarefas', past: 'Listou tarefas' },
    { present: 'Arredondando tarefas', past: 'Arredondou tarefas' },
  ],
  taskget: [
    { present: 'Carregando tarefa', past: 'Carregou tarefa' },
    { present: 'Trazendo tarefa', past: 'Trouxe tarefa' },
  ],
  toolsearch: [
    { present: 'Procurando ferramenta', past: 'Encontrou ferramenta' },
    { present: 'Caçando ferramenta', past: 'Caçou ferramenta' },
    { present: 'Navegando caixa', past: 'Navegou caixa' },
    { present: 'Reviravoltando caixa', past: 'Reviravoltou caixa' },
    { present: 'Cavucando caixa', past: 'Cavucou caixa' },
  ],
  mcpsearch: [
    { present: 'Procurando ferramenta', past: 'Encontrou ferramenta' },
    { present: 'Caçando ferramenta', past: 'Caçou ferramenta' },
    { present: 'Navegando caixa', past: 'Navegou caixa' },
    { present: 'Reviravoltando caixa', past: 'Reviravoltou caixa' },
  ],
  mcpactivate: [
    { present: 'Conectando', past: 'Conectou' },
    { present: 'Plugando', past: 'Plugou' },
    { present: 'Ligando', past: 'Ligou' },
    { present: 'Montando', past: 'Montou' },
    { present: 'Vinculando', past: 'Vinculou' },
  ],
  mcplist: [
    { present: 'Listando ferramentas', past: 'Listou ferramentas' },
    { present: 'Navegando caixa', past: 'Navegou caixa' },
  ],
  settingsread: [
    { present: 'Verificando preferências', past: 'Verificou preferências' },
    { present: 'Lendo preferências', past: 'Leu preferências' },
    { present: 'Vendo preferências', past: 'Viu preferências' },
  ],
  settingswrite: [
    { present: 'Atualizando preferências', past: 'Atualizou preferências' },
    { present: 'Salvando preferências', past: 'Salvou preferências' },
    { present: 'Ajustando preferências', past: 'Ajustou preferências' },
  ],
  outputactivate: [
    { present: 'Carregando app', past: 'Carregou app' },
    { present: 'Ligando app', past: 'Ligou app' },
    { present: 'Montando app', past: 'Montou app' },
  ],
  outputlist: [
    { present: 'Navegando apps', past: 'Navegou apps' },
    { present: 'Listando apps', past: 'Listou apps' },
  ],
  outputsearch: [
    { present: 'Caçando app', past: 'Caçou app' },
    { present: 'Navegando apps', past: 'Navegou apps' },
    { present: 'Peneirando apps', past: 'Peneirou apps' },
  ],
  renderoutput: [
    { present: 'Mostrando app', past: 'Mostrou app' },
    { present: 'Pintando app', past: 'Pintou app' },
    { present: 'Montando app', past: 'Montou app' },
    { present: 'Trazendo app', past: 'Trouxe app' },
  ],
  askuserquestion: [
    { present: 'Perguntando', past: 'Perguntou' },
    { present: 'Verificando com você', past: 'Verificou com você' },
    { present: 'Notificando', past: 'Notificou' },
  ],
  invokeagent: [
    { present: 'Enviando assistente', past: 'Enviou assistente' },
    { present: 'Pedindo ajuda', past: 'Pediu ajuda' },
    { present: 'Chamando reforço', past: 'Chamou reforço' },
    { present: 'Marcando assistente', past: 'Marcou assistente' },
  ],
  agent: [
    { present: 'Ativando assistente', past: 'Ativou assistente' },
    { present: 'Enviando assistente', past: 'Enviou assistente' },
    { present: 'Chamando reforço', past: 'Chamou reforço' },
    { present: 'Criando assistente', past: 'Criou assistente' },
  ],
  createbrowseragent: [
    { present: 'Abrindo navegador', past: 'Abriu navegador' },
    { present: 'Ligando navegador', past: 'Ligou navegador' },
    { present: 'Bootando navegador', past: 'Bootou navegador' },
  ],
  browseragent: [
    { present: 'Dirigindo navegador', past: 'Dirigiu navegador' },
    { present: 'Usando navegador', past: 'Usou navegador' },
    { present: 'Manobrand navegador', past: 'Manobrou navegador' },
  ],
  browseragents: [
    { present: 'Dirigindo navegadores', past: 'Dirigiu navegadores' },
    { present: 'Manobrand navegadores', past: 'Manobrou navegadores' },
  ],
  enterplanmode: [
    { present: 'Entrando em modo plano', past: 'Entrou em modo plano' },
    { present: 'Acessando modo plano', past: 'Acessou modo plano' },
  ],
  exitplanmode: [
    { present: 'Saindo do modo plano', past: 'Saiu do modo plano' },
    { present: 'Deixando modo plano', past: 'Deixou modo plano' },
  ],
  enterworktree: [
    { present: 'Preparando workspace', past: 'Preparou workspace' },
    { present: 'Criando workspace', past: 'Criou workspace' },
  ],
  exitworktree: [
    { present: 'Limpando workspace', past: 'Limpou workspace' },
    { present: 'Derrubando workspace', past: 'Derrubou workspace' },
  ],
  pushnotification: [
    { present: 'Notificando', past: 'Notificou' },
    { present: 'Tocando sineta', past: 'Tocou sineta' },
    { present: 'Tocando ombro', past: 'Tocou ombro' },
  ],
  remotetrigger: [
    { present: 'Disparando', past: 'Disparou' },
    { present: 'Puxando gatilho', past: 'Puxou gatilho' },
  ],
  croncreate: [
    { present: 'Agendando', past: 'Agendou' },
    { present: 'Marcando lembrete', past: 'Marcou lembrete' },
    { present: 'Fixando no calendário', past: 'Fixou no calendário' },
    { present: 'Alinhando check-in', past: 'Alinharam check-in' },
  ],
  cronlist: [
    { present: 'Listando agendas', past: 'Listou agendas' },
    { present: 'Verificando calendário', past: 'Verificou calendário' },
  ],
  crondelete: [
    { present: 'Cancelando agenda', past: 'Cancelou agenda' },
    { present: 'Cancelando agenda', past: 'Cancelou agenda' },
  ],
  monitor: [
    { present: 'Observando', past: 'Observou' },
    { present: 'Vigiando', past: 'Vigiou' },
    { present: 'Rastreando', past: 'Rastreou' },
  ],
  schedulewakeup: [
    { present: 'Marcando check-in', past: 'Marcou check-in' },
    { present: 'Agendando despertar', past: 'Agendou despertar' },
  ],
};

function getToolVariants(): Record<string, ToolLabel[]> {
  return i18n.language === 'pt-BR' ? PT_BR_VARIANTS : EN_VARIANTS;
}

// Keys match backend _sanitize_server_name in tools_lib.
const MCP_SERVER_BRAND: Record<string, string> = {
  'google-workspace': 'Google Workspace',
  'microsoft-365': 'Microsoft 365',
  'gmail': 'Gmail',
  'gcal': 'Google Calendar',
  'gdrive': 'Google Drive',
  'gdocs': 'Google Docs',
  'gsheets': 'Google Sheets',
  'gslides': 'Google Slides',
  'slack': 'Slack',
  'discord': 'Discord',
  'notion': 'Notion',
  'airtable': 'Airtable',
  'hubspot': 'HubSpot',
  'reddit': 'Reddit',
  'youtube': 'YouTube',
  'github': 'GitHub',
  'linear': 'Linear',
  'jira': 'Jira',
  'asana': 'Asana',
  'figma': 'Figma',
  'stripe': 'Stripe',
  'maestro-browser-agent': 'browser',
  'maestro-invoke-agent': 'helper',
  'maestro-mcp-meta': 'tools',
  'maestro-outputs-meta': 'views',
  'maestro-settings-meta': 'settings',
  'maestro-web': 'the web',
};

// Order matters: most specific verb pattern wins.
interface McpVerbVariant { present: string; past: string; }
const EN_MCP_VERB_PATTERNS: Array<{ match: RegExp; variants: McpVerbVariant[] }> = [
  { match: /^(send|new)_/, variants: [
      { present: 'Sending', past: 'Sent' },
      { present: 'Firing off', past: 'Fired off' },
      { present: 'Shipping', past: 'Shipped' },
      { present: 'Dispatching', past: 'Dispatched' },
      { present: 'Sending out', past: 'Sent out' },
  ]},
  { match: /^(post|publish)_/, variants: [
      { present: 'Posting', past: 'Posted' },
      { present: 'Pinning up', past: 'Pinned up' },
      { present: 'Putting up', past: 'Put up' },
      { present: 'Dropping in', past: 'Dropped in' },
  ]},
  { match: /^(create|add)_/, variants: [
      { present: 'Creating', past: 'Created' },
      { present: 'Spinning up', past: 'Spun up' },
      { present: 'Whipping up', past: 'Whipped up' },
      { present: 'Cooking up', past: 'Cooked up' },
      { present: 'Setting up', past: 'Set up' },
      { present: 'Drafting', past: 'Drafted' },
  ]},
  { match: /^(query|search|find|list|get|fetch|read|view|show|browse|analyze)_/, variants: [
      { present: 'Reading', past: 'Read' },
      { present: 'Skimming', past: 'Skimmed' },
      { present: 'Pulling up', past: 'Pulled up' },
      { present: 'Peeking at', past: 'Peeked at' },
      { present: 'Digging up', past: 'Dug up' },
      { present: 'Hunting down', past: 'Hunted down' },
      { present: 'Tracking down', past: 'Tracked down' },
      { present: 'Fetching', past: 'Fetched' },
  ]},
  { match: /^(update|edit|modify|patch|set)_/, variants: [
      { present: 'Updating', past: 'Updated' },
      { present: 'Tweaking', past: 'Tweaked' },
      { present: 'Polishing', past: 'Polished' },
      { present: 'Tuning', past: 'Tuned' },
      { present: 'Refining', past: 'Refined' },
      { present: 'Touching up', past: 'Touched up' },
  ]},
  { match: /^(delete|remove|cancel|archive)_/, variants: [
      { present: 'Deleting', past: 'Deleted' },
  ]},
  { match: /^(reply|respond|comment)_/, variants: [
      { present: 'Replying', past: 'Replied' },
      { present: 'Hitting back', past: 'Hit back' },
      { present: 'Chiming in', past: 'Chimed in' },
  ]},
  { match: /^(download|export|backup)_/, variants: [
      { present: 'Downloading', past: 'Downloaded' },
      { present: 'Pulling down', past: 'Pulled down' },
      { present: 'Grabbing', past: 'Grabbed' },
      { present: 'Saving down', past: 'Saved down' },
  ]},
  { match: /^(upload|import|attach)_/, variants: [
      { present: 'Uploading', past: 'Uploaded' },
      { present: 'Sending up', past: 'Sent up' },
      { present: 'Pushing up', past: 'Pushed up' },
      { present: 'Beaming up', past: 'Beamed up' },
  ]},
  { match: /^(execute|run|invoke|trigger|complete)_/, variants: [
      { present: 'Running', past: 'Ran' },
      { present: 'Firing', past: 'Fired' },
      { present: 'Kicking off', past: 'Kicked off' },
  ]},
  { match: /^(authenticate|login|connect)_/, variants: [
      { present: 'Connecting', past: 'Connected' },
      { present: 'Plugging in', past: 'Plugged in' },
      { present: 'Hooking up', past: 'Hooked up' },
  ]},
];

const PT_BR_MCP_VERB_PATTERNS: Array<{ match: RegExp; variants: McpVerbVariant[] }> = [
  { match: /^(send|new)_/, variants: [
      { present: 'Enviando', past: 'Enviou' },
      { present: 'Disparando', past: 'Disparou' },
      { present: 'Enviando', past: 'Enviou' },
      { present: 'Despachando', past: 'Despachou' },
      { present: 'Enviando', past: 'Enviou' },
  ]},
  { match: /^(post|publish)_/, variants: [
      { present: 'Postando', past: 'Postou' },
      { present: 'Fixando', past: 'Fixou' },
      { present: 'Colocando', past: 'Colocou' },
      { present: 'Dropando', past: 'Dropou' },
  ]},
  { match: /^(create|add)_/, variants: [
      { present: 'Criando', past: 'Criou' },
      { present: 'Ativando', past: 'Ativou' },
      { present: 'Preparando', past: 'Preparou' },
      { present: 'Cozinhando', past: 'Cozinhou' },
      { present: 'Montando', past: 'Montou' },
      { present: 'Rascunhando', past: 'Rascunhou' },
  ]},
  { match: /^(query|search|find|list|get|fetch|read|view|show|browse|analyze)_/, variants: [
      { present: 'Lendo', past: 'Leu' },
      { present: 'Folheando', past: 'Folheou' },
      { present: 'Trazendo', past: 'Trouxe' },
      { present: 'Espiando', past: 'Espiou' },
      { present: 'Cavucando', past: 'Cavucou' },
      { present: 'Caçando', past: 'Caçou' },
      { present: 'Rastreando', past: 'Rastreou' },
      { present: 'Buscando', past: 'Buscou' },
  ]},
  { match: /^(update|edit|modify|patch|set)_/, variants: [
      { present: 'Atualizando', past: 'Atualizou' },
      { present: 'Ajustando', past: 'Ajustou' },
      { present: 'Polindo', past: 'Poliu' },
      { present: 'Afinando', past: 'Afinou' },
      { present: 'Refinando', past: 'Refinou' },
      { present: 'Retocando', past: 'Retocou' },
  ]},
  { match: /^(delete|remove|cancel|archive)_/, variants: [
      { present: 'Deletando', past: 'Deletou' },
  ]},
  { match: /^(reply|respond|comment)_/, variants: [
      { present: 'Respondendo', past: 'Respondeu' },
      { present: 'Contra-atacando', past: 'Contra-atacou' },
      { present: 'Entrando na conversa', past: 'Entrou na conversa' },
  ]},
  { match: /^(download|export|backup)_/, variants: [
      { present: 'Baixando', past: 'Baixou' },
      { present: 'Trazendo', past: 'Trouxe' },
      { present: 'Pegando', past: 'Pegou' },
      { present: 'Salvando', past: 'Salvou' },
  ]},
  { match: /^(upload|import|attach)_/, variants: [
      { present: 'Enviando', past: 'Enviou' },
      { present: 'Enviando', past: 'Enviou' },
      { present: 'Empurrando', past: 'Empurrou' },
      { present: 'Transportando', past: 'Transportou' },
  ]},
  { match: /^(execute|run|invoke|trigger|complete)_/, variants: [
      { present: 'Executando', past: 'Executou' },
      { present: 'Disparando', past: 'Disparou' },
      { present: 'Iniciando', past: 'Iniciou' },
  ]},
  { match: /^(authenticate|login|connect)_/, variants: [
      { present: 'Conectando', past: 'Conectou' },
      { present: 'Plugando', past: 'Plugou' },
      { present: 'Ligando', past: 'Ligou' },
  ]},
];

function getMcpVerbPatterns(): Array<{ match: RegExp; variants: McpVerbVariant[] }> {
  return i18n.language === 'pt-BR' ? PT_BR_MCP_VERB_PATTERNS : EN_MCP_VERB_PATTERNS;
}

const EN_ACTION_OBJECTS: Array<{ match: RegExp; noun: string }> = [
  { match: /(?:^|_)(?:gmail|email|inbox|mail)s?(?:_|$)/, noun: 'email' },
  { match: /(?:^|_)(?:event|meeting|appointment)/, noun: 'event' },
  { match: /(?:^|_)(?:freebusy|availability)/, noun: 'availability' },
  { match: /(?:^|_)(?:calendar)/, noun: 'calendar' },
  { match: /(?:^|_)(?:contact)/, noun: 'contact' },
  { match: /(?:^|_)(?:doc|document)/, noun: 'document' },
  { match: /(?:^|_)(?:sheet|spreadsheet|row|cell)/, noun: 'sheet' },
  { match: /(?:^|_)(?:slide|presentation)/, noun: 'slide' },
  { match: /(?:^|_)(?:dm|direct_message)/, noun: 'DM' },
  { match: /(?:^|_)(?:thread|reply)/, noun: 'thread' },
  { match: /(?:^|_)(?:channel)/, noun: 'channel' },
  { match: /(?:^|_)(?:message|msg)/, noun: 'message' },
  { match: /(?:^|_)(?:reaction|emoji)/, noun: 'reaction' },
  { match: /(?:^|_)(?:page)/, noun: 'page' },
  { match: /(?:^|_)(?:database|db|table|base)/, noun: 'database' },
  { match: /(?:^|_)(?:record)/, noun: 'record' },
  { match: /(?:^|_)(?:issue)/, noun: 'issue' },
  { match: /(?:^|_)(?:pull_request|pr)(?:_|$)/, noun: 'PR' },
  { match: /(?:^|_)(?:comment)/, noun: 'comment' },
  { match: /(?:^|_)(?:deal|opportunity)/, noun: 'deal' },
  { match: /(?:^|_)(?:company|account)/, noun: 'company' },
  { match: /(?:^|_)(?:ticket)/, noun: 'ticket' },
  { match: /(?:^|_)(?:user|profile|member)/, noun: 'user' },
  { match: /(?:^|_)(?:video|stream)/, noun: 'video' },
  { match: /(?:^|_)(?:transcript|caption)/, noun: 'transcript' },
  { match: /(?:^|_)(?:subreddit|sub)/, noun: 'subreddit' },
  { match: /(?:^|_)(?:post|submission)/, noun: 'post' },
  { match: /(?:^|_)(?:file|drive|folder)/, noun: 'file' },
  { match: /(?:^|_)(?:task|todo)/, noun: 'task' },
];

const PT_BR_ACTION_OBJECTS: Array<{ match: RegExp; noun: string }> = [
  { match: /(?:^|_)(?:gmail|email|inbox|mail)s?(?:_|$)/, noun: 'email' },
  { match: /(?:^|_)(?:event|meeting|appointment)/, noun: 'evento' },
  { match: /(?:^|_)(?:freebusy|availability)/, noun: 'disponibilidade' },
  { match: /(?:^|_)(?:calendar)/, noun: 'calendário' },
  { match: /(?:^|_)(?:contact)/, noun: 'contato' },
  { match: /(?:^|_)(?:doc|document)/, noun: 'documento' },
  { match: /(?:^|_)(?:sheet|spreadsheet|row|cell)/, noun: 'planilha' },
  { match: /(?:^|_)(?:slide|presentation)/, noun: 'slide' },
  { match: /(?:^|_)(?:dm|direct_message)/, noun: 'DM' },
  { match: /(?:^|_)(?:thread|reply)/, noun: 'thread' },
  { match: /(?:^|_)(?:channel)/, noun: 'canal' },
  { match: /(?:^|_)(?:message|msg)/, noun: 'mensagem' },
  { match: /(?:^|_)(?:reaction|emoji)/, noun: 'reação' },
  { match: /(?:^|_)(?:page)/, noun: 'página' },
  { match: /(?:^|_)(?:database|db|table|base)/, noun: 'banco de dados' },
  { match: /(?:^|_)(?:record)/, noun: 'registro' },
  { match: /(?:^|_)(?:issue)/, noun: 'issue' },
  { match: /(?:^|_)(?:pull_request|pr)(?:_|$)/, noun: 'PR' },
  { match: /(?:^|_)(?:comment)/, noun: 'comentário' },
  { match: /(?:^|_)(?:deal|opportunity)/, noun: 'negócio' },
  { match: /(?:^|_)(?:company|account)/, noun: 'empresa' },
  { match: /(?:^|_)(?:ticket)/, noun: 'ticket' },
  { match: /(?:^|_)(?:user|profile|member)/, noun: 'usuário' },
  { match: /(?:^|_)(?:video|stream)/, noun: 'vídeo' },
  { match: /(?:^|_)(?:transcript|caption)/, noun: 'transcrição' },
  { match: /(?:^|_)(?:subreddit|sub)/, noun: 'subreddit' },
  { match: /(?:^|_)(?:post|submission)/, noun: 'post' },
  { match: /(?:^|_)(?:file|drive|folder)/, noun: 'arquivo' },
  { match: /(?:^|_)(?:task|todo)/, noun: 'tarefa' },
];

function getActionObjects(): Array<{ match: RegExp; noun: string }> {
  return i18n.language === 'pt-BR' ? PT_BR_ACTION_OBJECTS : EN_ACTION_OBJECTS;
}

function _humanizeName(name: string): string {
  const spaced = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')  // split camelCase: SettingsRead -> Settings Read
    .replace(/[-_]+/g, ' ')
    .toLowerCase()
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function _labelForMcpTool(toolName: string, seed?: string): ToolLabel | null {
  const parts = toolName.split('__');
  if (parts.length < 3 || parts[0] !== 'mcp') return null;
  const server = parts[1].toLowerCase();
  const actionRaw = parts.slice(2).join('__');  // original case, for the humanize fallback's camelCase split
  const action = actionRaw.toLowerCase();
  const brand = MCP_SERVER_BRAND[server] || _humanizeName(server);

  // Internal meta-MCPs route through tool variants so we don't render "tools: Mcpsearch".
  if (server.startsWith('maestro-')) {
    const builtin = getToolVariants()[action];
    if (builtin) return _pick(builtin, seed);
  }

  let verbVariants: McpVerbVariant[] | null = null;
  for (const p of getMcpVerbPatterns()) {
    if (p.match.test(action)) { verbVariants = p.variants; break; }
  }

  let noun = '';
  for (const a of getActionObjects()) {
    if (a.match.test(action)) { noun = a.noun; break; }
  }

  if (verbVariants) {
    const verb = _pick(verbVariants, seed);
    if (noun) {
      return { present: `${verb.present} ${noun}`, past: `${verb.past} ${noun}` };
    }
    return { present: `${verb.present} via ${brand}`, past: `${verb.past} via ${brand}` };
  }

  const human = _humanizeName(actionRaw.replace(/^_+|_+$/g, ''));
  // Internal maestro-* tools read as a plain action with no brand prefix ("Settings read", not "settings: Settings read"); external connectors keep the brand so the user knows which app it touched ("Gmail: Send email").
  if (server.startsWith('maestro-')) {
    return { present: human, past: human };
  }
  // Avoid "Notion: Notion search" — if the action already names the brand, don't repeat it.
  if (human.toLowerCase().startsWith(brand.toLowerCase())) {
    return { present: human, past: human };
  }
  return { present: `${brand}: ${human}`, past: `${brand}: ${human}` };
}

export function getToolLabel(toolName: string, seed?: string): ToolLabel {
  const isPortuguese = i18n.language === 'pt-BR';
  if (!toolName) return isPortuguese ? { present: 'Trabalhando', past: 'Trabalhou' } : { present: 'Working', past: 'Done' };
  const mcpHit = _labelForMcpTool(toolName, seed);
  if (mcpHit) return mcpHit;
  const key = toolName.toLowerCase();
  const variants = getToolVariants()[key];
  if (variants) return _pick(variants, seed);
  const pretty = toolName.charAt(0).toUpperCase() + toolName.slice(1);
  return isPortuguese ? { present: `Executando ${pretty}`, past: `Executou ${pretty}` } : { present: `Running ${pretty}`, past: `Ran ${pretty}` };
}

/** Per-input label override for tools whose meaning depends on input (MCPActivate, Bash). */
export function getToolLabelWithInput(toolName: string, input: any, seed?: string): ToolLabel {
  const isPortuguese = i18n.language === 'pt-BR';
  if (!toolName) return isPortuguese ? { present: 'Trabalhando', past: 'Trabalhou' } : { present: 'Working', past: 'Done' };

  if (toolName === 'MCPActivate' && input?.server_name) {
    const slug = String(input.server_name).toLowerCase();
    const brand = MCP_SERVER_BRAND[slug] || _humanizeName(slug);
    const variants: ToolLabel[] = isPortuguese ? [
      { present: `Conectando a ${brand}`, past: `Conectou a ${brand}` },
      { present: `Plugando em ${brand}`, past: `Plugou em ${brand}` },
      { present: `Ligando a ${brand}`, past: `Ligou a ${brand}` },
      { present: `Montando em ${brand}`, past: `Montou em ${brand}` },
      { present: `Vinculando a ${brand}`, past: `Vinculou a ${brand}` },
      { present: `Tocando em ${brand}`, past: `Tocou em ${brand}` },
    ] : [
      { present: `Connecting to ${brand}`, past: `Connected to ${brand}` },
      { present: `Plugging into ${brand}`, past: `Plugged into ${brand}` },
      { present: `Hooking up ${brand}`, past: `Hooked up ${brand}` },
      { present: `Wiring up ${brand}`, past: `Wired up ${brand}` },
      { present: `Linking up ${brand}`, past: `Linked up ${brand}` },
      { present: `Tapping into ${brand}`, past: `Tapped into ${brand}` },
    ];
    return _pick(variants, seed);
  }

  if (toolName === 'Bash' || toolName === 'bash') {
    const cmd = typeof input?.command === 'string' ? input.command : '';
    if (cmd) {
      const verb = _bashVerb(cmd, seed);
      if (verb) return verb;
    }
  }

  return getToolLabel(toolName, seed);
}

const GIT_VERBS: Record<string, ToolLabel[]> = {
  commit: [
    { present: 'Committing', past: 'Committed' },
    { present: 'Saving a snapshot', past: 'Saved a snapshot' },
    { present: 'Locking in changes', past: 'Locked in changes' },
    { present: 'Stamping it', past: 'Stamped it' },
  ],
  push: [
    { present: 'Pushing to git', past: 'Pushed to git' },
    { present: 'Sending changes upstream', past: 'Sent changes upstream' },
  ],
  pull: [
    { present: 'Pulling from git', past: 'Pulled from git' },
    { present: 'Grabbing latest', past: 'Grabbed latest' },
  ],
  fetch: [{ present: 'Fetching from git', past: 'Fetched from git' }],
  clone: [
    { present: 'Cloning repo', past: 'Cloned repo' },
    { present: 'Copying down the repo', past: 'Copied down the repo' },
  ],
  add: [
    { present: 'Staging changes', past: 'Staged changes' },
    { present: 'Lining up changes', past: 'Lined up changes' },
    { present: 'Queueing changes', past: 'Queued changes' },
  ],
  status: [
    { present: 'Checking git status', past: 'Checked git status' },
    { present: 'Peeking at git', past: 'Peeked at git' },
    { present: 'Glancing at git', past: 'Glanced at git' },
  ],
  log: [
    { present: 'Reading git history', past: 'Read git history' },
    { present: 'Skimming git history', past: 'Skimmed git history' },
    { present: 'Flipping through history', past: 'Flipped through history' },
  ],
  diff: [
    { present: 'Comparing changes', past: 'Compared changes' },
    { present: 'Eyeballing the diff', past: 'Eyeballed the diff' },
  ],
  branch: [{ present: 'Listing branches', past: 'Listed branches' }],
  checkout: [
    { present: 'Switching branches', past: 'Switched branches' },
    { present: 'Hopping branches', past: 'Hopped branches' },
  ],
  switch: [
    { present: 'Switching branches', past: 'Switched branches' },
    { present: 'Hopping branches', past: 'Hopped branches' },
  ],
  merge: [
    { present: 'Merging', past: 'Merged' },
    { present: 'Stitching it together', past: 'Stitched it together' },
  ],
  rebase: [{ present: 'Rebasing', past: 'Rebased' }],
  reset: [{ present: 'Resetting git', past: 'Reset git' }],
  stash: [
    { present: 'Stashing', past: 'Stashed' },
    { present: 'Tucking away', past: 'Tucked away' },
  ],
  tag: [
    { present: 'Tagging', past: 'Tagged' },
    { present: 'Marking it', past: 'Marked it' },
  ],
  init: [{ present: 'Setting up git', past: 'Set up git' }],
  remote: [{ present: 'Configuring git remote', past: 'Configured git remote' }],
};

function _pkgVerb(sub: string, seed?: string): ToolLabel {
  if (['install', 'add', 'i'].includes(sub)) {
    return _pick<ToolLabel>([
      { present: 'Installing packages', past: 'Installed packages' },
      { present: 'Pulling in packages', past: 'Pulled in packages' },
      { present: 'Grabbing packages', past: 'Grabbed packages' },
      { present: 'Adding packages', past: 'Added packages' },
    ], seed);
  }
  if (['uninstall', 'remove', 'rm'].includes(sub)) {
    return { present: 'Removing packages', past: 'Removed packages' };
  }
  if (['update', 'upgrade', 'up'].includes(sub)) {
    return _pick<ToolLabel>([
      { present: 'Updating packages', past: 'Updated packages' },
      { present: 'Bumping packages', past: 'Bumped packages' },
      { present: 'Refreshing packages', past: 'Refreshed packages' },
    ], seed);
  }
  if (['run', 'start', 'serve', 'dev'].includes(sub)) {
    return _pick<ToolLabel>([
      { present: 'Running script', past: 'Ran script' },
      { present: 'Firing up script', past: 'Fired up script' },
      { present: 'Kicking off script', past: 'Kicked off script' },
    ], seed);
  }
  if (sub === 'test') {
    return _pick<ToolLabel>([
      { present: 'Running tests', past: 'Ran tests' },
      { present: 'Putting code through tests', past: 'Put code through tests' },
      { present: 'Stress-testing code', past: 'Stress-tested code' },
    ], seed);
  }
  if (sub === 'build') {
    return _pick<ToolLabel>([
      { present: 'Building', past: 'Built' },
      { present: 'Compiling', past: 'Compiled' },
      { present: 'Cooking up the build', past: 'Cooked up the build' },
      { present: 'Putting it together', past: 'Put it together' },
    ], seed);
  }
  return { present: 'Running command', past: 'Ran command' };
}

type BinEntry = ToolLabel[] | ((sub: string, seed?: string) => ToolLabel | null);

const BIN_VERBS: Record<string, BinEntry> = {
  rm: [{ present: 'Deleting', past: 'Deleted' }],
  rmdir: [{ present: 'Removing folder', past: 'Removed folder' }],
  chmod: [{ present: 'Changing permissions', past: 'Changed permissions' }],
  chown: [{ present: 'Changing owner', past: 'Changed owner' }],
  killall: [{ present: 'Stopping process', past: 'Stopped process' }],
  kill: [{ present: 'Stopping process', past: 'Stopped process' }],

  mv: [
    { present: 'Moving', past: 'Moved' },
    { present: 'Shuffling', past: 'Shuffled' },
    { present: 'Relocating', past: 'Relocated' },
    { present: 'Sliding over', past: 'Slid over' },
  ],
  cp: [
    { present: 'Copying', past: 'Copied' },
    { present: 'Duplicating', past: 'Duplicated' },
    { present: 'Cloning', past: 'Cloned' },
    { present: 'Mirroring', past: 'Mirrored' },
  ],
  ln: [
    { present: 'Linking', past: 'Linked' },
    { present: 'Wiring up a link', past: 'Wired up a link' },
  ],
  mkdir: [
    { present: 'Creating folder', past: 'Created folder' },
    { present: 'Spinning up a folder', past: 'Spun up a folder' },
    { present: 'Setting up a folder', past: 'Set up a folder' },
  ],
  touch: [
    { present: 'Creating file', past: 'Created file' },
    { present: 'Spinning up a file', past: 'Spun up a file' },
  ],
  cat: [
    { present: 'Reading', past: 'Read' },
    { present: 'Skimming', past: 'Skimmed' },
    { present: 'Glancing at', past: 'Glanced at' },
  ],
  head: [
    { present: 'Reading the top of', past: 'Read the top of' },
    { present: 'Peeking at the top of', past: 'Peeked at the top of' },
  ],
  tail: [
    { present: 'Reading the end of', past: 'Read the end of' },
    { present: 'Peeking at the end of', past: 'Peeked at the end of' },
  ],
  less: [
    { present: 'Reading', past: 'Read' },
    { present: 'Skimming', past: 'Skimmed' },
  ],
  more: [
    { present: 'Reading', past: 'Read' },
    { present: 'Skimming', past: 'Skimmed' },
  ],
  ls: [
    { present: 'Listing folder', past: 'Listed folder' },
    { present: 'Peeking inside', past: 'Peeked inside' },
    { present: 'Poking around in', past: 'Poked around in' },
    { present: 'Scanning the folder', past: 'Scanned the folder' },
  ],
  tree: [
    { present: 'Listing folder', past: 'Listed folder' },
    { present: 'Mapping the folder', past: 'Mapped the folder' },
  ],
  pwd: [
    { present: 'Checking location', past: 'Checked location' },
    { present: 'Figuring out where I am', past: 'Figured out where I am' },
  ],
  cd: [
    { present: 'Switching folder', past: 'Switched folder' },
    { present: 'Hopping over', past: 'Hopped over' },
  ],
  find: [
    { present: 'Hunting for files', past: 'Hunted for files' },
    { present: 'Searching files', past: 'Searched files' },
    { present: 'Sniffing out files', past: 'Sniffed out files' },
  ],
  grep: [
    { present: 'Searching files', past: 'Searched files' },
    { present: 'Combing through', past: 'Combed through' },
    { present: 'Digging through', past: 'Dug through' },
  ],
  rg: [
    { present: 'Searching files', past: 'Searched files' },
    { present: 'Combing through', past: 'Combed through' },
    { present: 'Digging through', past: 'Dug through' },
  ],
  ack: [
    { present: 'Searching files', past: 'Searched files' },
    { present: 'Combing through', past: 'Combed through' },
  ],
  awk: [
    { present: 'Processing text', past: 'Processed text' },
    { present: 'Slicing text', past: 'Sliced text' },
  ],
  sed: [
    { present: 'Editing text', past: 'Edited text' },
    { present: 'Find-and-replacing', past: 'Find-and-replaced' },
  ],
  sort: [
    { present: 'Sorting', past: 'Sorted' },
    { present: 'Lining things up', past: 'Lined things up' },
  ],
  uniq: [
    { present: 'Deduplicating', past: 'Deduplicated' },
    { present: 'Tidying duplicates', past: 'Tidied duplicates' },
  ],
  wc: [
    { present: 'Counting', past: 'Counted' },
    { present: 'Tallying', past: 'Tallied' },
  ],
  diff: [
    { present: 'Comparing files', past: 'Compared files' },
    { present: 'Eyeballing the diff', past: 'Eyeballed the diff' },
  ],
  curl: [
    { present: 'Downloading', past: 'Downloaded' },
    { present: 'Pulling from the web', past: 'Pulled from the web' },
    { present: 'Grabbing from the web', past: 'Grabbed from the web' },
    { present: 'Fetching', past: 'Fetched' },
  ],
  wget: [
    { present: 'Downloading', past: 'Downloaded' },
    { present: 'Pulling from the web', past: 'Pulled from the web' },
    { present: 'Grabbing from the web', past: 'Grabbed from the web' },
  ],
  python: [
    { present: 'Running script', past: 'Ran script' },
    { present: 'Firing up Python', past: 'Fired up Python' },
    { present: 'Kicking off Python', past: 'Kicked off Python' },
  ],
  python3: [
    { present: 'Running script', past: 'Ran script' },
    { present: 'Firing up Python', past: 'Fired up Python' },
    { present: 'Kicking off Python', past: 'Kicked off Python' },
  ],
  node: [
    { present: 'Running script', past: 'Ran script' },
    { present: 'Firing up Node', past: 'Fired up Node' },
    { present: 'Kicking off Node', past: 'Kicked off Node' },
  ],
  ruby: [
    { present: 'Running script', past: 'Ran script' },
    { present: 'Firing up Ruby', past: 'Fired up Ruby' },
  ],
  go: [
    { present: 'Running Go', past: 'Ran Go' },
    { present: 'Firing up Go', past: 'Fired up Go' },
  ],
  cargo: [
    { present: 'Running Cargo', past: 'Ran Cargo' },
    { present: 'Firing up Cargo', past: 'Fired up Cargo' },
  ],
  java: [
    { present: 'Running Java', past: 'Ran Java' },
    { present: 'Firing up Java', past: 'Fired up Java' },
  ],
  echo: [
    { present: 'Printing', past: 'Printed' },
    { present: 'Echoing', past: 'Echoed' },
    { present: 'Saying', past: 'Said' },
    { present: 'Outputting', past: 'Output' },
  ],
  printf: [
    { present: 'Printing', past: 'Printed' },
    { present: 'Outputting', past: 'Output' },
  ],
  make: [
    { present: 'Building', past: 'Built' },
    { present: 'Compiling', past: 'Compiled' },
    { present: 'Cooking up the build', past: 'Cooked up the build' },
    { present: 'Putting it together', past: 'Put it together' },
  ],
  cmake: [
    { present: 'Building', past: 'Built' },
    { present: 'Compiling', past: 'Compiled' },
  ],
  docker: [
    { present: 'Running Docker', past: 'Ran Docker' },
    { present: 'Firing up a container', past: 'Fired up a container' },
  ],
  kubectl: [{ present: 'Running kubectl', past: 'Ran kubectl' }],
  aws: [{ present: 'Running AWS CLI', past: 'Ran AWS CLI' }],
  gcloud: [{ present: 'Running gcloud', past: 'Ran gcloud' }],
  ssh: [
    { present: 'Connecting via SSH', past: 'Connected via SSH' },
    { present: 'Tunnelling in', past: 'Tunnelled in' },
  ],
  scp: [
    { present: 'Copying remotely', past: 'Copied remotely' },
    { present: 'Beaming files over', past: 'Beamed files over' },
  ],
  rsync: [
    { present: 'Syncing files', past: 'Synced files' },
    { present: 'Mirroring files', past: 'Mirrored files' },
    { present: 'Lining up files', past: 'Lined up files' },
  ],
  tar: [
    { present: 'Archiving', past: 'Archived' },
    { present: 'Bundling up', past: 'Bundled up' },
  ],
  zip: [
    { present: 'Archiving', past: 'Archived' },
    { present: 'Zipping up', past: 'Zipped up' },
  ],
  unzip: [
    { present: 'Extracting', past: 'Extracted' },
    { present: 'Unpacking', past: 'Unpacked' },
  ],
  open: [
    { present: 'Opening', past: 'Opened' },
    { present: 'Cracking open', past: 'Cracked open' },
  ],
  ps: [
    { present: 'Listing processes', past: 'Listed processes' },
    { present: 'Checking what is running', past: 'Checked what is running' },
  ],
  git: (sub: string, seed?: string) => {
    const v = GIT_VERBS[sub];
    if (v) return _pick<ToolLabel>(v, seed);
    return { present: 'Running git', past: 'Ran git' };
  },
  npm: (sub: string, seed?: string) => _pkgVerb(sub, seed),
  pnpm: (sub: string, seed?: string) => _pkgVerb(sub, seed),
  yarn: (sub: string, seed?: string) => _pkgVerb(sub, seed),
  bun: (sub: string, seed?: string) => _pkgVerb(sub, seed),
  pip: (sub: string, seed?: string) => _pkgVerb(sub, seed),
  pip3: (sub: string, seed?: string) => _pkgVerb(sub, seed),
  brew: (sub: string, seed?: string) => _pkgVerb(sub, seed),
  apt: (sub: string, seed?: string) => _pkgVerb(sub, seed),
  'apt-get': (sub: string, seed?: string) => _pkgVerb(sub, seed),
};

function _bashVerb(rawCmd: string, seed?: string): ToolLabel | null {
  const cmd = rawCmd.trim();
  if (!cmd) return null;
  const stripped = cmd.replace(/^(?:[A-Z_][A-Z0-9_]*=\S+\s+)+/, '');
  const tokens = stripped.split(/\s+/);
  if (!tokens.length) return null;
  const firstRaw = tokens[0];
  if (['sudo', 'time', 'nice', 'env'].includes(firstRaw) && tokens.length > 1) {
    return _bashVerb(stripped.slice(firstRaw.length).trim(), seed);
  }
  const bin = (firstRaw.split('/').pop() || firstRaw).toLowerCase();
  const sub = (tokens[1] || '').toLowerCase();

  const entry = BIN_VERBS[bin];
  if (!entry) return null;
  if (typeof entry === 'function') return entry(sub, seed);
  return _pick<ToolLabel>(entry, seed);
}

export function prettyPath(p: string): string {
  if (!p) return '';
  const cleaned = p.replace(/[\\/]+$/, '');
  const parts = cleaned.split(/[/\\]/);
  return parts[parts.length - 1] || cleaned;
}

export function prettyUrl(u: string): string {
  if (!u) return '';
  try {
    const parsed = new URL(u);
    return parsed.host.replace(/^www\./, '');
  } catch {
    const noProto = u.replace(/^https?:\/\//, '').split(/[/?#]/)[0];
    return noProto.slice(0, 60);
  }
}

export function quoteQuery(q: string, max = 60): string {
  if (!q) return '';
  const trimmed = q.length > max ? q.slice(0, max - 1) + '…' : q;
  return `"${trimmed}"`;
}

export function bashCommandDetail(rawCmd: string): string {
  if (!rawCmd) return '';
  const cmd = rawCmd.trim();
  const stripped = cmd
    .replace(/^(?:[A-Z_][A-Z0-9_]*=\S+\s+)+/, '')
    .replace(/^(?:sudo|time|nice|env)\s+/, '');
  const tokens = stripped.split(/\s+/);
  const bin = (tokens[0] || '').split('/').pop() || '';

  if (bin === 'git') {
    const sub = (tokens[1] || '').toLowerCase();
    if (['commit', 'status', 'log', 'diff', 'pull', 'push', 'fetch'].includes(sub)) return '';
    return tokens[2] ? prettyPath(tokens[2]) : '';
  }

  if (['npm', 'pnpm', 'yarn', 'bun', 'pip', 'pip3', 'brew', 'apt', 'apt-get'].includes(bin)) {
    return tokens[2] ? tokens.slice(2).filter((t) => !t.startsWith('-')).slice(0, 2).join(' ') : '';
  }

  const arg = tokens.slice(1).find((t) => !t.startsWith('-'));
  if (!arg) return '';
  if (arg.includes('/') || arg.includes('\\')) return prettyPath(arg);
  return arg.length > 50 ? arg.slice(0, 47) + '…' : arg;
}
