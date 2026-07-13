import React, { useCallback, useEffect, useRef, useState } from "react";
import { Box, Text, render, useApp, useInput } from "ink";
import Spinner from "ink-spinner";
import path from "node:path";
import { executeTask } from "./run-task.js";
import { loadConfig, saveProjectConfig } from "../config/loader.js";
import type { AlexusConfig } from "../config/schema.js";
import type { AlexusEvent, EventSink } from "../protocol/events.js";
import type {
  ApprovalPrompt,
  ApprovalRequest,
  ApprovalResponse,
} from "../security/approval-manager.js";
import { SessionStore, type StoredPlanStep } from "../sessions/sqlite-store.js";
import { PACKAGE_VERSION } from "../utils/version.js";
import { detectProject, formatProjectProfile } from "../project/project-detector.js";
import { buildProjectContextReport, type ContextStats } from "../context/context-builder.js";
import { buildSessionReport, formatSessionReport } from "../sessions/session-report.js";
import { providerApiKey, saveProviderApiKey } from "../config/credentials.js";
import { listModels } from "../providers/openrouter/models.js";
import type { AlexusModel } from "../providers/openrouter/types.js";

interface ToolView {
  id: string;
  name: string;
  status: "requested" | "running" | "completed" | "failed" | "reused";
  durationMs?: number;
  arguments?: unknown;
  error?: string;
  output?: string;
}

interface UsageView {
  promptTokens: number;
  completionTokens: number;
  cost: number;
}

interface PlanView {
  explanation?: string;
  steps: StoredPlanStep[];
}

export interface ConversationEntry {
  id: number;
  role: "user" | "assistant" | "system";
  text: string;
}

export function appendConversationEntry(
  entries: ConversationEntry[],
  entry: ConversationEntry,
  maxCharacters = 60_000,
): ConversationEntry[] {
  const next = [...entries, { ...entry, text: entry.text.slice(-10_000) }];
  let characters = next.reduce((total, item) => total + item.text.length, 0);
  while (next.length > 1 && characters > maxCharacters) {
    characters -= next[0]!.text.length;
    next.shift();
  }
  return next;
}

type ProviderDialog =
  | { stage: "provider" }
  | { stage: "api-key"; apiKey: string; hasExisting: boolean }
  | { stage: "loading-models" }
  | { stage: "model"; query: string; models: AlexusModel[]; selected: number }
  | { stage: "custom-model"; modelId: string };

export function filterProviderModels(models: AlexusModel[], query: string): AlexusModel[] {
  const normalized = query.trim().toLowerCase();
  return models
    .filter(
      (model) =>
        model.tools &&
        (!normalized ||
          model.id.toLowerCase().includes(normalized) ||
          model.name.toLowerCase().includes(normalized)),
    )
    .sort((left, right) => {
      const leftStarts = left.id.toLowerCase().startsWith(normalized) ? 1 : 0;
      const rightStarts = right.id.toLowerCase().startsWith(normalized) ? 1 : 0;
      return rightStarts - leftStarts || left.id.localeCompare(right.id);
    });
}

function eventPlan(value: unknown): StoredPlanStep[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const steps: StoredPlanStep[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) return undefined;
    const candidate = item as { step?: unknown; status?: unknown };
    if (
      typeof candidate.step !== "string" ||
      (candidate.status !== "pending" &&
        candidate.status !== "in_progress" &&
        candidate.status !== "completed")
    )
      return undefined;
    steps.push({ step: candidate.step, status: candidate.status });
  }
  return steps;
}

interface PendingApproval {
  request: ApprovalRequest;
  resolve: (response: ApprovalResponse) => void;
}

interface ComposerProps {
  active: boolean;
  onSubmit: (value: string) => void;
}

export const SLASH_COMMANDS = [
  { command: "/help", description: "mostra tutti i comandi" },
  { command: "/status", description: "stato del progetto e configurazione" },
  { command: "/context", description: "mostra il contesto selezionato" },
  { command: "/compact", description: "compatta la conversazione" },
  { command: "/new", description: "inizia una nuova conversazione" },
  { command: "/review", description: "report verificabile della sessione" },
  { command: "/provider", description: "cambia provider o chiave API" },
  { command: "/model", description: "cerca o cambia modello" },
  { command: "/permissions", description: "cambia i permessi" },
  { command: "/diff", description: "mostra le modifiche" },
  { command: "/undo", description: "annulla le modifiche della sessione" },
  { command: "/sessions", description: "elenca le sessioni" },
  { command: "/plan", description: "crea o mostra un piano" },
  { command: "/goal", description: "esegue un obiettivo autonomo" },
  { command: "/clear", description: "pulisce la schermata" },
  { command: "/exit", description: "chiude Alexus" },
] as const;

