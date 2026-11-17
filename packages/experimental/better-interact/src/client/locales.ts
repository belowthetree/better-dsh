/** Locale-owned copy for the better-interact workbench. */
import type {} from '@deepseek-ai/dsh-client-ui-slots'

/** Dictionary namespace of the better-interact client copy. */
export const NS = 'betterInteract'

/** Chinese dictionary and key source. */
export const zh = {
  'command.open': '打开工作台',
  'command.newWorkspace': '新建工作区',
  'command.next': '下一个工作区',
  'command.previous': '上一个工作区',
  'command.sessions': '聚焦会话页签',
  'session.new': '新会话',
  'sessions.label': '会话',
  'tabs.label': '工作区',
  'workbench.empty': '还没有会话',
  'workbench.createFailed': '无法创建此工作区',
  'bubbles.label': '助手输出',
}

/** English dictionary. */
export const en: typeof zh = {
  'command.open': 'Open workbench',
  'command.newWorkspace': 'New workspace',
  'command.next': 'Next workspace',
  'command.previous': 'Previous workspace',
  'command.sessions': 'Focus session tabs',
  'session.new': 'New session',
  'sessions.label': 'Sessions',
  'tabs.label': 'Workspaces',
  'workbench.empty': 'No session yet',
  'workbench.createFailed': 'Could not create this workspace',
  'bubbles.label': 'Agent output',
}

/** Japanese dictionary. */
export const ja: typeof zh = {
  'command.open': 'ワークベンチを開く',
  'command.newWorkspace': 'ワークスペースを新規作成',
  'command.next': '次のワークスペース',
  'command.previous': '前のワークスペース',
  'command.sessions': 'セッションタブにフォーカス',
  'session.new': '新しいセッション',
  'sessions.label': 'セッション',
  'tabs.label': 'ワークスペース',
  'workbench.empty': 'セッションはまだありません',
  'workbench.createFailed': 'このワークスペースを作成できませんでした',
  'bubbles.label': 'エージェントの出力',
}

/** Spanish dictionary. */
export const es: typeof zh = {
  'command.open': 'Abrir el espacio de trabajo',
  'command.newWorkspace': 'Nuevo espacio de trabajo',
  'command.next': 'Espacio de trabajo siguiente',
  'command.previous': 'Espacio de trabajo anterior',
  'command.sessions': 'Enfocar pestañas de sesión',
  'session.new': 'Nueva sesión',
  'sessions.label': 'Sesiones',
  'tabs.label': 'Espacios de trabajo',
  'workbench.empty': 'Todavía no hay sesión',
  'workbench.createFailed': 'No se pudo crear este espacio de trabajo',
  'bubbles.label': 'Salida del agente',
}

/** French dictionary. */
export const fr: typeof zh = {
  'command.open': 'Ouvrir l’espace de travail',
  'command.newWorkspace': 'Nouvel espace de travail',
  'command.next': 'Espace de travail suivant',
  'command.previous': 'Espace de travail précédent',
  'command.sessions': 'Focaliser les onglets de session',
  'session.new': 'Nouvelle séance',
  'sessions.label': 'Séances',
  'tabs.label': 'Espaces de travail',
  'workbench.empty': 'Aucune session pour l’instant',
  'workbench.createFailed': 'Impossible de créer cet espace de travail',
  'bubbles.label': 'Sortie de l’agent',
}

/** German dictionary. */
export const de: typeof zh = {
  'command.open': 'Arbeitsbereich öffnen',
  'command.newWorkspace': 'Neuer Arbeitsbereich',
  'command.next': 'Nächster Arbeitsbereich',
  'command.previous': 'Vorheriger Arbeitsbereich',
  'command.sessions': 'Sitzungsregister fokussieren',
  'session.new': 'Neue Sitzung',
  'sessions.label': 'Sitzungen',
  'tabs.label': 'Arbeitsbereiche',
  'workbench.empty': 'Noch keine Sitzung',
  'workbench.createFailed': 'Dieser Arbeitsbereich konnte nicht erstellt werden',
  'bubbles.label': 'Agentenausgabe',
}

/** Russian dictionary. */
export const ru: typeof zh = {
  'command.open': 'Открыть рабочий стол',
  'command.newWorkspace': 'Новый рабочий стол',
  'command.next': 'Следующий рабочий стол',
  'command.previous': 'Предыдущий рабочий стол',
  'command.sessions': 'Перейти к вкладкам сеансов',
  'session.new': 'Новая сессия',
  'sessions.label': 'Сеансы',
  'tabs.label': 'Рабочие столы',
  'workbench.empty': 'Сеансов пока нет',
  'workbench.createFailed': 'Не удалось создать этот рабочий стол',
  'bubbles.label': 'Вывод агента',
}

/** Portuguese dictionary. */
export const pt: typeof zh = {
  'command.open': 'Abrir a área de trabalho',
  'command.newWorkspace': 'Nova área de trabalho',
  'command.next': 'Próxima área de trabalho',
  'command.previous': 'Área de trabalho anterior',
  'command.sessions': 'Focar abas de sessão',
  'session.new': 'Nova sessão',
  'sessions.label': 'Sessões',
  'tabs.label': 'Áreas de trabalho',
  'workbench.empty': 'Ainda não há sessão',
  'workbench.createFailed': 'Não foi possível criar esta área de trabalho',
  'bubbles.label': 'Saída do agente',
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Workbench dialog copy. */
    'betterInteract': keyof typeof zh
  }
}
