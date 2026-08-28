/**
 * In-memory repositories.
 *
 * These are the reason `src/ports.ts` exists: the script, TTS and A/B services
 * are the parts of this system that most need exhaustive testing, and every one
 * of them would otherwise need a MySQL server standing behind it. They mirror
 * the Drizzle implementations' observable behaviour — replacement semantics,
 * occurrence accumulation, never overwriting a tuned pronunciation — so a test
 * that passes here is testing the same contract the real ones implement.
 */

import type {
  JobCompletion,
  JobCost,
  JobCreateInput,
  JobRepository,
  JobRow,
  LexiconRepository,
  PronunciationRepository,
  ScriptLineInput,
  ScriptRepository,
  StoredScriptLine,
  UnresolvedSightingInput,
  UnresolvedTermsRepository,
} from "@/ports";
import type { ResolvedLexiconEntry } from "@/script/resolve";

export type LexiconSeed = {
  termId: number;
  term: string;
  language: "gn" | "es" | "jopara";
  /** engine → speech form. `default` is the fallback, as in the real table. */
  forms: Record<string, string>;
};

export class MemoryLexiconRepository implements LexiconRepository {
  constructor(readonly seeds: LexiconSeed[]) {}

  async entriesForEngine(engine: string): Promise<ResolvedLexiconEntry[]> {
    return this.seeds.map((seed) => ({
      termId: seed.termId,
      term: seed.term,
      language: seed.language,
      speechForm: seed.forms[engine] ?? seed.forms.default ?? seed.term,
    }));
  }
}

export type PronunciationRecord = {
  termId: number;
  engine: string;
  speechForm: string;
  sampleAudioUrl: string | null;
};

export class MemoryPronunciationRepository implements PronunciationRepository {
  readonly rows: PronunciationRecord[] = [];
  private nextId = 1;

  async ensureForEngine(termId: number, engine: string, speechForm: string): Promise<number> {
    const existing = this.rows.find((r) => r.termId === termId && r.engine === engine);
    if (existing) return this.rows.indexOf(existing) + 1;
    this.rows.push({ termId, engine, speechForm, sampleAudioUrl: null });
    return this.nextId++;
  }

  async attachSample(termId: number, engine: string, sampleAudioUrl: string): Promise<void> {
    const row = this.rows.find((r) => r.termId === termId && r.engine === engine);
    if (row) row.sampleAudioUrl = sampleAudioUrl;
  }
}

export class MemoryUnresolvedTermsRepository implements UnresolvedTermsRepository {
  readonly rows: UnresolvedSightingInput[] = [];

  async record(sightings: UnresolvedSightingInput[]): Promise<void> {
    for (const sighting of sightings) {
      const existing = this.rows.find(
        (r) => r.term === sighting.term && r.language === sighting.language,
      );
      if (existing) {
        existing.occurrences += sighting.occurrences;
        if (sighting.scriptLineId !== null) existing.scriptLineId = sighting.scriptLineId;
      } else {
        this.rows.push({ ...sighting });
      }
    }
  }
}

export class MemoryScriptRepository implements ScriptRepository {
  private readonly scripts = new Map<string, number>();
  private readonly lines = new Map<number, StoredScriptLine[]>();
  private nextScriptId = 1;
  private nextLineId = 1;

  async replaceScript(input: {
    projectId: number;
    language: "es" | "gn";
    lines: ScriptLineInput[];
  }): Promise<{ scriptId: number; lines: StoredScriptLine[] }> {
    const key = `${input.projectId}:${input.language}`;
    let scriptId = this.scripts.get(key);
    if (scriptId === undefined) {
      scriptId = this.nextScriptId++;
      this.scripts.set(key, scriptId);
    }

    const stored = input.lines.map((line, index) => ({
      id: this.nextLineId++,
      lineNumber: index + 1,
      ...line,
    }));
    this.lines.set(scriptId, stored);
    return { scriptId, lines: stored };
  }

  async linesFor(scriptId: number): Promise<StoredScriptLine[]> {
    return this.lines.get(scriptId) ?? [];
  }
}

export type MemoryJob = JobRow & { completion?: JobCompletion };

export class MemoryJobRepository implements JobRepository {
  readonly jobs: MemoryJob[] = [];
  private nextId = 1;

  async create(input: JobCreateInput): Promise<number> {
    const id = this.nextId++;
    this.jobs.push({
      id,
      kind: input.kind,
      provider: input.provider,
      engine: input.engine,
      status: "pending",
      inputRef: input.inputRef,
      outputUrl: null,
      durationMs: null,
      costUsd: null,
      error: null,
    });
    return id;
  }

  async markRunning(id: number): Promise<void> {
    this.byId(id).status = "running";
  }

  async complete(id: number, completion: JobCompletion): Promise<void> {
    const job = this.byId(id);
    job.status = "completed";
    job.outputUrl = completion.outputUrl;
    job.durationMs = completion.durationMs;
    job.costUsd = completion.costUsd === null ? null : completion.costUsd.toFixed(6);
    job.completion = completion;
  }

  async fail(id: number, error: string, cost?: JobCost): Promise<void> {
    const job = this.byId(id);
    job.status = "failed";
    job.error = error;
    // Mirrors the Drizzle implementation: a failure after the provider charged
    // still records the spend, or a cost rollup would never see it.
    if (cost) {
      job.costUsd = cost.costUsd === null ? null : cost.costUsd.toFixed(6);
    }
  }

  async listByAbRun(abRunId: string): Promise<JobRow[]> {
    return this.jobs.filter((job) => job.inputRef?.abRunId === abRunId);
  }

  private byId(id: number): MemoryJob {
    const job = this.jobs.find((j) => j.id === id);
    if (!job) throw new Error(`No job ${id}`);
    return job;
  }
}
