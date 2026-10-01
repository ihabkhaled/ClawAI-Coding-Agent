export interface CompareLaneState {
  content: string;
  errorMessage: string | null;
  inputTokens: number | null;
  model: string;
  outputTokens: number | null;
  provider: string;
  status: 'completed' | 'failed';
}
