import { LanguageModelEx, LanguageModelExCreateOptions } from "@/utils/built-in-ai-ex/LanguageModelEx";
import * as z from "zod";
import { DownloadResult, getLocalizedDateTimeString } from "./helper";
import { jsonrepair } from "jsonrepair";
import { StreamingProperty } from "../StreamingProperty";

/**
 * Defines the possible return types for a tool's execute function,
 * including string, image, and audio data types.
 */
export type ToolOutputValue = string | ImageBitmapSource | AudioBuffer | BufferSource;

// Define a generic type for a single tool
export type Tool<T extends z.ZodObject<any>> = {
    name: string;
    description: string;
    inputSchema: T;
    // The `execute` function can now return multimodal content.
    execute: (args: z.infer<T>) => Promise<ToolOutputValue>;
    examples: Array<z.infer<T>>;
};

// This helper function remains the same and is crucial for type inference.
export function createTool<T extends z.ZodObject<any>>(tool: Tool<T>): Tool<T> {
    return tool;
}

// Define a type for the main tools object
export type Tools = {
    [toolName: string]: Tool<z.ZodObject<any>>;
};

export type ToolFormat = "tool" | "text" | "snippet" | "detailed_snippet";

/**
 * Transforms the Tools object into an array of LanguageModelTool objects.
 *
 * @param tools - The object containing all the defined tools.
 * @returns An array of tools formatted as LanguageModelTool.
 */
export function formatToolsAsLanguageModelTool(tools: Tools): LanguageModelTool[] {
    // Get the names of all the tools (e.g., ["getWeather"])
    const toolNames = Object.keys(tools);

    // Map over each tool name to create the new structure
    // @ts-ignore - ToolOutputValue not valid with LanguageModelTool return
    return toolNames.map((toolName) => {
        const tool = tools[toolName];
        return {
            name: toolName,
            description: tool.description,
            // Convert the Zod schema to a JSON schema for broader compatibility
            inputSchema: z.toJSONSchema(tool.inputSchema),
            execute: tool.execute,
        };
    });
}

/**
 * Formats a Tools object into a human-readable plain text string.
 * This string can be used in a prompt to show a language model what tools are available.
 *
 * @param tools - The object containing all the defined tools.
 * @returns A formatted plain text string describing the tools.
 */
export function formatToolsAsPlainText(tools: Tools): string {
    const outputLines: string[] = [];

    if (Object.keys(tools).length === 0) {
        return "No tools available.";
    }

    outputLines.push("## Available Tools");

    for (const toolName in tools) {
        const tool = tools[toolName];
        outputLines.push(`### ${tool.name}`);

        outputLines.push(`- Name: ${tool.name}`);
        outputLines.push(`- Description: ${tool.description}`);

        const shape = tool.inputSchema.shape as Record<string, z.ZodTypeAny>;

        if (Object.keys(shape).length > 0) {
            outputLines.push(`- Input Schema:`);

            for (const paramName in shape) {
                const paramSchema = shape[paramName];
                let typeDescription = "unknown";

                // Use type-safe `instanceof` checks to determine the schema type
                if (paramSchema instanceof z.ZodEnum) {
                    // CORRECT: Use the public .options property to get enum values
                    const enumValues = paramSchema.options;
                    // @ts-ignore
                    typeDescription = `enum [${enumValues.map((v: string) => `"${v}"`).join(", ")}]`;
                } else if (paramSchema instanceof z.ZodString) {
                    typeDescription = "string";
                } else if (paramSchema instanceof z.ZodNumber) {
                    typeDescription = "number";
                } else if (paramSchema instanceof z.ZodBoolean) {
                    typeDescription = "boolean";
                }
                // Add more `else if` checks here for other Zod types if needed

                const description = paramSchema.description ? ` (${paramSchema.description})` : "";
                outputLines.push(`  - ${paramName}: ${typeDescription}${description}`);
            }
        }

        if (tool.examples && tool.examples.length > 0) {
            outputLines.push(`- Examples:`);
            for (const example of tool.examples) {
                outputLines.push(`  - ${JSON.stringify(example)}`);
            }
        }
        outputLines.push("");
    }

    return outputLines.join("\n").trim();
}


