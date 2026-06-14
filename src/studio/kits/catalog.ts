// The kit registry. This is the single source of truth for what game mechanics
// exist; it feeds the wizard's system prompt and gates which kit ids are valid.

import type { KitId } from '../spec';

export type Kit = {
  id: KitId;
  label: string; // chip text shown to the kid
  verb: string;
  blurb: string; // one line describing the kit + what it needs, for the system prompt
};

export const KITS: Kit[] = [
  {
    id: 'catcher',
    label: 'Catch things 🧺',
    verb: 'catch',
    blurb:
      'catcher — move side to side to CATCH good things for points and dodge bad things. Needs: a hero, 1–2 good things to catch, 1–2 bad things to avoid.',
  },
  {
    id: 'dodger',
    label: 'Dodge things 🚀',
    verb: 'dodge',
    blurb:
      'dodger — move to AVOID falling hazards and survive as long as you can. Needs: a hero and 1–3 bad things to dodge.',
  },
  {
    id: 'shooter',
    label: 'Blast things 💥',
    verb: 'shoot',
    blurb:
      'shooter — auto-fire upward and BLAST targets before they reach the bottom. Needs: a hero and 1–2 kinds of targets to blast (these go in "good").',
  },
];

export function kitCatalogForPrompt(): string {
  return KITS.map((k) => `- ${k.blurb}`).join('\n');
}
