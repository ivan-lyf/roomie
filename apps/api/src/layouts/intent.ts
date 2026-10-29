import { readFileSync } from 'node:fs';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import {
  type Category,
  type Floorplan,
  type GenerationInputs,
  intentErrors,
  LayoutIntent,
  type Product,
} from '@roomie/schema';
import { z } from 'zod';
import { type ClaudeEffort, readerError, usageOf } from '../plan-reader/claude';
import { ReaderError, type ReaderUsage } from '../plan-reader/reader';
import { type Candidates, candidatesText } from './candidates';
import { describeHome } from './describe';

// The LLM's part of furnishing (PLAN.md M4): one call for the whole home, answering with a
// LayoutIntent (what goes where, as relations, never coordinates). The answer is checked: a
// malformed one, or one that picks products it wasn't offered, leaves out a must-have or goes
// over budget, is sent back once with what's wrong.

/** The prompt that asks for an intent, versioned: every layout records which one it used. */
export const LAYOUT_INTENT_PROMPT = {
  version: 'layout-intent.v1',
  text: readFileSync(new URL('../prompts/layout-intent.v1.md', import.meta.url), 'utf8'),
};

/** An intent runs a few thousand tokens, plus the model's reasoning. */
const MAX_TOKENS = 32_000;
const TIMEOUT_MS = 300_000;

/** What each style means, in the words the person picked it by. */
const STYLE_WORDS: Record<GenerationInputs['style'], string> = {
  scandinavian: 'light & natural: pale wood, white, soft textiles',
  modern: 'clean & modern: simple shapes, darker tones, little clutter',
  warm_minimal: 'warm & simple: few pieces, warm wood and earthy colours',
};

const FORMAT = (() => {
  const { type, schema } = zodOutputFormat(LayoutIntent);
  return { type, schema };
})();

/** Everything one home's intent is asked from and checked against. */
export type IntentRequest = {
  plan: Floorplan;
  inputs: GenerationInputs;
  candidates: Candidates;
};

export type IntentResult = {
  intent: LayoutIntent;
  /** What's still wrong with it after asking again, for the pipeline to work round. */
  problems: string[];
  model: string;
  usage: ReaderUsage;
  durationMs: number;
  /** The conversation so far, to ask for a repair in. */
  messages: Anthropic.MessageParam[];
};

/** The parts of the SDK client the writer uses, so tests can stand in for it. */
export type IntentClient = { messages: Pick<Anthropic['messages'], 'stream'> };

export type IntentOptions = {
  apiKey: string;
  model: string;
  effort: ClaudeEffort;
  client?: IntentClient;
  timeoutMs?: number;
};

export interface IntentWriter {
  model: string;
  promptVersion: string;
  /** Asks for a home's intent. */
  write(request: IntentRequest, signal?: AbortSignal): Promise<IntentResult>;
  /** Asks again in the same conversation, with what went wrong placing the last intent. */
  repair(
    previous: IntentResult,
    request: IntentRequest,
    feedback: string,
    signal?: AbortSignal,
  ): Promise<IntentResult>;
}

const cad = (v: number) => `$${v.toLocaleString('en-CA', { maximumFractionDigits: 0 })}`;

/** What the person asked for, in words. */
export function inputsText(plan: Floorplan, inputs: GenerationInputs): string {
  const name = (id: string) => plan.rooms.find((r) => r.id === id)?.name ?? id;
  const musts = Object.entries(inputs.mustHaves)
    .filter(([, categories]) => categories.length > 0)
    .map(([id, categories]) => `${name(id)} (${id}): ${categories.join(', ')}`);
  return [
    `Rooms to furnish: ${inputs.roomIds.map((id) => `${name(id)} (${id})`).join(', ')}.`,
    `Budget: ${cad(inputs.budgetCad)} CAD for everything.`,
    `Style: ${inputs.style} (${STYLE_WORDS[inputs.style]}).`,
    musts.length > 0 ? `Must have: ${musts.join('; ')}.` : 'No must-haves.',
  ].join('\n');
}