/**
 * Formats a Tools object into a highly compact, single-line-per-tool text format
 * that resembles function signatures, optimized for small prompt context.
 *
 * @param tools - The object containing all the defined tools.
 * @returns A token-efficient plain text string describing the tools.
 */
export function formatToolsAsSnippets(tools: Tools): string {
    const toolLines: string[] = [];

    for (const toolName in tools) {
        const tool = tools[toolName];
        const shape = tool.inputSchema.shape as Record<string, z.ZodTypeAny>;
        const params: string[] = [];

        for (const paramName in shape) {
            const paramSchema = shape[paramName];
            let typeDescription = "any";

            if (paramSchema instanceof z.ZodEnum) {
                // Format enums as TypeScript-style literal unions: "value1"|"value2" 
                // @ts-ignore
                typeDescription = paramSchema.options.map((v: string) => `"${v}"`).join("|");
            } else if (paramSchema instanceof z.ZodString) {
                typeDescription = "string";
            } else if (paramSchema instanceof z.ZodNumber) {
                typeDescription = "number";
            } else if (paramSchema instanceof z.ZodBoolean) {
                typeDescription = "boolean";
            }
            params.push(`${paramName}: ${typeDescription}`);
        }

        const paramsString = params.join(", ");
        const signature = `${tool.name}(${paramsString})`;

        const description = tool.description;

        // Use the first example if it exists
        const example = tool.examples?.[0]
            ? ` e.g., ${JSON.stringify(tool.examples[0])}`
            : "";

        toolLines.push(`${signature} // ${description}${example}`);
    }

    return toolLines.join("\n");
}


/**
 * Formats a Tools object into a compact but detailed single-line-per-tool
 * representation. Each line contains the function-like signature, followed by
 * a short description, the full input schema (including field descriptions
 * when available) and all examples. This is useful when you need a token-
 * efficient yet information rich summary of available tools.
 */
export function formatToolsAsDetailedSnippets(tools: Tools): string {
    const toolLines: string[] = [];

    for (const toolName in tools) {
        const tool = tools[toolName];
        const shape = tool.inputSchema.shape as Record<string, z.ZodTypeAny>;
        const params: string[] = [];

        for (const paramName in shape) {
            const paramSchema = shape[paramName];
            let typeDescription = "any";
            let desc = "";

            if (paramSchema instanceof z.ZodEnum) {
                // @ts-ignore
                typeDescription = paramSchema.options.map((v: string) => `"${v}"`).join("|");
            } else if (paramSchema instanceof z.ZodString) {
                typeDescription = "string";
            } else if (paramSchema instanceof z.ZodNumber) {
                typeDescription = "number";
            } else if (paramSchema instanceof z.ZodBoolean) {
                typeDescription = "boolean";
            } else if (paramSchema instanceof z.ZodArray) {
                // try to infer array item type
                // @ts-ignore
                const inner = (paramSchema._def?.type ?? null) as any;
                if (inner instanceof z.ZodString) typeDescription = "string[]";
                else if (inner instanceof z.ZodNumber) typeDescription = "number[]";
                else typeDescription = "array";
            }

            // Try to obtain a human readable description if provided
            // Zod exposes `description` as a property on the schema instance
            // but not always strongly typed; we'll guard access.
            // @ts-ignore
            if (paramSchema.description) desc = ` - ${String(paramSchema.description)}`;

            params.push(`${paramName}: ${typeDescription}${desc}`);
        }

        const paramsString = params.join(", ");
        const signature = `${tool.name}(${paramsString})`;

        const description = tool.description ? `${tool.description}` : "";

        // Include all examples in a compact form
        let examplesText = "";
        if (tool.examples && tool.examples.length > 0) {
            const exs = tool.examples.map((e) => JSON.stringify(e)).join("; ");
            examplesText = ` examples: ${exs}`;
        }

        // Include a JSON-schema-like representation of the input schema for
        // tools that have non-empty shapes. This keeps details available to
        // the model in a compact form.
        let schemaText = "";
        if (Object.keys(shape).length > 0) {
            const parts: string[] = [];
            for (const paramName in shape) {
                const paramSchema = shape[paramName];
                // Best-effort: include type and description
                let typeName = "any";
                if (paramSchema instanceof z.ZodString) typeName = "string";
                else if (paramSchema instanceof z.ZodNumber) typeName = "number";
                else if (paramSchema instanceof z.ZodBoolean) typeName = "boolean";
                else if (paramSchema instanceof z.ZodEnum) {
                    // @ts-ignore
                    typeName = `enum(${paramSchema.options.join("|")})`;
                }
                // @ts-ignore
                const pd = paramSchema.description ? `: ${String(paramSchema.description)}` : "";
                parts.push(`${paramName}=${typeName}${pd}`);
            }
            schemaText = ` schema[${parts.join(", ")}]`;
        }

        toolLines.push(`${signature} // ${description}${schemaText}${examplesText}`);
    }

    return toolLines.join("\n");
}

