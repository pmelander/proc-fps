import type { Mission } from './mission.js';

/**
 * Can one-way connections strand the player? A drop is a corridor you can take down but never
 * back up, so a level with drops is only fair if, wherever the player can get to (with whatever
 * keys they hold by then), the exit is still reachable.
 *
 * Searched over (room, keys held) states on the mission graph: rooms are internally connected
 * (every template keeps its ring walkable), keys are picked up by entering the room that holds
 * them (the mini boss and boss drop theirs), key doors need their key, and a one-way edge can only
 * be crossed away from its upper room. The level strands the player if some reachable state has no
 * way on to the exit. `validateGenerated` checks the built map the same way, cell by cell.
 *
 * @param oneWay edge index → the room it can only be left from (the drop's upper room).
 */
export function strandsPlayer(m: Mission, oneWay: ReadonlyMap<number, number>): boolean {
  const start = m.nodes.find((n) => n.kind === 'start')!.id;
  const exit = m.nodes.find((n) => n.kind === 'exit')!.id;
  const KEYSETS = 16;
  const id = (node: number, keys: number) => node * KEYSETS + keys;
  const withKey = (node: number, keys: number) => (m.nodes[node]!.key === undefined ? keys : keys | (1 << m.nodes[node]!.key!));

  const moves = (node: number, keys: number): number[] => {
    const out: number[] = [];
    m.edges.forEach((e, i) => {
      const to = e.a === node ? e.b : e.b === node ? e.a : -1;
      if (to < 0) return;
      const from = oneWay.get(i);
      if (from !== undefined && from !== node) return;
      if (e.door === 'key' && !(keys & (1 << e.key!))) return;
      out.push(id(to, withKey(to, keys)));
    });
    return out;
  };

  // Forward: every state the player can get into, with the moves out of it.
  const first = id(start, withKey(start, 0));
  const reached = new Set([first]);
  const into = new Map<number, number[]>(); // state → states that move into it
  const queue = [first];
  for (let i = 0; i < queue.length; i++) {
    const s = queue[i]!;
    for (const t of moves(Math.floor(s / KEYSETS), s % KEYSETS)) {
      const list = into.get(t);
      if (list) list.push(s);
      else into.set(t, [s]);
      if (!reached.has(t)) {
        reached.add(t);
        queue.push(t);
      }
    }
  }
  // Backward from the exit: states with a way on.
  const done = new Set([...reached].filter((s) => Math.floor(s / KEYSETS) === exit));
  const back = [...done];
  for (let i = 0; i < back.length; i++) {
    for (const s of into.get(back[i]!) ?? []) {
      if (!done.has(s)) {
        done.add(s);
        back.push(s);
      }
    }
  }
  return [...reached].some((s) => !done.has(s));
}
