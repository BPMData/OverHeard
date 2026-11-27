/** HTTP contract shared by the translation server and browser clients. */
export type ServerMtProvider = 'google-cloud' | 'gtx';

export interface ServerConfigResponse {
  mtProvider: ServerMtProvider;
  providers: ServerMtProvider[];
  shortLinkBase: string | null;
}

export interface MtRequestBody {
  text: string;
  lang: string;
  source?: string;
  provider?: ServerMtProvider;
  freeOnly?: boolean;
}

export interface MtSuccessResponse {
  translation: string;
  provider: ServerMtProvider | 'cache';
  ms: number;
}

export interface MtErrorResponse {
  error: string;
  details?: string;
}
