// Pure computation for "drag task X to before/after/into target Y" moves.
// Given the full flat task list (any order) and a move request, works out the
// full new WBS numbering + sort order + phase inheritance for every row that
// changes. Renumbering is a full recompute (not an incremental shift) — with
// a task list this small that's simplest to get right: reorder the flat
// pre-order sequence, then walk it once assigning fresh per-depth counters.
// Rollups, Gantt position, and is_leaf status all fall out for free elsewhere
// once wbs/sort are persisted, since those are derived from wbs prefixes.

function wbsLevel(wbs) {
  return wbs.split('.').length;
}

// Returns the [startIdx, endIdx] (inclusive, into `sorted`) of rootRow and
// every row whose wbs is nested under it — a contiguous block in pre-order.
function blockRange(sorted, rootRow) {
  const prefix = rootRow.wbs + '.';
  const startIdx = sorted.findIndex(r => r.id === rootRow.id);
  let endIdx = startIdx;
  for (let i = startIdx + 1; i < sorted.length; i++) {
    if (sorted[i].wbs.startsWith(prefix)) endIdx = i; else break;
  }
  return [startIdx, endIdx];
}

// rows: full flat task list. draggedId/targetId: task ids. position: 'before' | 'after' | 'into'.
// Returns { error } on an illegal move, or { changes: Map<id, {wbs, sort, phase}> }
// containing only the rows whose wbs/sort/phase actually changed.
function computeMove(rows, draggedId, targetId, position) {
  const byId = new Map(rows.map(r => [r.id, r]));
  const dragged = byId.get(draggedId);
  const target = byId.get(targetId);
  if (!dragged) return { error: 'Dragged task not found.' };
  if (!target) return { error: 'Drop target not found.' };
  if (dragged.id === target.id) return { error: 'Cannot drop a task onto itself.' };
  if (target.wbs === dragged.wbs || target.wbs.startsWith(dragged.wbs + '.')) {
    return { error: 'Cannot move a task under one of its own subtasks.' };
  }
  if (!['before', 'after', 'into'].includes(position)) {
    return { error: 'Invalid drop position.' };
  }

  const sorted = [...rows].sort((a, b) => a.sort - b.sort);

  const [dragStart, dragEnd] = blockRange(sorted, dragged);
  const draggedBlock = sorted.slice(dragStart, dragEnd + 1);
  const draggedIds = new Set(draggedBlock.map(r => r.id));

  const remaining = sorted.filter(r => !draggedIds.has(r.id));
  const targetIdx = remaining.findIndex(r => r.id === target.id);
  const [, targetEndInRemaining] = blockRange(remaining, target);

  const targetDepth = wbsLevel(target.wbs) - 1; // 0-indexed
  let insertAt;
  let newRootDepth;
  if (position === 'before') {
    insertAt = targetIdx;
    newRootDepth = targetDepth;
  } else if (position === 'after') {
    insertAt = targetEndInRemaining + 1;
    newRootDepth = targetDepth;
  } else {
    insertAt = targetEndInRemaining + 1;
    newRootDepth = targetDepth + 1;
  }

  const draggedRootDepth = wbsLevel(dragged.wbs) - 1;
  const depthShift = newRootDepth - draggedRootDepth;

  const finalOrder = [
    ...remaining.slice(0, insertAt).map(r => ({ row: r, depth: wbsLevel(r.wbs) - 1 })),
    ...draggedBlock.map(r => ({ row: r, depth: (wbsLevel(r.wbs) - 1) + depthShift })),
    ...remaining.slice(insertAt).map(r => ({ row: r, depth: wbsLevel(r.wbs) - 1 })),
  ];

  // Walk in final order, maintaining one running counter per depth. Entering
  // a shallower depth truncates any deeper counters (they're stale once
  // we've moved past that subtree).
  const counters = [];
  const newWbsById = new Map();
  for (const { row, depth } of finalOrder) {
    counters[depth] = (counters[depth] || 0) + 1;
    counters.length = depth + 1;
    newWbsById.set(row.id, counters.join('.'));
  }

  // Phase is inherited from whichever row ends up at the top-level wbs of
  // each row's ancestry — recomputed for everyone, which is a no-op for
  // rows whose top-level ancestor didn't change.
  const phaseByTopWbs = new Map();
  for (const { row } of finalOrder) {
    const newWbs = newWbsById.get(row.id);
    if (!newWbs.includes('.')) phaseByTopWbs.set(newWbs, row.phase);
  }

  const changes = new Map();
  finalOrder.forEach(({ row }, idx) => {
    const newWbs = newWbsById.get(row.id);
    const topWbs = newWbs.split('.')[0];
    const newPhase = phaseByTopWbs.get(topWbs) ?? row.phase;
    if (row.wbs !== newWbs || row.sort !== idx || row.phase !== newPhase) {
      changes.set(row.id, { wbs: newWbs, sort: idx, phase: newPhase });
    }
  });

  return { changes };
}

module.exports = { computeMove };
