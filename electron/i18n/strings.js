const path = require('path');
const fs = require('fs');

// Flat locale maps. Keys follow the naming pattern: "section.subsection.key"
const locales = {
  'pt-BR': {
    'appShell.splash.starting': 'Iniciando…',
    'appShell.splash.startingBackend': 'Iniciando backend…',
    'appShell.splash.loadingComponents': 'Carregando componentes…',
    'appShell.splash.almostReady': 'Quase pronto…',
    'appShell.splash.backendFailed': 'Backend falhou ao iniciar',
    'appShell.splash.startupFailed': 'Maestro Studio não conseguiu iniciar: ',
    'appShell.splash.connectingBackend': 'Conectando ao backend de desenvolvimento…',
    'appShell.splash.viewLogs': 'Ver logs',
    'appShell.splash.restart': 'Reiniciar',
    'appShell.splash.quit': 'Sair',
    'appShell.boot.stillStartingWin': 'Ainda iniciando — Windows Defender está analisando arquivos (apenas no primeiro lançamento)…',
    'appShell.boot.stillStartingMac': 'Ainda iniciando — macOS está verificando o pacote (apenas no primeiro lançamento)…',
    'appShell.boot.stillStartingGeneric': 'Ainda iniciando (primeiro lançamento é mais lento que os subsequentes)…',
    'appShell.boot.takingTooLongWin': 'Backend está levando mais tempo que o usual. Verificações do Defender em 14 mil arquivos podem levar alguns minutos em unidades lentas.',
    'appShell.boot.takingTooLongMac': 'Backend está levando mais tempo que o usual. Verificações de primeiro lançamento do macOS podem ser lentas com cache frio.',
    'appShell.boot.takingTooLongGeneric': 'Backend está levando mais tempo que o usual. Você pode aguardar, ver logs ou reiniciar.',
    'appShell.crash.title': 'Maestro Studio precisa recarregar',
    'appShell.crash.message': 'Maestro Studio teve erros repetidos na interface e parou de recuperar automaticamente.',
    'appShell.crash.detail': 'Recarregue para tentar novamente, ou saia se isso continuar acontecendo.',
    'appShell.crash.reload': 'Recarregar',
    'appShell.crash.quit': 'Sair',
    'appShell.context.noSuggestions': 'Sem sugestões de ortografia',
    'appShell.context.addDict': 'Adicionar ao dicionário',
    'appShell.context.openNewTab': 'Abrir link em nova aba',
    'appShell.context.copyLink': 'Copiar link',
    'appShell.context.openImageNewTab': 'Abrir imagem em nova aba',
    'appShell.context.copyImage': 'Copiar imagem',
    'appShell.context.copyImageAddr': 'Copiar endereço da imagem',
    'appShell.context.back': 'Voltar',
    'appShell.context.forward': 'Avançar',
    'appShell.context.reload': 'Recarregar',
    'appShell.context.inspect': 'Inspecionar elemento',
    'appShell.update.noExperimental': 'Nenhuma versão experimental disponível no momento. Você está na versão mais recente.',
    'appShell.update.networkError': 'Não foi possível alcançar o servidor de atualização. Verifique sua conexão e tente novamente.',
    'appShell.update.checkFailed': 'Verificação de atualização falhou. Tente novamente mais tarde.',
  },
  en: {
    'appShell.splash.starting': 'Starting…',
    'appShell.splash.startingBackend': 'Starting backend…',
    'appShell.splash.loadingComponents': 'Loading components…',
    'appShell.splash.almostReady': 'Almost ready…',
    'appShell.splash.backendFailed': 'Backend failed to start',
    'appShell.splash.startupFailed': 'Maestro Studio couldn\'t start: ',
    'appShell.splash.connectingBackend': 'Connecting to dev backend…',
    'appShell.splash.viewLogs': 'View logs',
    'appShell.splash.restart': 'Restart',
    'appShell.splash.quit': 'Quit',
    'appShell.boot.stillStartingWin': 'Still starting — Windows Defender is scanning files (first launch only)…',
    'appShell.boot.stillStartingMac': 'Still starting — macOS is verifying the bundle (first launch only)…',
    'appShell.boot.stillStartingGeneric': 'Still starting (first launch is slower than subsequent launches)…',
    'appShell.boot.takingTooLongWin': 'Backend is taking longer than usual. Defender scans of 14k files can take a few minutes on slow drives.',
    'appShell.boot.takingTooLongMac': 'Backend is taking longer than usual. macOS first-launch checks can be slow on cold cache.',
    'appShell.boot.takingTooLongGeneric': 'Backend is taking longer than usual. You can wait, view logs, or restart.',
    'appShell.crash.title': 'Maestro Studio needs to reload',
    'appShell.crash.message': 'Maestro Studio had repeated UI errors and stopped auto-recovering.',
    'appShell.crash.detail': 'Reload to try again, or quit if this keeps happening.',
    'appShell.crash.reload': 'Reload',
    'appShell.crash.quit': 'Quit',
    'appShell.context.noSuggestions': 'No spelling suggestions',
    'appShell.context.addDict': 'Add to Dictionary',
    'appShell.context.openNewTab': 'Open Link in New Tab',
    'appShell.context.copyLink': 'Copy Link',
    'appShell.context.openImageNewTab': 'Open Image in New Tab',
    'appShell.context.copyImage': 'Copy Image',
    'appShell.context.copyImageAddr': 'Copy Image Address',
    'appShell.context.back': 'Back',
    'appShell.context.forward': 'Forward',
    'appShell.context.reload': 'Reload',
    'appShell.context.inspect': 'Inspect Element',
    'appShell.update.noExperimental': 'No experimental builds available right now. You are on the latest version.',
    'appShell.update.networkError': 'Could not reach the update server. Check your connection and try again.',
    'appShell.update.checkFailed': 'Update check failed. Please try again later.',
  },
};