export function formatTools(tools: Tools, format: ToolFormat = "snippet") {
    if (format == "snippet") return formatToolsAsSnippets(tools);
    if (format == "detailed_snippet") return formatToolsAsDetailedSnippets(tools);
    if (format == "text") return formatToolsAsPlainText(tools);
    if (format == "tool") return formatToolsAsLanguageModelTool(tools);
    return tools;
}

export const ToolCallSchema = z.object({
    tool: z.string().describe("The name of the tool to be invoked."),
    args: z.object().meta({ additionalProperties: true }).describe("An object containing the arguments for the specified tool."),
});

export const ToolRouterSchema = z.object({
    tool_calls: z.array(ToolCallSchema).describe("A list of tool calls to be executed."),
});
// Infer the TypeScript type from the Zod schema
export type ToolResult = z.infer<typeof ToolRouterSchema>;

export const responseConstraint = z.object({
    thoughts:
        z.string()
            .describe("Your analizes and thoughts about the user prompt, considering the tools you have availible and your text generation habilities."),
    plan:
        z.array(
            z.string()
                .describe("Each plan step simplified description.")
        )
            .describe("Full plan to complete the user request splited in multiple steps, this plan will be used as reference for the next prompts and will be displayed to the user."),
    tool_calls:
        z.array(ToolCallSchema)
            .describe("The tool calls to be executed in order to get more info or complete the user request."),
    message:
        z.string()
            .describe("A message to tell the user while they waits for the result. Something cretive and informative, but also concise, be informative."),
});

type PublicProperties<T> = {
    [K in keyof T as T[K] extends (...args: any[]) => any ? never : K]: T[K]
}

interface AgentCreateOptions extends Omit<LanguageModelExCreateOptions, "tools"> {
    tools?: Tools;
    toolsFormat?: ToolFormat
}

// type AgentConstructor = Partial<PublicProperties<Agent>> & Pick<PublicProperties<Agent>, "">;


/** The overall status of the entire agent run. */
export type AgentStatus = "thinking" | "calling_tools" | "error" | "done";

/** The status of a single tool call within an iteration. */
export type ToolCallStatus = "pending" | "running" | "success" | "error";

/** Represents a single tool call and its eventual result. */
export type ToolCallLog = {
    readonly tool: string;
    readonly args: any;
    readonly status: ToolCallStatus;
    // The result can now be multimodal.
    readonly result?: ToolOutputValue;
    readonly error?: Error;
};

/** Represents the complete state of a single agent loop iteration. */
export type IterationLogEntry = {
    readonly iteration: number;
    readonly thoughts: string;
    readonly plan: readonly string[];
    readonly tool_calls: readonly ToolCallLog[];
    readonly message: string;
};

/**
 * The primary return object for a streaming agent run.
 * You can `await` its completion and subscribe to its properties for real-time updates.
 */
