/** Locale-owned copy for the better-interact workbench. */
import type {} from '@deepseek-ai/dsh-client-ui-slots'

/** Dictionary namespace of the better-interact client copy. */
export const NS = 'betterInteract'

/** Chinese dictionary and key source. */
export const zh = {
  'command.open': '打开工作台',
  'command.next': '下一个工作区',
  'command.previous': '上一个工作区',
  'tabs.label': '工作区',
  'workbench.empty': '还没有会话',
  'bubbles.label': '助手输出',
}

/** English dictionary. */
export const en: typeof zh = {
  'command.open': 'Open workbench',
  'command.next': 'Next workspace',
  'command.previous': 'Previous workspace',
  'tabs.label': 'Workspaces',
  'workbench.empty': 'No session yet',
  'bubbles.label': 'Agent output',
}

/** Japanese dictionary. */
export const ja: typeof zh = {
  'command.open': 'ワークベンチを開く',
  'command.next': '次のワークスペース',
  'command.previous': '前のワークスペース',
  'tabs.label': 'ワークスペース',
  'workbench.empty': 'セッションはまだありません',
  'bubbles.label': 'エージェントの出力',
}

/** Spanish dictionary. */
export const es: typeof zh = {
  'command.open': 'Abrir el espacio de trabajo',
  'command.next': 'Espacio de trabajo siguiente',
  'command.previous': 'Espacio de trabajo anterior',
  'tabs.label': 'Espacios de trabajo',
  'workbench.empty': 'Todavía no hay sesión',
  'bubbles.label': 'Salida del agente',
}

/** French dictionary. */
export const fr: typeof zh = {
  'command.open': 'Ouvrir l’espace de travail',
  'command.next': 'Espace de travail suivant',
  'command.previous': 'Espace de travail précédent',
  'tabs.label': 'Espaces de travail',
  'workbench.empty': 'Aucune session pour l’instant',
  'bubbles.label': 'Sortie de l’agent',
}

/** German dictionary. */
export const de: typeof zh = {
  'command.open': 'Arbeitsbereich öffnen',
  'command.next': 'Nächster Arbeitsbereich',
  'command.previous': 'Vorheriger Arbeitsbereich',
  'tabs.label': 'Arbeitsbereiche',
  'workbench.empty': 'Noch keine Sitzung',
  'bubbles.label': 'Agentenausgabe',
}

/** Russian dictionary. */
export const ru: typeof zh = {
  'command.open': 'Открыть рабочий стол',
  'command.next': 'Следующий рабочий стол',
  'command.previous': 'Предыдущий рабочий стол',
  'tabs.label': 'Рабочие столы',
  'workbench.empty': 'Сеансов пока нет',
  'bubbles.label': 'Вывод агента',
}

/** Portuguese dictionary. */
export const pt: typeof zh = {
  'command.open': 'Abrir a área de trabalho',
  'command.next': 'Próxima área de trabalho',
  'command.previous': 'Área de trabalho anterior',
  'tabs.label': 'Áreas de trabalho',
  'workbench.empty': 'Ainda não há sessão',
  'bubbles.label': 'Saída do agente',
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Workbench dialog copy. */
    'betterInteract': keyof typeof zh
  }
}