// Current language (defaults to pt-BR).
let currentLanguage = 'pt-BR';

// The splash paints before any renderer exists, so the language has to come off disk. Mirrors
// backend/config/paths.py: MAESTRO_DATA_ROOT wins, else userData/data matches the packaged
// %APPDATA%/Maestro Studio/data layout. Honouring the override keeps e2e and dev runs (which point
// DATA_ROOT elsewhere) from silently falling back and showing an `en` user a pt-BR splash.
function resolveBootLanguage(app) {
  const override = (process.env.MAESTRO_DATA_ROOT || '').trim();
  const dataRoot = override ? path.resolve(override) : path.join(app.getPath('userData'), 'data');
  try {
    const raw = fs.readFileSync(path.join(dataRoot, 'settings', 'settings.json'), 'utf8');
    const settings = JSON.parse(raw);
    if (settings && (settings.language === 'pt-BR' || settings.language === 'en')) {
      currentLanguage = settings.language;
      return currentLanguage;
    }
  } catch (_) {
    // No settings yet (fresh install) or unreadable; pt-BR is the app default, so fall through.
  }
  return 'pt-BR';
}

// Get a translated string by key, optionally interpolating variables.
function t(key, vars) {
  const text = locales[currentLanguage] && locales[currentLanguage][key]
    ? locales[currentLanguage][key]
    : (locales.en[key] || key);

  if (!vars) return text;

  // Simple variable interpolation: replace {{varName}} with vars.varName
  return text.replace(/\{\{(\w+)\}\}/g, (match, varName) => {
    return vars[varName] != null ? String(vars[varName]) : match;
  });
}

// Set the current language and optionally persist (caller handles IPC/storage).
function setLanguage(lang) {
  if (lang === 'pt-BR' || lang === 'en') {
    currentLanguage = lang;
    return lang;
  }
  return currentLanguage;
}

// Export the module API.
module.exports = {
  locales,
  t,
  setLanguage,
  resolveBootLanguage,
  getCurrentLanguage: () => currentLanguage,
};