export type AgentRun = {
    /** The overall status of the agent's multi-step run. */
    readonly status: StreamingProperty<AgentStatus>;
    /** A growing log of all fully completed iterations. */
    readonly history: StreamingProperty<readonly IterationLogEntry[]>;
    /** The current iteration that is actively being processed. Will be `null` after completion or error. */
    readonly currentIteration: StreamingProperty<IterationLogEntry | null>;
    /** 
     * Allows you to `await` the entire run for completion.
     * `await run;`
     */
    then<TResult1 = void, TResult2 = never>(
        onfulfilled?: ((value: void) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
    ): Promise<TResult1 | TResult2>;
};

export class Agent {
    private internalModel: LanguageModelEx;
    private readonly options: AgentCreateOptions;
    private tools: Tools;

    protected constructor(nativeModel: LanguageModelEx, options: AgentCreateOptions) {
        this.internalModel = nativeModel;
        this.options = options;
        this.tools = options.tools ?? ({} as Tools);
    }

    public static support(): boolean {
        return LanguageModelEx.support();
    }

    public static async availability(options?: LanguageModelCreateCoreOptions): Promise<Availability> {
        return LanguageModelEx.availability(options);
    }

    public static async params(): Promise<LanguageModelParams> {
        return LanguageModelEx.params();
    }

    public static async download(options: LanguageModelExCreateOptions & { monitor?: CreateMonitorCallback } = {}): Promise<DownloadResult> {
        return LanguageModelEx.download(options);
    }

    // private static generateSystemPrompt({
    //     tools,
    //     userSystemPrompt,
    //     toolsFormat = "snippet"
    // }: {
    //     tools?: Tools;
    //     userSystemPrompt?: LanguageModelMessageContent[] | string;
    //     toolsFormat?: ToolFormat
    // }): string {
    //     if (tools) {
    //         return `
    //             You have the following tools availible to you use to help the user with its requests:
    //             ${formatTools(tools, toolsFormat)}

    //             When processing the user prompt:
    //             * Identify user intent concisely.
    //             * Check the tools listed above and confirm if the request can be fulfilled.
    //             * If executable, verify if you have all needed info and context.
    //             * If any context is missing, consider using the tools to obtain it.
    //             * If any context still missing after checking the tools analize carefully the provided image that is a user screenshot, consider using it as context.
    //             * Only use the ask tool as a last resort, when there are no viable alternatives or reasonable assumptions that would not significantly impact the request. Prefer to infer details or use defaults unless it would affect the accuracy or outcome in a meaningful way.
    //             * If all info is available, return the required JSON as specified.
    //             - Only ask the user if essential; use existing info if possible.
    //             - Keep thoughts brief and avoid duplicate information, especially where overlap with tool_calls might occur.
    //             - Output should be concise and free of repetition.

    //             Current Date and Time: ${getLocalizedDateTimeString()}

    //             ${userSystemPrompt ? `\nHere is some aditional notes from the user: ${userSystemPrompt}\n` : ""}
    //         `.split("\n").map((value) => value.trim()).join("\n");
    //     }

    //     return `
    //         When processing the user prompt:
    //         * Identify user intent concisely.
    //         * If executable, verify if you have all needed info and context.
    //         * If all info is available, return the required JSON as specified.
    //         - Only ask the user if essential; use existing info if possible.
    //         - Keep thoughts brief and avoid duplicate information.
    //         - Output should be concise and free of repetition.

    //         Current Date and Time: ${getLocalizedDateTimeString()}

    //         ${userSystemPrompt ? `\nHere is some aditional notes from the user: ${userSystemPrompt}\n` : ""}
    //     `.split("\n").map((value) => value.trim()).join("\n");
    // }

    private static generateSystemPrompt({
        tools,
        userSystemPrompt,
        toolsFormat = "snippet"
    }: {
        tools?: Tools;
        userSystemPrompt?: LanguageModelMessageContent[] | string;
        toolsFormat?: ToolFormat
    }): string {
        const toolDefinitions = tools ? formatTools(tools, toolsFormat) : "No tools available.";

        // --- NEW, IMPROVED PROMPT STRUCTURE ---
        return `
# CORE MISSION
Your primary goal is to provide a direct, complete, and accurate answer to the user's request. You must use the available tools to gather information and then synthesize that information into a final, helpful response. Do not simply confirm that information exists or point the user to a link; extract and present the information yourself.

# AVAILABLE TOOLS
You have access to the following tools to help you achieve your mission:
${toolDefinitions}

# THINKING PROCESS
You must follow these steps in a loop until you can provide a final answer:
1.  **Analyze:** Examine the user's prompt and all previous tool results. Understand the user's ultimate goal.
2.  **Plan:** Formulate a step-by-step plan. If you have the answer, your plan should be to formulate the final response. If you need more information, your plan should involve calling a tool.
3.  **Execute:** If your plan requires a tool, define the \`tool_calls\`. If not, set \`tool_calls\` to an empty array \`[]\`.
4.  **Synthesize & Respond:**
    *   If you are calling tools, the \`message\` field should inform the user what you are doing (e.g., "Checking the website for today's missions...").
    *   **CRUCIAL:** If you are NOT calling any more tools (\`tool_calls\` is empty), it means you have all the information needed. The \`message\` field MUST contain the complete, final answer to the user's original question, synthesized from the information you've gathered.

# GENERAL RULES
- Your response must ALWAYS be a valid JSON object matching the required schema.
- Be concise. Do not repeat information.
- Current Date and Time: ${getLocalizedDateTimeString()}
${userSystemPrompt ? `\n# ADDITIONAL USER NOTES\n${userSystemPrompt}\n` : ""}
    `.trim().replace(/^\s+/gm, ''); // Cleans up indentation
    }

    public static async create(options: AgentCreateOptions = {}): Promise<Agent> {
        let initialPrompts = options?.initialPrompts;

        if (initialPrompts) {
            if (initialPrompts?.[0]?.role == "system") {
                // Skip the first system prompt since we're replacing it with our enhanced version
                initialPrompts = [{
                    role: "system", content: Agent.generateSystemPrompt({
                        tools: options.tools,
                        userSystemPrompt: initialPrompts?.[0]?.content,
                        toolsFormat: options.toolsFormat
                    })
                }, ...initialPrompts.slice(1) as LanguageModelMessage[]];
            } else {
                initialPrompts = [{
                    role: "system", content: Agent.generateSystemPrompt({
                        tools: options.tools,
                        toolsFormat: options.toolsFormat
                    })
                }, ...initialPrompts as LanguageModelMessage[]];
            }
        } else {
            initialPrompts = [
                {
                    role: "system",
                    content: Agent.generateSystemPrompt({
                        tools: options.tools,
                        toolsFormat: options.toolsFormat
                    })
                }
            ];
        }

        const defaultModeParams = await LanguageModel.params();

        const nativeModel = await LanguageModelEx.create({
            initialPrompts,
            tools: undefined,
            contextHandler: options?.contextHandler ?? "summarize",
            historyHandler: options?.historyHandler ?? "clear",
            maxQuotaUsage: options?.maxQuotaUsage ?? 0.70,
            expectedInputs: options?.expectedInputs ?? [
                {
                    type: "text",
                    languages: ["en"]
                },
                {
                    type: "image"
                },
                {
                    type: "audio"
                }
            ],
            expectedOutputs: options?.expectedOutputs ?? [{
                type: "text",
                languages: ["en"]
            }],
            temperature: options?.temperature ?? (defaultModeParams.defaultTemperature),
            topK: options?.topK ?? Math.floor(defaultModeParams.maxTopK / 4),
            monitor: options?.monitor,
            signal: options?.signal
        });

        console.log("Creating Agent:", {
            initialPrompts,
            tools: undefined,
            contextHandler: options?.contextHandler ?? "summarize",
            historyHandler: options?.historyHandler ?? "clear",
            maxQuotaUsage: options?.maxQuotaUsage ?? 0.70,
            expectedInputs: options?.expectedInputs ?? [
                {
                    type: "text",
                    languages: ["en"]
                },
                {
                    type: "image"
                },
                {
                    type: "audio"
                }
            ],
            expectedOutputs: options?.expectedOutputs ?? [{
                type: "text",
                languages: ["en"]
            }],
            temperature: options?.temperature ?? (defaultModeParams.defaultTemperature),
            topK: options?.topK ?? Math.floor(defaultModeParams.maxTopK / 4),
            monitor: options?.monitor,
            signal: options?.signal
        });

        return new Agent(nativeModel, options);
    }

    public get inputQuota(): number { return this.internalModel.inputQuota; }
    public get inputUsage(): number { return this.internalModel.inputUsage; }
    public get topK(): number { return this.internalModel.topK; }
    public get temperature(): number { return this.internalModel.temperature; }

    public destroy() { return this.internalModel.destroy(); }

    public measureInputUsage(input: LanguageModelPrompt, options?: LanguageModelPromptOptions): Promise<number> {
        return this.internalModel.measureInputUsage(input, options);
    }

    public async prompt(input: LanguageModelPrompt, options?: LanguageModelPromptOptions): Promise<string> {
        return this.internalModel.prompt(input, options);
    }

    public promptStreaming(input: LanguageModelPrompt, options?: LanguageModelPromptOptions): ReadableStream<string> {
        return this.internalModel.promptStreaming(input, options);
    }


    /**
     * Executes a multi-step, interactive run with an agent that can use tools.
     * 
     * This method returns an `AgentRun` object immediately, which provides
     * observable properties for tracking the agent's progress in real-time.
     * You can subscribe to changes in the current iteration, view a history
     * of completed steps, and `await` the entire run for its final completion.
     *
     * @param userInput The initial prompt from the user, which can be a string or structured prompt.
     * @param maxIterations The maximum number of loops before stopping.
     * @param options An abort signal for cancellation.
     * @returns An `AgentRun` object to observe and await.
     */
    public run(
        userInput: LanguageModelPrompt,
        maxIterations = 5,
        options?: { signal?: AbortSignal }
    ): AgentRun {

        const status = new StreamingProperty<AgentStatus>("thinking");
        const history = new StreamingProperty<readonly IterationLogEntry[]>([]);
        const currentIteration = new StreamingProperty<IterationLogEntry | null>(null);

        const donePromise = new Promise<void>((resolve, reject) => {
            const processLoop = async () => {
                let messages: LanguageModelPrompt = userInput;
                const completedIterations: IterationLogEntry[] = [];

                try {
                    for (let i = 1; i <= maxIterations; i++) {
                        if (options?.signal?.aborted) throw new Error("Agent run aborted by signal.");

                        status._update("thinking");

                        // --- LLM Streaming and Initial Parsing ---
                        const stream = this.internalModel.promptStreaming(messages, {
                            signal: options?.signal,
                            responseConstraint: z.toJSONSchema(responseConstraint),
                        });
                        const reader = stream.getReader();
                        let responseText = "";
                        let iterationData: IterationLogEntry | null = null;

                        while (true) {
                            const { done, value } = await reader.read();
                            if (done) break;
                            responseText += value;
                            try {
                                const parsed = JSON.parse(jsonrepair(responseText));
                                if (parsed.thoughts && parsed.plan && parsed.tool_calls && parsed.message) {
                                    iterationData = {
                                        iteration: i,
                                        thoughts: parsed.thoughts,
                                        plan: parsed.plan,
                                        message: parsed.message,
                                        tool_calls: parsed.tool_calls.map((tc: any) => ({
                                            tool: tc.tool,
                                            args: tc.args,
                                            status: "pending" as ToolCallStatus,
                                        })),
                                    };
                                    currentIteration._update(iterationData);
                                }
                            } catch (e) { /* Ignore intermediate parsing errors */ }
                        }

                        if (!iterationData) throw new Error("Failed to parse a valid JSON response from the model.");

                        // --- Decision Step ---
                        if (iterationData.tool_calls.length === 0) {
                            completedIterations.push(iterationData);
                            history._update(completedIterations);
                            currentIteration._update(null);
                            status._update("done");
                            resolve();
                            return;
                        }

                        // --- Tool Execution Step ---
                        status._update("calling_tools");
                        let toolResultsMessages: LanguageModelMessage[] = [];
                        let updatedToolCalls = [...iterationData.tool_calls];

                        for (let toolIndex = 0; toolIndex < updatedToolCalls.length; toolIndex++) {
                            const call = updatedToolCalls[toolIndex];

                            updatedToolCalls[toolIndex] = { ...call, status: "running" };
                            iterationData = { ...iterationData, tool_calls: updatedToolCalls };
                            currentIteration._update(iterationData);

                            const toolDef = this.tools[call.tool];
                            let finalToolState: ToolCallLog;
                            let toolResultMessage: LanguageModelMessage;

                            if (!toolDef) {
                                finalToolState = { ...call, status: "error", error: new Error("Tool not found") };
                                toolResultMessage = { role: 'user', content: `TOOL_RESULT for ${call.tool}: TOOL_NOT_FOUND` };
                            } else {
                                try {
                                    const result = await toolDef.execute(call.args ?? {});
                                    finalToolState = { ...call, status: "success", result };

                                    // --- NEW MULTIMODAL RESULT HANDLING ---
                                    if (typeof result === 'string') {
                                        toolResultMessage = { role: 'user', content: `TOOL_RESULT for ${call.tool}: ${result}` };
                                    } else {
                                        let contentType: 'image' | 'audio' | null = null;

                                        // Use type guards to determine the content type
                                        if ((typeof ImageBitmap !== 'undefined' && result instanceof ImageBitmap) ||
                                            (typeof HTMLCanvasElement !== 'undefined' && result instanceof HTMLCanvasElement) ||
                                            (typeof Blob !== 'undefined' && result instanceof Blob && result.type.startsWith('image/'))) {
                                            contentType = 'image';
                                        } else if ((typeof AudioBuffer !== 'undefined' && result instanceof AudioBuffer) ||
                                            (typeof Blob !== 'undefined' && result instanceof Blob && result.type.startsWith('audio/'))) {
                                            contentType = 'audio';
                                        }

                                        if (contentType) {
                                            // Create a structured message with text context and the media
                                            toolResultMessage = {
                                                role: 'user',
                                                content: [
                                                    { type: 'text', value: `TOOL_RESULT for ${call.tool}: [Attachment of type ${contentType}]` },
                                                    { type: contentType, value: result as LanguageModelMessageValue }
                                                ]
                                            };
                                        } else {
                                            // Fallback for unknown binary data
                                            toolResultMessage = { role: 'user', content: `TOOL_RESULT for ${call.tool}: [Received unidentifiable binary data]` };
                                        }
                                    }
                                } catch (err: any) {
                                    finalToolState = { ...call, status: "error", error: err instanceof Error ? err : new Error(String(err)) };
                                    toolResultMessage = { role: 'user', content: `TOOL_RESULT for ${call.tool}: ERROR - ${String(err)}` };
                                }
                            }

                            toolResultsMessages.push(toolResultMessage);
                            updatedToolCalls = [...updatedToolCalls]; // Ensure new array reference
                            updatedToolCalls[toolIndex] = finalToolState;
                            iterationData = { ...iterationData, tool_calls: updatedToolCalls };
                            currentIteration._update(iterationData);
                        }

                        // --- End of Iteration ---
                        completedIterations.push(iterationData);
                        history._update(completedIterations);

                        if (typeof messages === 'string') messages = [{ role: 'user', content: messages }];
                        else if (!Array.isArray(messages)) messages = [messages];

                        messages.push({ role: 'assistant', content: responseText });
                        messages.push(...toolResultsMessages);
                    }

                    throw new Error("Max iterations reached");

                } catch (error) {
                    status._update("error");
                    reject(error);
                } finally {
                    status._finalize();
                    history._finalize();
                    currentIteration._finalize();
                }
            };

            processLoop();
        });

        return {
            status,
            history,
            currentIteration,
            then: (onfulfilled, onrejected) => donePromise.then(onfulfilled, onrejected),
        };
    }

}
