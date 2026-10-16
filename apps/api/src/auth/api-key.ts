import type { FastifyRequest } from 'fastify';
import { UnauthorizedError } from '@relayforge/core';

export function requireApiKey(expectedToken: string) {
  return async function apiKeyGuard(request: FastifyRequest): Promise<void> {
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith('Bearer ')) throw new UnauthorizedError();
    const token = authorization.slice('Bearer '.length);
    if (token.length !== expectedToken.length) throw new UnauthorizedError();
    let mismatch = 0;
    for (let index = 0; index < token.length; index += 1) {
      mismatch |= token.charCodeAt(index) ^ expectedToken.charCodeAt(index);
    }
    if (mismatch !== 0) throw new UnauthorizedError();
  };
}
