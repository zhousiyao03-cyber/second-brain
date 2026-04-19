import type crypto from "node:crypto";

export class OAuthError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "OAuthError";
    this.code = code;
  }
}

export type OAuthAuthorizationCodeRecord = {
  id: string;
  userId: string | null;
  clientId: string;
  redirectUri: string;
  codeHash: string;
  codePreview: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
  scopes: string;
  expiresAt: Date;
  approvedAt: Date | null;
  consumedAt: Date | null;
  createdAt: Date | null;
  updatedAt: Date | null;
};

export type OAuthRefreshTokenRecord = {
  id: string;
  userId: string;
  clientId: string;
  tokenHash: string;
  tokenPreview: string;
  scopes: string;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date | null;
  updatedAt: Date | null;
};

export type OAuthAccessTokenRecord = {
  id: string;
  userId: string;
  clientId: string;
  refreshTokenId: string | null;
  tokenHash: string;
  tokenPreview: string;
  scopes: string;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date | null;
  updatedAt: Date | null;
};

export type OAuthStore = {
  findAuthorizationCodeByHash(hash: string): Promise<OAuthAuthorizationCodeRecord | null>;
  insertAuthorizationCode(record: OAuthAuthorizationCodeRecord): Promise<void>;
  updateAuthorizationCode(
    id: string,
    patch: Partial<Omit<OAuthAuthorizationCodeRecord, "id">>
  ): Promise<void>;
  findRefreshTokenByHash(hash: string): Promise<OAuthRefreshTokenRecord | null>;
  insertRefreshToken(record: OAuthRefreshTokenRecord): Promise<void>;
  updateRefreshToken(
    id: string,
    patch: Partial<Omit<OAuthRefreshTokenRecord, "id">>
  ): Promise<void>;
  findAccessTokenByHash(hash: string): Promise<OAuthAccessTokenRecord | null>;
  insertAccessToken(record: OAuthAccessTokenRecord): Promise<void>;
  updateAccessToken(
    id: string,
    patch: Partial<Omit<OAuthAccessTokenRecord, "id">>
  ): Promise<void>;
  findAccessTokensByRefreshTokenId(refreshTokenId: string): Promise<OAuthAccessTokenRecord[]>;
};

export type OAuthDbRunner = {
  select: (...args: unknown[]) => {
    from: (table: unknown) => {
      where: (clause: unknown) => Promise<Array<Record<string, unknown>>> & {
        limit: (count: number) => Promise<Array<Record<string, unknown>>>;
      };
    };
  };
  insert: (...args: unknown[]) => {
    values: (value: unknown) => Promise<unknown>;
  };
  update: (...args: unknown[]) => {
    set: (patch: unknown) => {
      where: (clause: unknown) => Promise<unknown>;
    };
  };
};

export type OAuthServiceDependencies = {
  now?: () => Date;
  randomBytes?: typeof crypto.randomBytes;
  store?: OAuthStore;
};

export function getDefaultNow() {
  return new Date();
}

export function normalizeExpiresAt(now: Date, ttlSecs: number) {
  return new Date(now.getTime() + ttlSecs * 1000);
}
