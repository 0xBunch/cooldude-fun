// Phase 2 test harness — drive the wizard from the terminal with chips/typing,
// then assemble and write the finished game. Proves the loop (kid's words -> spec
// -> playable game) before any server/DB/auth scaffolding.
//
//   ANTHROPIC_API_KEY=sk-ant-... npx tsx scripts/wizard-repl.ts
//
// Tap a chip by number, or just type/"talk" your own idea. "build" assembles the
// game, "quit" exits.

import { createInterface } from 'node:readline/promises';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startSession, turn } from '../src/studio/wizard';
import { finalizeSpec } from '../src/studio/spec';
import { assemble } from '../src/studio/assembler';

async function main(): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('Set ANTHROPIC_API_KEY first:  ANTHROPIC_API_KEY=sk-ant-... npx tsx scripts/wizard-repl.ts');
    process.exit(1);
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const session = startSession();
  console.log('\n🎮  COOL DUDEZ STUDIO — wizard REPL  (type "quit" to exit)\n');

  let step = await turn(session.id, '');
  for (;;) {
    console.log('\n🤖  ' + step.prompt);
    step.chips.forEach((c, i) => console.log(`    ${i + 1}. ${c}`));
    if (step.allowFreeform) console.log('    (or talk/type your own idea)');
    if (step.done) console.log('\n  ✅ Looks complete — type "build" to make the game.');

    const ans = (await rl.question('\n›  ')).trim();
    if (ans.toLowerCase() === 'quit') break;

    if (ans.toLowerCase() === 'build' || (step.done && ans === '')) {
      const spec = finalizeSpec(session.spec);
      const out = join(process.cwd(), 'studio-phase0', 'wizard-game.html');
      mkdirSync(join(process.cwd(), 'studio-phase0'), { recursive: true });
      writeFileSync(out, assemble(spec));
      console.log(`\n🎉  Built ${out}`);
      console.log(`    spec: ${JSON.stringify(spec)}\n`);
      break;
    }

    // A bare number taps that chip; anything else is freeform input.
    const n = Number(ans);
    const input = Number.isInteger(n) && n >= 1 && n <= step.chips.length ? step.chips[n - 1] ?? ans : ans;
    step = await turn(session.id, input);
  }
  rl.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
