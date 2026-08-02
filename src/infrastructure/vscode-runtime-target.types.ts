import type {
  CPU_ARCHITECTURES,
  EXECUTION_HOST_KINDS,
  OS_FAMILIES,
} from '../core/runtime/runtime-protocol.constants';

export type RuntimeUiKind = 'desktop' | 'web';
export type RuntimeExtensionKind = 'ui' | 'workspace' | 'unknown';
export type RuntimeHostKind = (typeof EXECUTION_HOST_KINDS)[number];
export type RuntimeOsFamily = (typeof OS_FAMILIES)[number];
export type RuntimeArchitecture = (typeof CPU_ARCHITECTURES)[number];

export interface RuntimeWorkspaceFolderProbe {
  readonly name: string;
  readonly scheme: string;
  readonly uri: string;
}

export interface RuntimeHostProbe {
  readonly architecture: string;
  readonly extensionKind: RuntimeExtensionKind;
  readonly extensionVersion: string;
  readonly platform: string;
  readonly remoteName: string | undefined;
  readonly shell: string | undefined;
  readonly uiKind: RuntimeUiKind;
  readonly vscodeVersion: string;
  readonly workspaceFolders: readonly RuntimeWorkspaceFolderProbe[];
  readonly workspaceTrusted: boolean;
}

export interface ExtensionHostDescriptor {
  readonly architecture: RuntimeArchitecture;
  readonly extensionKind: RuntimeExtensionKind;
  readonly hostKind: RuntimeHostKind;
  readonly osFamily: RuntimeOsFamily;
  readonly remoteName: string | undefined;
  readonly uiKind: RuntimeUiKind;
}

export interface RuntimeManifestIdentity {
  readonly generatedAt: string;
  readonly manifestId: string;
}
