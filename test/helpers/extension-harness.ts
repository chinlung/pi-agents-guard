import type {
	AgentSettledEvent,
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
	SessionShutdownEvent,
	SessionStartEvent,
	ToolCallEvent,
	ToolResultEvent,
	TurnEndEvent,
} from "@earendil-works/pi-coding-agent";
import { vi } from "vitest";
import activate from "../../src/index.js";

type HarnessEvent =
	| SessionStartEvent
	| SessionShutdownEvent
	| TurnEndEvent
	| AgentSettledEvent
	| ToolCallEvent
	| ToolResultEvent;

type HarnessOptions = {
	cwd: string;
	sessionId: string;
	agentDir: string;
	flag?: string;
	child?: boolean;
	hasUI?: boolean;
	notifyFailure?: () => void;
	signal?: AbortSignal;
	exec: ExtensionAPI["exec"];
	activate?: (pi: ExtensionAPI) => void;
};

type Command = Parameters<ExtensionAPI["registerCommand"]>[1];
// Pi's overloaded event API is erased only inside this test adapter. Callers
// still supply complete, typed events, dispatched by their discriminator.
type CapturedHandler = (event: never, ctx: ExtensionContext) => unknown;

function strictFake<T extends object>(fields: Partial<T>): T {
	return new Proxy(fields, {
		get(target, key, receiver) {
			if (!Object.hasOwn(target, key)) {
				throw new Error(`Unexpected host dependency: ${String(key)}`);
			}
			return Reflect.get(target, key, receiver);
		},
	}) as T;
}

export function createExtensionHarness(options: HarnessOptions) {
	const env = {
		PI_CODING_AGENT_DIR: options.agentDir,
		AGENTS_GUARD: undefined,
		PI_SUBAGENT_CHILD: options.child ? "1" : undefined,
	};
	const previous = new Map(
		Object.keys(env).map((key) => [key, process.env[key]]),
	);
	for (const [key, value] of Object.entries(env)) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}

	const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
	const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
	const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
	let disposed = false;
	const dispose = () => {
		if (disposed) return;
		disposed = true;
		for (const [key, value] of previous) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		consoleLog.mockRestore();
		consoleWarn.mockRestore();
		consoleError.mockRestore();
	};

	try {
		const handlers = new Map<string, CapturedHandler[]>();
		const commands = new Map<string, Command>();
		const notices: Array<{ message: string; level: string | undefined }> = [];
		const entries: Array<{ customType: string; data: unknown }> = [];
		const messages: Array<{ message: unknown; options: unknown }> = [];
		const ui = strictFake<ExtensionContext["ui"]>({
			notify: (message, level) => {
				options.notifyFailure?.();
				notices.push({ message, level });
			},
		});
		const ctx = strictFake<ExtensionCommandContext>({
			get cwd() {
				return options.cwd;
			},
			hasUI: options.hasUI ?? true,
			mode: options.hasUI === false ? "print" : "tui",
			signal: options.signal,
			ui,
			sessionManager: strictFake<ExtensionContext["sessionManager"]>({
				getSessionId: () => options.sessionId,
			}),
		});
		const api = strictFake<ExtensionAPI>({
			on: ((name: string, handler: CapturedHandler) => {
				const registered = handlers.get(name) ?? [];
				registered.push(handler);
				handlers.set(name, registered);
			}) as ExtensionAPI["on"],
			registerFlag: (name) => {
				if (name !== "agents-guard") throw new Error(`Unexpected flag ${name}`);
			},
			getFlag: (name) => {
				if (name !== "agents-guard") throw new Error(`Unexpected flag ${name}`);
				return options.flag;
			},
			registerCommand: (name, command) => {
				if (commands.has(name)) throw new Error(`Duplicate command ${name}`);
				commands.set(name, command);
			},
			exec: options.exec,
			appendEntry: (customType, data) => entries.push({ customType, data }),
			sendMessage: (message, delivery) =>
				messages.push({ message, options: delivery }),
		});
		(options.activate ?? activate)(api);
		const command = commands.get("agents-guard");
		if (command === undefined) throw new Error("Missing agents-guard command");
		return {
			notices,
			entries,
			messages,
			consoleLog,
			consoleWarn,
			consoleError,
			setContext: (
				next: Partial<Pick<HarnessOptions, "cwd" | "sessionId">>,
			) => {
				Object.assign(options, next);
			},
			registeredEvents: () =>
				[...handlers].flatMap(([name, items]) => items.map(() => name)),
			async fire(event: HarnessEvent): Promise<unknown> {
				const registered = handlers.get(event.type) ?? [];
				const handler = registered[0];
				if (registered.length !== 1 || handler === undefined) {
					throw new Error(
						`Expected one ${event.type} handler, got ${registered.length}`,
					);
				}
				return await handler(event as never, ctx);
			},
			command: (args: string) => command.handler(args, ctx),
			completions: (prefix: string) =>
				command.getArgumentCompletions?.(prefix) ?? null,
			dispose,
		};
	} catch (error) {
		dispose();
		throw error;
	}
}