export function slashCommandSuggestions(input: string) {
  if (!input.startsWith("/") || input.includes("\n") || input.includes(" ")) return [];
  const query = input.toLowerCase();
  return SLASH_COMMANDS.filter((item) => item.command.startsWith(query)).slice(0, 7);
}

function Composer({ active, onSubmit }: ComposerProps): React.ReactElement {
  const [value, setValue] = useState("");
  const [cursor, setCursor] = useState(0);
  const [selectedSuggestion, setSelectedSuggestion] = useState(0);
  const suggestions = slashCommandSuggestions(value);

  useInput(
    (input, key) => {
      if (suggestions.length && key.downArrow) {
        setSelectedSuggestion((current) => (current + 1) % suggestions.length);
        return;
      }
      if (suggestions.length && key.upArrow) {
        setSelectedSuggestion((current) => (current - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (suggestions.length && key.tab) {
        const completion = `${suggestions[selectedSuggestion % suggestions.length]!.command} `;
        setValue(completion);
        setCursor(completion.length);
        setSelectedSuggestion(0);
        return;
      }
      if (key.return) {
        if (key.shift) {
          setValue((current) => `${current.slice(0, cursor)}\n${current.slice(cursor)}`);
          setCursor((current) => current + 1);
        } else if (value.trim()) {
          onSubmit(value.trim());
          setValue("");
          setCursor(0);
          setSelectedSuggestion(0);
        }
        return;
      }
      if (key.backspace || key.delete) {
        if (cursor > 0) {
          setValue((current) => current.slice(0, cursor - 1) + current.slice(cursor));
          setCursor((current) => current - 1);
          setSelectedSuggestion(0);
        }
        return;
      }
      if (key.leftArrow) return setCursor((current) => Math.max(0, current - 1));
      if (key.rightArrow) return setCursor((current) => Math.min(value.length, current + 1));
      if (key.ctrl && input === "a") return setCursor(0);
      if (key.ctrl && input === "e") return setCursor(value.length);
      if (input && !key.ctrl && !key.meta) {
        setValue((current) => current.slice(0, cursor) + input + current.slice(cursor));
        setCursor((current) => current + input.length);
        setSelectedSuggestion(0);
      }
    },
    { isActive: active },
  );

  const before = value.slice(0, cursor);
  const current = value[cursor] ?? " ";
  const after = value.slice(cursor + (cursor < value.length ? 1 : 0));
  return (
    <Box flexDirection="column">
      <Box borderStyle="round" borderColor={active ? "cyan" : "gray"} paddingX={1}>
        <Text color="cyan">› </Text>
        <Text>{before}</Text>
        <Text inverse={active}>{current === "\n" ? "↵" : current}</Text>
        <Text>{after}</Text>
      </Box>
      {suggestions.length ? (
        <Box flexDirection="column" paddingX={2}>
          {suggestions.map((suggestion, index) => (
            <Text
              key={suggestion.command}
              bold={index === selectedSuggestion % suggestions.length}
              {...(index === selectedSuggestion % suggestions.length
                ? { color: "cyan" as const }
                : {})}
            >
              {index === selectedSuggestion % suggestions.length ? "›" : " "} {suggestion.command}{" "}
              <Text dimColor>— {suggestion.description}</Text>
            </Text>
          ))}
          <Text dimColor>↑↓ seleziona · Tab completa · Invio esegue</Text>
        </Box>
      ) : null}
    </Box>
  );
}

function updateTool(tools: ToolView[], id: string, patch: Partial<ToolView>): ToolView[] {
  return tools.map((tool) => (tool.id === id ? { ...tool, ...patch } : tool));
}

function appendToolOutput(tools: ToolView[], id: string, output: string): ToolView[] {
  return tools.map((tool) =>
    tool.id === id ? { ...tool, output: `${tool.output ?? ""}${output}`.slice(-4000) } : tool,
  );
}

function AlexusTui({ workspaceRoot }: { workspaceRoot: string }): React.ReactElement {
  const { exit } = useApp();
  const [config, setConfig] = useState<AlexusConfig>();
  const [busy, setBusy] = useState(false);
  const [assistant, setAssistant] = useState("");
  const [conversation, setConversation] = useState<ConversationEntry[]>([]);
  const [tools, setTools] = useState<ToolView[]>([]);
  const [notice, setNotice] = useState("Pronto. /help mostra i comandi disponibili.");
  const [verification, setVerification] = useState<string>();
  const [expanded, setExpanded] = useState(false);
  const [approval, setApproval] = useState<PendingApproval>();
  const [usage, setUsage] = useState<UsageView>({
    promptTokens: 0,
    completionTokens: 0,
    cost: 0,
  });
  const [verificationPlan, setVerificationPlan] = useState<string[]>([]);
  const [contextStats, setContextStats] = useState<ContextStats>();
  const [sessionId, setSessionId] = useState<string>();
  const [compactNext, setCompactNext] = useState(false);
  const [plan, setPlan] = useState<PlanView>();
  const [providerDialog, setProviderDialog] = useState<ProviderDialog>();
  const abortRef = useRef<AbortController | undefined>(undefined);
  const conversationIdRef = useRef(0);

  useEffect(() => {
    void loadConfig(workspaceRoot)
      .then(setConfig)
      .catch((error: unknown) => {
        setNotice(error instanceof Error ? error.message : String(error));
      });
  }, [workspaceRoot]);

  const eventSink: EventSink = useCallback((value: AlexusEvent) => {
    if (value.type === "assistant.delta" && typeof value.text === "string") {
      const delta = value.text;
      setAssistant((current) => `${current}${delta}`);
    }
    if (value.type === "tool.requested")
      setTools((current) => [
        ...current,
        {
          id: String(value.toolCallId),
          name: String(value.tool),
          status: "requested",
          arguments: value.arguments,
        },
      ]);
    if (value.type === "tool.started")
      setTools((current) => updateTool(current, String(value.toolCallId), { status: "running" }));
    if (value.type === "tool.completed")
      setTools((current) =>
        updateTool(current, String(value.toolCallId), {
          status: value.success ? "completed" : "failed",
          durationMs: Number(value.durationMs ?? 0),
          ...(typeof value.error === "string" ? { error: value.error } : {}),
        }),
      );
    if (value.type === "tool.reused")
      setTools((current) => updateTool(current, String(value.toolCallId), { status: "reused" }));
    if (
      value.type === "command.output" &&
      typeof value.toolCallId === "string" &&
      typeof value.text === "string"
    ) {
      const toolCallId = value.toolCallId;
      const output = value.text;
      setTools((current) => appendToolOutput(current, toolCallId, output));
    }
    if (value.type === "usage.updated") {
      setUsage({
        promptTokens: typeof value.promptTokens === "number" ? value.promptTokens : 0,
        completionTokens: typeof value.completionTokens === "number" ? value.completionTokens : 0,
        cost: typeof value.estimatedCost === "number" ? value.estimatedCost : 0,
      });
    }
    if (value.type === "verification.plan" && Array.isArray(value.commands)) {
      setVerificationPlan(
        value.commands.flatMap((command) => {
          if (typeof command !== "object" || command === null) return [];
          const label = (command as { label?: unknown }).label;
          return typeof label === "string" ? [label] : [];
        }),
      );
    }
    if (
      value.type === "context.built" &&
      typeof value.filesIndexed === "number" &&
      typeof value.filesIncluded === "number" &&
      typeof value.estimatedTokens === "number" &&
      typeof value.budgetTokens === "number"
    ) {
      setContextStats({
        filesIndexed: value.filesIndexed,
        filesIncluded: value.filesIncluded,
        estimatedTokens: value.estimatedTokens,
        budgetTokens: value.budgetTokens,
        truncated: value.truncated === true,
      });
    }
    if (value.type === "context.compacted")
      setNotice(
        `Contesto compattato: ${String(value.beforeTokens)} → ${String(value.afterTokens)} token.`,
      );
    if (value.type === "plan.updated") {
      const steps = eventPlan(value.plan);
      if (steps)
        setPlan({
          steps,
          ...(typeof value.explanation === "string" ? { explanation: value.explanation } : {}),
        });
    }
    if (
      value.type === "session.completed" &&
      (value.verification === "verified" ||
        value.verification === "partial" ||
        value.verification === "unverified")
    )
      setVerification(value.verification);
  }, []);

  const approvalPrompt: ApprovalPrompt = useCallback(
    (request) => new Promise((resolve) => setApproval({ request, resolve })),
    [],
  );

  const answerApproval = useCallback(
    (response: ApprovalResponse) => {
      approval?.resolve(response);
      setApproval(undefined);
    },
    [approval],
  );

  const loadModelDialog = useCallback(async () => {
    setProviderDialog({ stage: "loading-models" });
    setNotice("Caricamento modelli OpenRouter…");
    try {
      const models = (await listModels(workspaceRoot, true)).filter((model) => model.tools);
      setProviderDialog({ stage: "model", query: "", models, selected: 0 });
      setNotice(`${models.length} modelli con tool calling disponibili.`);
    } catch (error) {
      setProviderDialog(undefined);
      setNotice(error instanceof Error ? error.message : String(error));
    }
  }, [workspaceRoot]);

  const selectModel = useCallback(
    async (modelId: string) => {
      const current = await loadConfig(workspaceRoot);
      const updated: AlexusConfig = { ...current, model: modelId };
      await saveProjectConfig(workspaceRoot, updated);
      setConfig(updated);
      setProviderDialog(undefined);
      setNotice(`Modello impostato: ${modelId}`);
    },
    [workspaceRoot],
  );

  useInput((input, key) => {
    if (approval) {
      if (input === "y") answerApproval("once");
      if (input === "a") answerApproval("session");
      if (input === "n" || key.escape || (key.ctrl && input === "c")) answerApproval("deny");
      return;
    }
    if (providerDialog) {
      if (key.escape || (key.ctrl && input === "c")) {
        setProviderDialog(undefined);
        setNotice("Configurazione provider annullata.");
        return;
      }
      if (providerDialog.stage === "provider") {
        if (key.return || input === "1")
          setProviderDialog({
            stage: "api-key",
            apiKey: "",
            hasExisting: Boolean(providerApiKey("openrouter")),
          });
        return;
      }
      if (providerDialog.stage === "api-key") {
        if (key.return) {
          const apiKey = providerDialog.apiKey.trim();
          if (!apiKey && providerDialog.hasExisting) {
            setNotice("Chiave OpenRouter mantenuta. Caricamento modelli…");
            void loadModelDialog();
            return;
          }
          if (apiKey.length < 12) {
            setNotice("La chiave API inserita non sembra valida.");
            return;
          }
          setProviderDialog({ stage: "loading-models" });
          void saveProviderApiKey("openrouter", apiKey)
            .then(() => {
              process.env.OPENROUTER_API_KEY = apiKey;
              setNotice("Chiave OpenRouter salvata. Caricamento modelli…");
              return loadModelDialog();
            })
            .catch((error: unknown) => {
              setProviderDialog(undefined);
              setNotice(error instanceof Error ? error.message : String(error));
            });
          return;
        }
        if (key.backspace || key.delete) {
          setProviderDialog({
            stage: "api-key",
            apiKey: providerDialog.apiKey.slice(0, -1),
            hasExisting: providerDialog.hasExisting,
          });
          return;
        }
        if (input && !key.ctrl && !key.meta)
          setProviderDialog({
            stage: "api-key",
            apiKey: `${providerDialog.apiKey}${input}`,
            hasExisting: providerDialog.hasExisting,
          });
        return;
      }
      if (providerDialog.stage === "model") {
        const matches = filterProviderModels(providerDialog.models, providerDialog.query);
        if (key.ctrl && input === "n") {
          setProviderDialog({ stage: "custom-model", modelId: providerDialog.query.trim() });
          setNotice("Inserimento ID modello personalizzato.");
          return;
        }
        if (key.downArrow) {
          setProviderDialog({
            ...providerDialog,
            selected: matches.length ? (providerDialog.selected + 1) % matches.length : 0,
          });
          return;
        }
        if (key.upArrow) {
          setProviderDialog({
            ...providerDialog,
            selected: matches.length
              ? (providerDialog.selected - 1 + matches.length) % matches.length
              : 0,
          });
          return;
        }
        if (key.tab && matches.length) {
          setProviderDialog({
            ...providerDialog,
            query: matches[providerDialog.selected % matches.length]!.id,
            selected: 0,
          });
          return;
        }
        if (key.return) {
          const exact = providerDialog.models.find(
            (model) => model.id.toLowerCase() === providerDialog.query.trim().toLowerCase(),
          );
          const modelId = exact?.id ?? matches[providerDialog.selected % matches.length]?.id;
          if (!modelId) {
            setNotice("Digita un ID modello oppure selezionane uno.");
            return;
          }
          setProviderDialog({ stage: "loading-models" });
          void selectModel(modelId).catch((error: unknown) => {
            setProviderDialog(undefined);
            setNotice(error instanceof Error ? error.message : String(error));
          });
          return;
        }
        if (key.backspace || key.delete) {
          setProviderDialog({
            ...providerDialog,
            query: providerDialog.query.slice(0, -1),
            selected: 0,
          });
          return;
        }
        if (input && !key.ctrl && !key.meta)
          setProviderDialog({
            ...providerDialog,
            query: `${providerDialog.query}${input}`,
            selected: 0,
          });
        return;
      }
      if (providerDialog.stage === "custom-model") {
        if (key.return) {
          const modelId = providerDialog.modelId.trim();
          if (!modelId) {
            setNotice("Inserisci l'ID completo del modello, per esempio provider/modello.");
            return;
          }
          setProviderDialog({ stage: "loading-models" });
          void selectModel(modelId).catch((error: unknown) => {
            setProviderDialog(undefined);
            setNotice(error instanceof Error ? error.message : String(error));
          });
          return;
        }
        if (key.backspace || key.delete) {
          setProviderDialog({
            stage: "custom-model",
            modelId: providerDialog.modelId.slice(0, -1),
          });
          return;
        }
        if (input && !key.ctrl && !key.meta)
          setProviderDialog({
            stage: "custom-model",
            modelId: `${providerDialog.modelId}${input}`,
          });
        return;
      }
      return;
    }
    if (key.ctrl && input === "o") setExpanded((current) => !current);
    if (key.ctrl && input === "c") {
      if (busy) abortRef.current?.abort();
      else exit();
    }
  });

  const showDiff = useCallback(async () => {
    const store = new SessionStore(workspaceRoot);
    try {
      const session = store.latest();
      setNotice(
        session ? (await store.diff(session.id)) || "Nessuna modifica." : "Nessuna sessione.",
      );
    } finally {
      store.close();
    }
  }, [workspaceRoot]);

  const runSlashCommand = useCallback(
    async (input: string): Promise<boolean> => {
      const [command, ...parts] = input.split(/\s+/);
      if (command === "/exit" || command === "/quit") {
        exit();
        return true;
      }
      if (command === "/clear") {
        setAssistant("");
        setConversation([]);
        setTools([]);
        setNotice("Schermata pulita.");
        return true;
      }
      if (command === "/new") {
        setSessionId(undefined);
        setAssistant("");
        setConversation([]);
        setTools([]);
        setContextStats(undefined);
        setPlan(undefined);
        setNotice("Nuova conversazione pronta.");
        return true;
      }
      if (command === "/context") {
        const current = await loadConfig(workspaceRoot);
        const report = await buildProjectContextReport(
          workspaceRoot,
          parts.join(" ") || "analizza il progetto",
          current.maxContextTokens,
          current.respectGitignore,
        );
        setContextStats(report.stats);
        setNotice(
          `Contesto: ${report.stats.filesIndexed} file indicizzati, ${report.stats.filesIncluded} inclusi, ${report.stats.estimatedTokens}/${report.stats.budgetTokens} token.\n${report.rankedFiles
            .slice(0, 10)
            .map((file) => `${file.score}  ${file.path}`)
            .join("\n")}`,
        );
        return true;
      }
      if (command === "/compact") {
        setCompactNext(true);
        setNotice("La conversazione verrà compattata prima del prossimo prompt.");
        return true;
      }
      if (command === "/review") {
        const store = new SessionStore(workspaceRoot);
        try {
          const selected = sessionId ? store.get(sessionId) : store.latest();
          setNotice(
            selected
              ? formatSessionReport(await buildSessionReport(store, selected.id))
              : "Nessuna sessione.",
          );
        } finally {
          store.close();
        }
        return true;
      }
      if (command === "/plan" && (parts.length === 0 || parts[0] === "show")) {
        const store = new SessionStore(workspaceRoot);
        try {
          const selected = sessionId ? store.get(sessionId) : store.latest();
          const stored = selected ? store.plan(selected.id) : undefined;
          setPlan(
            stored
              ? {
                  steps: stored.steps,
                  ...(stored.explanation ? { explanation: stored.explanation } : {}),
                }
              : undefined,
          );
          setNotice(stored ? `Piano della sessione ${stored.sessionId}.` : "Nessun piano salvato.");
        } finally {
          store.close();
        }
        return true;
      }
      if (command === "/plan" && parts[0] === "clear") {
        const store = new SessionStore(workspaceRoot);
        try {
          const selected = sessionId ? store.get(sessionId) : store.latest();
          if (selected) store.clearPlan(selected.id);
          setPlan(undefined);
          setNotice("Piano cancellato.");
        } finally {
          store.close();
        }
        return true;
      }
      if (command === "/help") {
        setNotice(
          "/status  /context [task]  /compact  /new  /review  /provider  /model  /permissions <mode>  /diff  /undo  /sessions  /plan <task>|show|clear  /goal <task>  /clear  /exit\nCtrl+O dettagli tool · Ctrl+C annulla/esce · Shift+Enter nuova riga",
        );
        return true;
      }
      if (command === "/provider") {
        setProviderDialog({ stage: "provider" });
        setNotice("Seleziona il provider da configurare.");
        return true;
      }
      if (command === "/model") {
        if (parts.length) {
          await selectModel(parts.join(" "));
          return true;
        }
        if (!providerApiKey("openrouter")) {
          setProviderDialog({ stage: "provider" });
          setNotice("Configura prima la chiave OpenRouter.");
        } else await loadModelDialog();
        return true;
      }
      if (command === "/status") {
        const current = await loadConfig(workspaceRoot);
        setConfig(current);
        const profile = await detectProject(workspaceRoot);
        setNotice(
          `Model: ${current.model}\nMode: ${current.approvalMode}\nMax steps: ${current.maxSteps}${profile ? `\n${formatProjectProfile(profile)}` : ""}`,
        );
        return true;
      }
      if (command === "/permissions") {
        const mode = parts[0];
        if (mode !== "readonly" && mode !== "workspace" && mode !== "full-access") {
          setNotice("Uso: /permissions readonly|workspace|full-access");
          return true;
        }
        const current = await loadConfig(workspaceRoot);
        const updated: AlexusConfig = { ...current, approvalMode: mode };
        await saveProjectConfig(workspaceRoot, updated);
        setConfig(updated);
        setNotice(`Permessi impostati su ${mode}.`);
        return true;
      }
      if (command === "/diff") {
        await showDiff();
        return true;
      }
      if (command === "/sessions") {
        const store = new SessionStore(workspaceRoot);
        try {
          setNotice(
            store
              .list()
              .slice(0, 10)
              .map((session) => `${session.id}  ${session.status}  ${session.task}`)
              .join("\n") || "Nessuna sessione.",
          );
        } finally {
          store.close();
        }
        return true;
      }
      if (command === "/undo") {
        const store = new SessionStore(workspaceRoot);
        try {
          const session = store.latest();
          setNotice(
            session
              ? `Ripristinati: ${(await store.undo(session.id)).join(", ") || "nessun file"}`
              : "Nessuna sessione.",
          );
        } finally {
          store.close();
        }
        return true;
      }
      return false;
    },
    [exit, loadModelDialog, selectModel, sessionId, showDiff, workspaceRoot],
  );

  const submit = useCallback(
    async (rawInput: string) => {
      if (busy) return;
      try {
        if (rawInput.startsWith("/") && (await runSlashCommand(rawInput))) return;
        const isPlan = rawInput.startsWith("/plan ");
        const isGoal = rawInput.startsWith("/goal ");
        const task = isPlan
          ? `Crea soltanto un piano dettagliato senza modificare file: ${rawInput.slice(6)}`
          : isGoal
            ? `Completa autonomamente questo obiettivo e verificane i criteri di riuscita: ${rawInput.slice(6)}`
            : rawInput;
        setConversation((current) =>
          appendConversationEntry(current, {
            id: ++conversationIdRef.current,
            role: "user",
            text: rawInput,
          }),
        );
        setBusy(true);
        setAssistant("");
        setTools([]);
        setVerification(undefined);
        setVerificationPlan([]);
        setUsage({ promptTokens: 0, completionTokens: 0, cost: 0 });
        setNotice(
          isPlan ? "Pianificazione in corso…" : isGoal ? "Obiettivo in corso…" : "Task in corso…",
        );
        const controller = new AbortController();
        abortRef.current = controller;
        const result = await executeTask(workspaceRoot, task, {
          embedded: true,
          eventSink,
          approvalPrompt,
          signal: controller.signal,
          ...(sessionId ? { resumeSessionId: sessionId } : {}),
          ...(compactNext ? { forceCompact: true } : {}),
          ...(isPlan ? { approvalMode: "readonly" as const } : {}),
        });
        setSessionId(result.sessionId);
        setCompactNext(false);
        setNotice(`Sessione ${result.sessionId} completata in ${result.steps} step.`);
        setVerification(result.verification);
        setConversation((current) =>
          appendConversationEntry(current, {
            id: ++conversationIdRef.current,
            role: "assistant",
            text: result.finalMessage,
          }),
        );
        setAssistant("");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setNotice(message);
        setConversation((current) =>
          appendConversationEntry(current, {
            id: ++conversationIdRef.current,
            role: "system",
            text: `Errore: ${message}`,
          }),
        );
      } finally {
        abortRef.current = undefined;
        setBusy(false);
      }
    },
    [approvalPrompt, busy, compactNext, eventSink, runSlashCommand, sessionId, workspaceRoot],
  );

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box justifyContent="space-between">
        <Text bold color="cyan">
          Alexus CLI v{PACKAGE_VERSION}
        </Text>
        <Text dimColor>{config?.model ?? "caricamento…"}</Text>
      </Box>
      <Text dimColor>
        {path.basename(workspaceRoot)} · {config?.approvalMode ?? "…"}
        {sessionId ? ` · ${sessionId}` : ""}
      </Text>
      <Box marginTop={1} flexDirection="column">
        {conversation.map((entry) => (
          <Box key={entry.id} flexDirection="column" marginBottom={1}>
            <Text
              bold
              color={entry.role === "user" ? "cyan" : entry.role === "assistant" ? "green" : "red"}
            >
              {entry.role === "user" ? "Tu" : entry.role === "assistant" ? "Alexus" : "Sistema"}
            </Text>
            <Text>{entry.text}</Text>
          </Box>
        ))}
        {assistant ? (
          <Box flexDirection="column" marginBottom={1}>
            <Text bold color="green">
              Alexus
            </Text>
            <Text>{assistant.slice(-5000)}</Text>
          </Box>
        ) : null}
        {tools.map((tool) => (
          <Box key={tool.id} flexDirection="column">
            <Text
              color={
                tool.status === "failed"
                  ? "red"
                  : tool.status === "completed" || tool.status === "reused"
                    ? "green"
                    : "yellow"
              }
            >
              {tool.status === "running" ? (
                <Spinner type="dots" />
              ) : tool.status === "failed" ? (
                "✗"
              ) : tool.status === "completed" || tool.status === "reused" ? (
                "✓"
              ) : (
                "→"
              )}{" "}
              {tool.name} {tool.durationMs !== undefined ? `${tool.durationMs} ms` : ""}
            </Text>
            {expanded ? (
              <Text dimColor>
                {JSON.stringify(tool.arguments, null, 2)}
                {tool.error ? `\n${tool.error}` : ""}
              </Text>
            ) : null}
            {tool.output ? <Text dimColor>{tool.output}</Text> : null}
          </Box>
        ))}
      </Box>
      {plan ? (
        <Box flexDirection="column" borderStyle="round" borderColor="blue" paddingX={1}>
          <Text bold color="blue">
            Piano
          </Text>
          {plan.explanation ? <Text dimColor>{plan.explanation}</Text> : null}
          {plan.steps.map((item, index) => (
            <Text
              key={`${String(index)}-${item.step}`}
              {...(item.status === "completed"
                ? { color: "green" as const }
                : item.status === "in_progress"
                  ? { color: "yellow" as const }
                  : {})}
            >
              {item.status === "completed" ? "✓" : item.status === "in_progress" ? "→" : "○"}{" "}
              {item.step}
            </Text>
          ))}
        </Box>
      ) : null}
      <Box marginTop={1}>
        {busy ? (
          <Text color="yellow">
            <Spinner type="dots" /> Alexus sta lavorando
          </Text>
        ) : null}
        {verification ? (
          <Text color={verification === "verified" ? "green" : "yellow"}>
            {" "}
            {verification.toUpperCase()}
          </Text>
        ) : null}
        {usage.promptTokens + usage.completionTokens > 0 ? (
          <Text dimColor>
            {" "}
            {usage.promptTokens.toLocaleString()} in / {usage.completionTokens.toLocaleString()} out
            {usage.cost > 0 ? ` · $${usage.cost.toFixed(4)}` : ""}
          </Text>
        ) : null}
      </Box>
      {verificationPlan.length ? (
        <Text dimColor>Verifiche automatiche: {verificationPlan.join(" · ")}</Text>
      ) : null}
      {contextStats ? (
        <Text dimColor>
          Contesto: {contextStats.filesIncluded}/{contextStats.filesIndexed} file ·{" "}
          {contextStats.estimatedTokens.toLocaleString()}/
          {contextStats.budgetTokens.toLocaleString()} token
        </Text>
      ) : null}
      <Box marginY={1}>
        <Text dimColor>{notice}</Text>
      </Box>
      {providerDialog ? (
        <Box borderStyle="double" borderColor="cyan" paddingX={1} flexDirection="column">
          {providerDialog.stage === "provider" ? (
            <>
              <Text bold>Provider disponibili</Text>
              <Text color="cyan">› 1. OpenRouter</Text>
              <Text dimColor>Invio seleziona · Esc annulla</Text>
            </>
          ) : providerDialog.stage === "api-key" ? (
            <>
              <Text bold>Chiave API OpenRouter</Text>
              <Text>{"•".repeat(providerDialog.apiKey.length)} </Text>
              <Text dimColor>
                {providerDialog.hasExisting && !providerDialog.apiKey
                  ? "Invio mantiene la chiave esistente · Digita per sostituirla · Esc annulla"
                  : "Invio salva · Esc annulla"}
              </Text>
            </>
          ) : providerDialog.stage === "loading-models" ? (
            <Text color="yellow">
              <Spinner type="dots" /> Caricamento…
            </Text>
          ) : providerDialog.stage === "custom-model" ? (
            <>
              <Text bold>ID modello personalizzato</Text>
              <Text color="cyan">{providerDialog.modelId} </Text>
              <Text dimColor>Digita provider/modello · Invio salva · Esc annulla</Text>
            </>
          ) : (
            <>
              <Text bold>Seleziona modello OpenRouter</Text>
              <Text>
                Cerca o digita ID: <Text color="cyan">{providerDialog.query} </Text>
              </Text>
              {filterProviderModels(providerDialog.models, providerDialog.query)
                .slice(
                  Math.floor(providerDialog.selected / 8) * 8,
                  Math.floor(providerDialog.selected / 8) * 8 + 8,
                )
                .map((model, index) => {
                  const absoluteIndex = Math.floor(providerDialog.selected / 8) * 8 + index;
                  return (
                    <Text
                      key={model.id}
                      {...(absoluteIndex === providerDialog.selected
                        ? { color: "cyan" as const, bold: true }
                        : {})}
                    >
                      {absoluteIndex === providerDialog.selected ? "›" : " "} {model.id}{" "}
                      <Text dimColor>— {model.name}</Text>
                    </Text>
                  );
                })}
              <Text dimColor>
                {filterProviderModels(providerDialog.models, providerDialog.query).length
                  ? `${providerDialog.selected + 1}/${filterProviderModels(providerDialog.models, providerDialog.query).length} · `
                  : "Nessun risultato · "}
                ↑↓ scorri tutti · Tab copia ID · Ctrl+N ID custom · Invio seleziona · Esc annulla
              </Text>
            </>
          )}
        </Box>
      ) : approval ? (
        <Box borderStyle="double" borderColor="yellow" paddingX={1} flexDirection="column">
          <Text bold>
            Approvazione richiesta: {approval.request.command} {approval.request.args.join(" ")}
          </Text>
          <Text>
            {approval.request.reason} · rischio {approval.request.risk}
          </Text>
          <Text>[y] una volta [a] sessione [n] rifiuta</Text>
        </Box>
      ) : (
        <Composer active={!busy && !providerDialog} onSubmit={(value) => void submit(value)} />
      )}
    </Box>
  );
}

export async function startTui(workspaceRoot: string): Promise<void> {
  const instance = render(<AlexusTui workspaceRoot={workspaceRoot} />);
  await instance.waitUntilExit();
}
