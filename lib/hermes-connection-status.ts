export type HermesCapabilityStatus = {
  connected: boolean;
  code?: string;
  error?: string;
};

export type HermesConnectionStatus = HermesCapabilityStatus & {
  automatic?: boolean;
  local?: boolean;
  dashboard?: HermesCapabilityStatus;
  api?: HermesCapabilityStatus;
  project?: HermesCapabilityStatus;
};
