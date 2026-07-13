export interface AlexusModel {
  id: string;
  name: string;
  contextLength: number;
  pricing: Record<string, string>;
  supportedParameters: string[];
  tools: boolean;
}
