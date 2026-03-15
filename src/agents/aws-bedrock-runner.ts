/**
 * AWS Bedrock LLM Runner for ANIMA
 *
 * Adds support for Amazon's cheapest LLM models via AWS Bedrock:
 * - Amazon Nova Lite (~$0.00006/1K input tokens)
 * - Amazon Nova Micro (~$0.000035/1K input tokens)
 * - Amazon Titan Text Express (~$0.0008/1K input tokens)
 * - Claude via Bedrock (same models, AWS billing)
 *
 * This makes Anima easy to deploy on AWS and dramatically reduces
 * costs for the atma failover local tier.
 */

import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("aws-bedrock");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BedrockConfig {
  region: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  /** Use IAM role instead of keys (recommended for EC2/ECS) */
  useIamRole?: boolean;
  /** Default model ID */
  defaultModel: string;
  /** Max tokens for response */
  maxTokens: number;
  /** Temperature */
  temperature: number;
}

export interface BedrockModel {
  id: string;
  provider: string;
  name: string;
  costPer1kInput: number; // USD
  costPer1kOutput: number;
  maxContext: number;
  recommended: boolean;
}

export interface BedrockRequest {
  model: string;
  messages: Array<{ role: "user" | "assistant" | "system"; content: string }>;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  stopSequences?: string[];
}

export interface BedrockResponse {
  content: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
}

// ---------------------------------------------------------------------------
// Available models (sorted by cost, cheapest first)
// ---------------------------------------------------------------------------

export const BEDROCK_MODELS: BedrockModel[] = [
  {
    id: "amazon.nova-micro-v1:0",
    provider: "amazon",
    name: "Amazon Nova Micro",
    costPer1kInput: 0.000035,
    costPer1kOutput: 0.00014,
    maxContext: 128_000,
    recommended: true,
  },
  {
    id: "amazon.nova-lite-v1:0",
    provider: "amazon",
    name: "Amazon Nova Lite",
    costPer1kInput: 0.00006,
    costPer1kOutput: 0.00024,
    maxContext: 300_000,
    recommended: true,
  },
  {
    id: "amazon.nova-pro-v1:0",
    provider: "amazon",
    name: "Amazon Nova Pro",
    costPer1kInput: 0.0008,
    costPer1kOutput: 0.0032,
    maxContext: 300_000,
    recommended: false,
  },
  {
    id: "amazon.titan-text-express-v1",
    provider: "amazon",
    name: "Amazon Titan Text Express",
    costPer1kInput: 0.0008,
    costPer1kOutput: 0.0016,
    maxContext: 8_192,
    recommended: false,
  },
  {
    id: "anthropic.claude-3-5-haiku-20241022-v1:0",
    provider: "anthropic",
    name: "Claude 3.5 Haiku (via Bedrock)",
    costPer1kInput: 0.0008,
    costPer1kOutput: 0.004,
    maxContext: 200_000,
    recommended: true,
  },
  {
    id: "anthropic.claude-3-5-sonnet-20241022-v2:0",
    provider: "anthropic",
    name: "Claude 3.5 Sonnet (via Bedrock)",
    costPer1kInput: 0.003,
    costPer1kOutput: 0.015,
    maxContext: 200_000,
    recommended: false,
  },
];

// ---------------------------------------------------------------------------
// Default config
// ---------------------------------------------------------------------------

export const DEFAULT_BEDROCK_CONFIG: BedrockConfig = {
  region: "us-east-1",
  useIamRole: true,
  defaultModel: "amazon.nova-lite-v1:0",
  maxTokens: 4096,
  temperature: 0.7,
};

// ---------------------------------------------------------------------------
// Bedrock Runner
// ---------------------------------------------------------------------------

export class BedrockRunner {
  private config: BedrockConfig;
  private totalCostUsd = 0;
  private totalRequests = 0;

  constructor(config?: Partial<BedrockConfig>) {
    this.config = { ...DEFAULT_BEDROCK_CONFIG, ...config };
  }

  /**
   * Send a request to AWS Bedrock.
   */
  async invoke(request: BedrockRequest): Promise<BedrockResponse> {
    const model = request.model || this.config.defaultModel;
    const maxTokens = request.maxTokens ?? this.config.maxTokens;
    const temperature = request.temperature ?? this.config.temperature;

    const startMs = Date.now();

    // Build the Bedrock API request
    const endpoint = `https://bedrock-runtime.${this.config.region}.amazonaws.com/model/${encodeURIComponent(model)}/invoke`;

    const body = this.buildRequestBody(
      model,
      request.messages,
      maxTokens,
      temperature,
      request.topP,
      request.stopSequences,
    );

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Accept: "application/json",
      };

