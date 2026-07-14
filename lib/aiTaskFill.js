const Anthropic = require('@anthropic-ai/sdk');

function isConfigured() {
  return !!process.env.ANTHROPIC_API_KEY;
}

// Forced tool-use with strict:true guarantees the shape below — every field
// must be listed in `required` (empty string / null is how the model opts
// out of an optional field, since strict schemas can't have true optionals).
const TASK_FORM_TOOL = {
  name: 'fill_task_form',
  description: 'Fill out the "Add a schedule line" form fields from a natural-language statement describing a task.',
  input_schema: {
    type: 'object',
    properties: {
      topLevelWbs: { type: 'string', description: 'WBS number of the top-level task this belongs under, chosen from the provided list of top-level tasks. Best guess if not explicitly stated.' },
      existingSubtaskWbs: { type: 'string', description: 'WBS number of an existing subtask (from the provided list) to place this under, if one clearly matches the statement. Empty string if none matches.' },
      newSubtaskTitle: { type: 'string', description: "Title for a brand-new subtask grouping to create first, only if the statement implies a new category with no existing match. Empty string otherwise." },
      title: { type: 'string', description: 'Short, clear title for this task / line item.' },
      startDate: { type: 'string', description: 'Start date in YYYY-MM-DD format. Default to the current date given in context if not otherwise implied.' },
      deadline: { type: 'string', description: 'Deadline in YYYY-MM-DD format. Resolve relative dates ("next Friday", "in two weeks") using the current date given in context.' },
      lead: { type: 'string', description: 'Person responsible for the task, matched against the provided leads list when possible. Empty string if no one is mentioned.' },
      status: { type: 'string', enum: ['', 'Not Started', 'In Progress', 'Complete'], description: 'Status only if explicitly stated or strongly implied; otherwise empty string so it auto-derives from percent complete.' },
      weight: { type: 'integer', enum: [1, 2, 3], description: 'Rollup weight: 1=Low, 2=Medium, 3=High. Infer from language about size, recurrence, or importance. Default to 2 if unclear.' },
      pct: { type: 'integer', description: 'Percent complete, 0-100. Default 0 if not mentioned.' },
      notes: { type: 'string', description: 'Any extra context that does not fit the other fields. Empty string if none.' },
    },
    required: ['topLevelWbs', 'existingSubtaskWbs', 'newSubtaskTitle', 'title', 'startDate', 'deadline', 'lead', 'status', 'weight', 'pct', 'notes'],
    additionalProperties: false,
  },
  strict: true,
};

async function parseTaskStatement(transcript, context) {
  if (!isConfigured()) throw new Error('AI task fill is not configured on the server yet.');
  const client = new Anthropic();

  const { today, topLevel, subtasks, leads } = context;
  const system = [
    `Today's date is ${today}. Resolve all relative dates ("next Friday", "in two weeks", "tomorrow") relative to this date.`,
    `Top-level tasks (wbs — title): ${topLevel.map(t => `${t.wbs} — ${t.title}`).join('; ') || 'none'}`,
    `Existing subtasks (wbs — title, under top-level wbs): ${subtasks.map(s => `${s.wbs} — ${s.title} (under ${s.top})`).join('; ') || 'none'}`,
    `Known leads: ${leads.join(', ') || 'none'}`,
    'Extract the task described by the user into the fill_task_form tool. Pick the closest matching top-level task and existing subtask by meaning, not just exact keyword overlap. Only propose a new subtask title if nothing existing fits.',
  ].join('\n\n');

  const message = await client.messages.create({
    model: 'claude-opus-4-8',
    max_tokens: 1024,
    output_config: { effort: 'low' },
    system,
    tools: [TASK_FORM_TOOL],
    tool_choice: { type: 'tool', name: 'fill_task_form' },
    messages: [{ role: 'user', content: transcript }],
  });

  const toolUse = message.content.find(b => b.type === 'tool_use');
  if (!toolUse) throw new Error('The AI did not return structured fields — try rephrasing.');
  return toolUse.input;
}

module.exports = { isConfigured, parseTaskStatement };
