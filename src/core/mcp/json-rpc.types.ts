export type JsonRpcId = number | string;

export interface JsonRpcErrorBody {
  readonly code: number;
  readonly message: string;
}

export type JsonRpcIncoming =
  | {
      readonly kind: 'response';
      readonly id: JsonRpcId;
      readonly result?: unknown;
      readonly error?: JsonRpcErrorBody;
    }
  | { readonly kind: 'request'; readonly id: JsonRpcId; readonly method: string }
  | { readonly kind: 'notification'; readonly method: string }
  | { readonly kind: 'invalid' };
