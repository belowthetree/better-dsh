/** Locale-owned copy for the better-interact workbench. */
import type {} from '@deepseek-ai/dsh-client-ui-slots'

/** Dictionary namespace of the better-interact client copy. */
export const NS = 'betterInteract'

/** Chinese dictionary and key source. */
export const zh = {
  'command.open': '打开工作台',
  'workbench.empty': '还没有会话',
  'bubbles.label': '助手输出',
}

/** English dictionary. */
export const en: typeof zh = {
  'command.open': 'Open workbench',
  'workbench.empty': 'No session yet',
  'bubbles.label': 'Agent output',
}

/** Japanese dictionary. */
export const ja: typeof zh = {
  'command.open': 'ワークベンチを開く',
  'workbench.empty': 'セッションはまだありません',
  'bubbles.label': 'エージェントの出力',
}

/** Spanish dictionary. */
export const es: typeof zh = {
  'command.open': 'Abrir el espacio de trabajo',
  'workbench.empty': 'Todavía no hay sesión',
  'bubbles.label': 'Salida del agente',
}

/** French dictionary. */
export const fr: typeof zh = {
  'command.open': 'Ouvrir l’espace de travail',
  'workbench.empty': 'Aucune session pour l’instant',
  'bubbles.label': 'Sortie de l’agent',
}

/** German dictionary. */
export const de: typeof zh = {
  'command.open': 'Arbeitsbereich öffnen',
  'workbench.empty': 'Noch keine Sitzung',
  'bubbles.label': 'Agentenausgabe',
}

/** Russian dictionary. */
export const ru: typeof zh = {
  'command.open': 'Открыть рабочий стол',
  'workbench.empty': 'Сеансов пока нет',
  'bubbles.label': 'Вывод агента',
}

/** Portuguese dictionary. */
export const pt: typeof zh = {
  'command.open': 'Abrir a área de trabalho',
  'workbench.empty': 'Ainda não há sessão',
  'bubbles.label': 'Saída do agente',
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Workbench dialog copy. */
    'betterInteract': keyof typeof zh
  }
}
