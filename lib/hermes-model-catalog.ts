import type { HermesProvider } from "../components/HermesProviderPicker";

export type HermesModelEndpoint = { id: string; name: string; base_url: string; model: string; models?: string[]; api_mode?: string; context_length?: number | null; discover_models?: boolean; is_current?: boolean; has_api_key?: boolean; model_details?: { id: string; canonical_model?: string; reasoning_effort?: string }[] };
export type HermesCatalogProvider = HermesProvider & { api_url?: string; is_current?: boolean };
export type HermesModelOptions = { providers: HermesCatalogProvider[]; model?: string; provider?: string };
export const hermesModelOptionsPath = (refresh = false) => `/api/model/options?explicit_only=1${refresh ? "&refresh=1" : ""}`;
export const sameHermesProvider = (left: string, right: string) => left.replace(/^custom:/, "").toLowerCase() === right.replace(/^custom:/, "").toLowerCase();

export function hermesEndpointModels(endpoint: HermesModelEndpoint, providers: HermesCatalogProvider[]): string[] {
  const live = providers.find(provider => sameHermesProvider(provider.slug, endpoint.id));
  return [...new Set([endpoint.model, ...(endpoint.models ?? []), ...(live?.models ?? [])].filter(Boolean))];
}
