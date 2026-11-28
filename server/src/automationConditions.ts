export type AutomationTrigger = 'new_match' | 'closing_soon';
export type AutomationConditions = { region?: string; category?: string; keywords?: string[]; minAffinity?: number; daysBeforeClose?: number };
export type AutomationCandidate = { code: string; title: string; region: string; category: string; text: string; score: number | null; eventKey: string; dueAt: Date | null };
const normalize = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es-CL');

export function automationCandidateMatches(candidate: AutomationCandidate, conditions: AutomationConditions, trigger: AutomationTrigger) {
  if (conditions.region && !normalize(candidate.region).includes(normalize(conditions.region))) return false;
  if (conditions.category && !normalize(candidate.category).includes(normalize(conditions.category))) return false;
  if (conditions.keywords?.length && !conditions.keywords.some(term => normalize(candidate.text).includes(normalize(term)))) return false;
  if (conditions.minAffinity != null && (trigger !== 'new_match' || candidate.score == null || candidate.score < conditions.minAffinity)) return false;
  return true;
}