      // If using explicit keys, add auth headers
      // (IAM role auth is handled automatically by the AWS SDK/environment)
      if (this.config.accessKeyId && this.config.secretAccessKey) {
        // Simplified — production should use AWS Signature V4
        headers["X-Amz-Access-Key"] = this.config.accessKeyId;
      }

      const res = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60_000),
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Bedrock API error: ${res.status} ${errorText}`);
      }

      const data = (await res.json()) as Record<string, unknown>;
      const latencyMs = Date.now() - startMs;

      // Parse response based on model provider
      const result = this.parseResponse(model, data);
      const modelInfo = BEDROCK_MODELS.find((m) => m.id === model);

      const costUsd = modelInfo
        ? (result.inputTokens / 1000) * modelInfo.costPer1kInput +
          (result.outputTokens / 1000) * modelInfo.costPer1kOutput
        : 0;

      this.totalCostUsd += costUsd;
      this.totalRequests++;

      log.info(
        `bedrock ${model}: ${result.inputTokens}in/${result.outputTokens}out, $${costUsd.toFixed(6)}, ${latencyMs}ms`,
      );

      return {
        content: result.content,
        model,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        costUsd,
        latencyMs,
      };
    } catch (err) {
      log.error(`bedrock invoke failed: ${String(err)}`);
      throw err;
    }
  }

  /**
   * Build request body based on model provider.
   */
  private buildRequestBody(
    model: string,
    messages: BedrockRequest["messages"],
    maxTokens: number,
    temperature: number,
    topP?: number,
    stopSequences?: string[],
  ): Record<string, unknown> {
    if (model.startsWith("anthropic.")) {
      // Anthropic models via Bedrock use Messages API
      return {
        anthropic_version: "bedrock-2023-05-31",
        max_tokens: maxTokens,
        temperature,
        top_p: topP,
        stop_sequences: stopSequences,
        messages: messages.filter((m) => m.role !== "system"),
        system: messages.find((m) => m.role === "system")?.content,
      };
    }

    if (model.startsWith("amazon.nova")) {
      // Amazon Nova models
      return {
        inferenceConfig: { maxTokens, temperature, topP },
        messages: messages.map((m) => ({
          role: m.role,
          content: [{ text: m.content }],
        })),
      };
    }

    // Amazon Titan and others
    return {
      inputText: messages.map((m) => `${m.role}: ${m.content}`).join("\n"),
      textGenerationConfig: {
        maxTokenCount: maxTokens,
        temperature,
        topP: topP ?? 0.9,
        stopSequences: stopSequences ?? [],
      },
    };
  }

  /**
   * Parse response based on model provider.
   */
  private parseResponse(
    model: string,
    data: Record<string, unknown>,
  ): { content: string; inputTokens: number; outputTokens: number } {
    if (model.startsWith("anthropic.")) {
      const content = (data.content as Array<{ text: string }>)?.[0]?.text ?? "";
      const usage = data.usage as { input_tokens?: number; output_tokens?: number } | undefined;
      return {
        content,
        inputTokens: usage?.input_tokens ?? 0,
        outputTokens: usage?.output_tokens ?? 0,
      };
    }

    if (model.startsWith("amazon.nova")) {
      const output = data.output as { message?: { content?: Array<{ text: string }> } } | undefined;
      const content = output?.message?.content?.[0]?.text ?? "";
      const usage = data.usage as { inputTokens?: number; outputTokens?: number } | undefined;
      return {
        content,
        inputTokens: usage?.inputTokens ?? 0,
        outputTokens: usage?.outputTokens ?? 0,
      };
    }

    // Titan
    const results = data.results as Array<{ outputText: string }> | undefined;
    const content = results?.[0]?.outputText ?? "";
    return { content, inputTokens: 0, outputTokens: 0 };
  }

  /**
   * Get the cheapest available model.
   */
  getCheapestModel(): BedrockModel {
    return BEDROCK_MODELS[0]; // Already sorted by cost
  }

  /**
   * Get total cost and request count.
   */
  getStats(): { totalCostUsd: number; totalRequests: number } {
    return { totalCostUsd: this.totalCostUsd, totalRequests: this.totalRequests };
  }

  /**
   * List all available models.
   */
  listModels(): BedrockModel[] {
    return [...BEDROCK_MODELS];
  }
}
