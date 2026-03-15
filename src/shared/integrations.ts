export type AiModelProviderId = 'gemini' | 'openai';
export type LmsProviderId = 'generic_csv' | 'canvas' | 'moodle' | 'blackboard';
export type ModelLatencyTier = 'fast' | 'balanced' | 'quality';

export interface AiModelOption {
  id: string;
  label: string;
  description: string;
  latency_tier: ModelLatencyTier;
}

export interface AiModelProviderCatalogEntry {
  id: AiModelProviderId;
  label: string;
  description: string;
  available: boolean;
  env_key: string;
  default_model_id: string;
  models: AiModelOption[];
}

export interface AiModelSelection {
  provider_id: AiModelProviderId;
  model_id: string;
}

export interface LmsProviderCatalogEntry {
  id: LmsProviderId;
  label: string;
  short_label: string;
  description: string;
  file_extension: 'csv';
  requires_roster_mapping: boolean;
  workflow_hint: string;
  recommended_columns: string[];
}

export interface IntegrationsCatalog {
  model_providers: AiModelProviderCatalogEntry[];
  default_model_selection: AiModelSelection;
  lms_providers: LmsProviderCatalogEntry[];
  default_lms_provider: LmsProviderId;
}

export const DEFAULT_MODEL_SELECTION: AiModelSelection = {
  provider_id: 'gemini',
  model_id: 'gemini-2.5-flash',
};

export const DEFAULT_LMS_PROVIDER: LmsProviderId = 'generic_csv';