/** What's wrong with an intent for this request, in words the LLM can act on. */
export function intentProblems(intent: LayoutIntent, request: IntentRequest): string[] {
  const { plan, inputs, candidates } = request;
  const offered = new Map<string, Product>(
    [...candidates.values()].flat().map((p) => [p.articleNo, p]),
  );
  const problems = intentErrors(intent, new Set(inputs.roomIds), new Set(offered.keys()));
  for (const id of inputs.roomIds) {
    const room = intent.rooms.find((r) => r.roomId === id);
    const name = plan.rooms.find((r) => r.id === id)?.name ?? id;
    if (!room) {
      problems.push(`${name} (${id}) wasn't furnished.`);
      continue;
    }
    const has = new Set<Category>(
      room.items.flatMap((i) => {
        const p = offered.get(i.articleNo);
        return p ? [p.category] : [];
      }),
    );
    for (const c of inputs.mustHaves[id] ?? []) {
      if (!has.has(c)) problems.push(`${name} (${id}) must have a ${c}, and has none.`);
    }
  }
  const total = intent.rooms
    .flatMap((r) => r.items)
    .reduce((s, i) => s + (offered.get(i.articleNo)?.priceCad ?? 0), 0);
  if (total > inputs.budgetCad) {
    problems.push(
      `Everything adds up to ${cad(total)}, ${cad(total - inputs.budgetCad)} over the ` +
        `${cad(inputs.budgetCad)} budget: choose cheaper or fewer pieces.`,
    );
  }
  return problems;
}

/** The intent in an answer; throws with what's wrong when it's cut off or malformed. */
function readAnswer(message: Anthropic.Message): LayoutIntent {
  if (message.stop_reason === 'refusal') {
    const why = message.stop_details?.category ?? 'no reason given';
    throw new ReaderError(`Claude declined to furnish the home (${why}).`, 502);
  }
  if (message.stop_reason === 'max_tokens') throw new Error('the answer was cut off');
  const text = message.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new Error(`not JSON (${e instanceof Error ? e.message : String(e)})`, { cause: e });
  }
  const parsed = LayoutIntent.safeParse(json);
  if (!parsed.success) throw new Error(z.prettifyError(parsed.error));
  return parsed.data;
}

/** The first message: the prompt, the home, what was asked for, and the catalog to pick from. */
export function intentMessage(request: IntentRequest): string {
  const { plan, inputs, candidates } = request;
  return [
    LAYOUT_INTENT_PROMPT.text,
    '# The home',
    describeHome(plan, inputs.roomIds),
    '# What the person asked for',
    inputsText(plan, inputs),
    '# The catalog',
    candidatesText(candidates),
  ].join('\n\n');
}

/**
 * An intent writer on the Claude API: one streamed request per home, and one more when the
 * answer is cut off, malformed or breaks the request's rules.
 */
export function claudeIntentWriter(options: IntentOptions): IntentWriter {
  const client = options.client ?? new Anthropic({ apiKey: options.apiKey });

  async function ask(
    messages: Anthropic.MessageParam[],
    request: IntentRequest,
    signal?: AbortSignal,
  ): Promise<IntentResult> {
    const started = Date.now();
    const timeout = AbortSignal.timeout(options.timeoutMs ?? TIMEOUT_MS);
    const both = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const usage: ReaderUsage = { inputTokens: 0, outputTokens: 0 };
    let last: { intent: LayoutIntent; problems: string[] } | undefined;
    let problem = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      let message: Anthropic.Message;
      try {
        message = await client.messages
          .stream(
            {
              model: options.model,
              max_tokens: MAX_TOKENS,
              output_config: { effort: options.effort, format: FORMAT },
              messages,
            },
            { signal: both },
          )
          .finalMessage();
      } catch (e) {
        if (both.aborted) throw new ReaderError("Claude didn't answer in time.", 504);
        throw readerError(e, options.model);
      }
      usage.inputTokens += usageOf(message).inputTokens;
      usage.outputTokens += usageOf(message).outputTokens;
      messages.push({ role: 'assistant', content: message.content });
      try {
        const intent = readAnswer(message);
        const problems = intentProblems(intent, request);
        last = { intent, problems };
        if (problems.length === 0) break;
        problem = problems.join('\n');
      } catch (e) {
        if (e instanceof ReaderError) throw e;
        problem = e instanceof Error ? e.message : String(e);
      }
      if (attempt === 0) {
        messages.push({
          role: 'user',
          content:
            `That answer has problems:\n${problem}\n` +
            'Answer again with the whole home, as JSON that matches the schema.',
        });
      }
    }
    if (!last)
      throw new ReaderError(`Claude's answer wasn't a usable intent, twice: ${problem}`, 502);
    return { ...last, model: options.model, usage, durationMs: Date.now() - started, messages };
  }

  return {
    model: options.model,
    promptVersion: LAYOUT_INTENT_PROMPT.version,
    write: (request, signal) =>
      ask([{ role: 'user', content: intentMessage(request) }], request, signal),
    repair: (previous, request, feedback, signal) =>
      ask(
        [
          ...previous.messages,
          {
            role: 'user',
            content:
              `The layout program couldn't place everything:\n${feedback}\n` +
              'Change what you need to (smaller pieces, fewer pieces, another budget split) and ' +
              'answer again with the whole home, as JSON that matches the schema.',
          },
        ],
        request,
        signal,
      ),
  };
}
