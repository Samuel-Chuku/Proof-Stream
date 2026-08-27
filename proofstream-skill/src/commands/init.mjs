import { install } from './install.mjs';

export async function init({ target = process.cwd(), agent } = {}) {
  const root = target;
  const selected = agent === 'codex' ? '.codex/skills' : agent === 'claude' ? '.claude/skills' : '.agents/skills';
  return install({ target: `${root}/${selected}/proofstream-integration`, base: root });
}
