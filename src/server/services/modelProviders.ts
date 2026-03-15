import { GoogleGenAI } from '@google/genai';
import type {
  AiModelOption,
  AiModelProviderCatalogEntry,
  AiModelProviderId,
  AiModelSelection,
} from '../../shared/integrations.js';
import { DEFAULT_MODEL_SELECTION } from '../../shared/integrations.js';

type GenerationRequest = {
  modelId: string;
  prompt: string;
};

type RuntimeModelProvider = {
  catalog: AiModelProviderCatalogEntry;
  generateJson: (request: GenerationRequest) => Promise<string>;
};

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_BASE_URL = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');

const geminiClient = GEMINI_API_KEY ? new GoogleGenAI({ apiKey: GEMINI_API_KEY }) : null;

function humanizeModelId(modelId: string) {
  return String(modelId || '')
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function parseModelList(
  envValue: string | undefined,
  fallback: AiModelOption[],
  descriptions: Record<string, { description: string; latency_tier: AiModelOption['latency_tier'] }> = {},
) {
  const models = String(envValue || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (!models.length) {
    return fallback;
  }

  return models.map((modelId) => ({
    id: modelId,
    label: humanizeModelId(modelId),
    description: descriptions[modelId]?.description || 'Configured from environment for Quizzi generation.',
    latency_tier: descriptions[modelId]?.latency_tier || 'balanced',
  }));
}

const geminiModels = parseModelList(process.env.QUIZZI_GEMINI_MODELS, [
  {
    id: 'gemini-2.5-flash',
    label: 'Gemini 2.5 Flash',
    description: 'Fast generation for lecture prep and iterative drafting.',
    latency_tier: 'fast',
  },
  {
    id: 'gemini-2.5-pro',
    label: 'Gemini 2.5 Pro',
    description: 'Higher-fidelity phrasing for complex academic material.',
    latency_tier: 'quality',
  },
]);

const openAiModels = parseModelList(process.env.QUIZZI_OPENAI_MODELS, [
  {
    id: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
    label: humanizeModelId(process.env.OPENAI_MODEL || 'gpt-4.1-mini'),
    description: 'Balanced OpenAI model for fast question drafting.',
    latency_tier: 'fast',
  },
  {
    id: 'gpt-4.1',
    label: 'Gpt 4.1',
    description: 'Higher-quality OpenAI model for denser university content.',
    latency_tier: 'quality',
  },
]);

const runtimeProviders: Record<AiModelProviderId, RuntimeModelProvider> = {
  gemini: {
    catalog: {
      id: 'gemini',
      label: 'Google Gemini',
      description: 'Native Gemini integration for high-throughput quiz drafting.',
      available: Boolean(GEMINI_API_KEY && geminiModels.length),
      env_key: 'GEMINI_API_KEY',
      default_model_id: geminiModels[0]?.id || DEFAULT_MODEL_SELECTION.model_id,
      models: geminiModels,
    },
    async generateJson({ modelId, prompt }) {
      if (!geminiClient) {
        throw new Error('Gemini is not configured on the server');
      }

      const response = await geminiClient.models.generateContent({
        model: modelId,
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
        },
      });

      return String(response.text || '').trim();
    },
  },
  openai: {
    catalog: {
      id: 'openai',
      label: 'OpenAI',
      description: 'OpenAI chat completions integration for structured question generation.',
      available: Boolean(OPENAI_API_KEY && openAiModels.length),
      env_key: 'OPENAI_API_KEY',
      default_model_id: openAiModels[0]?.id || DEFAULT_MODEL_SELECTION.model_id,
      models: openAiModels,
    },
    async generateJson({ modelId, prompt }) {
      if (!OPENAI_API_KEY) {
        throw new Error('OpenAI is not configured on the server');
      }

      const response = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: modelId,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.2,
          response_format: { type: 'json_object' },
        }),
      });

      if (!response.ok) {
        const errorPayload = await response.json().catch(() => null);
        const errorMessage =
          errorPayload?.error?.message ||
          errorPayload?.message ||
          `${response.status} ${response.statusText}`;
        throw new Error(`OpenAI request failed: ${errorMessage}`);
      }

      const payload = await response.json();
      return String(payload?.choices?.[0]?.message?.content || '').trim();
    },
  },
};

function firstAvailableProvider() {
  return (
    Object.values(runtimeProviders).find((provider) => provider.catalog.available) ||
    runtimeProviders[DEFAULT_MODEL_SELECTION.provider_id]
  );
}

function resolveProvider(providerId?: string | null) {
  const candidate = providerId ? runtimeProviders[providerId as AiModelProviderId] : null;
  if (candidate?.catalog.available) {
    return candidate;
  }

  return firstAvailableProvider();
}

function resolveModelOption(provider: RuntimeModelProvider, modelId?: string | null) {
  const providerModels = provider.catalog.models || [];
  return (
    providerModels.find((model) => model.id === modelId) ||
    providerModels.find((model) => model.id === provider.catalog.default_model_id) ||
    providerModels[0]
  );
}

export function getModelProvidersCatalog() {
  return Object.values(runtimeProviders).map((provider) => ({
    ...provider.catalog,
    models: provider.catalog.models.slice(),
  }));
}

export function getDefaultModelSelection(): AiModelSelection {
  const provider = resolveProvider(process.env.QUIZZI_DEFAULT_MODEL_PROVIDER || DEFAULT_MODEL_SELECTION.provider_id);
  const model = resolveModelOption(provider, process.env.QUIZZI_DEFAULT_MODEL_ID || provider.catalog.default_model_id);
  return {
    provider_id: provider.catalog.id,
    model_id: model?.id || provider.catalog.default_model_id,
  };
}

export function resolveModelSelection(providerId?: string | null, modelId?: string | null) {
  const provider = resolveProvider(providerId);
  if (!provider.catalog.available) {
    throw new Error('No configured AI model providers are available on the server');
  }

  const model = resolveModelOption(provider, modelId);
  if (!model) {
    throw new Error(`No configured model is available for provider ${provider.catalog.label}`);
  }

  return {
    provider,
    model,
  };
}

export async function generateJsonWithModelSelection(selection: {
  providerId?: string | null;
  modelId?: string | null;
  prompt: string;
}) {
  const resolved = resolveModelSelection(selection.providerId, selection.modelId);
  const rawText = await resolved.provider.generateJson({
    modelId: resolved.model.id,
    prompt: selection.prompt,
  });

  return {
    rawText,
    provider: resolved.provider.catalog,
    model: resolved.model,
  };
}
