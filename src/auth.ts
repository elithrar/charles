import { betterAuth } from 'better-auth';
import { APIError } from 'better-auth/api';
import { magicLink } from 'better-auth/plugins';
import { isAllowlistedEmail } from './config.ts';
import { charlesAuthAdapter } from './auth-adapter.ts';
import { sendCharlesEmail } from './email.ts';
import type { CharlesEnv } from './types.ts';

function authOrigin(env: CharlesEnv, requestUrl: string): string {
  return env.BETTER_AUTH_URL || env.PUBLIC_ORIGIN || new URL(requestUrl).origin;
}

function requireAuthSecret(env: CharlesEnv): string {
  if (!env.BETTER_AUTH_SECRET) {
    throw new Error('BETTER_AUTH_SECRET is required');
  }

  return env.BETTER_AUTH_SECRET;
}

function emailFromVerificationIdentifier(identifier: unknown): string | null {
  if (typeof identifier !== 'string') {
    return null;
  }

  return identifier.match(/[^\s:<>]+@[^\s:<>]+\.[^\s:<>]+/)?.[0] ?? null;
}

export function createCharlesAuth(env: CharlesEnv, requestUrl: string) {
  const baseURL = authOrigin(env, requestUrl);
  const authStore = env.AUTH_STORE.getByName('default');

  return betterAuth({
    baseURL,
    secret: requireAuthSecret(env),
    database: charlesAuthAdapter({ store: authStore }),
    trustedOrigins: [baseURL],
    hooks: {
      before: async (ctx) => {
        const request = ctx as { path?: string; body?: { email?: unknown } };
        if (request.path !== '/sign-in/magic-link') {
          return;
        }

        const email = request.body?.email;
        if (typeof email === 'string' && !isAllowlistedEmail(email)) {
          throw new APIError('FORBIDDEN', { message: 'Email is not allowlisted' });
        }
      },
    },
    user: {
      deleteUser: {
        enabled: false,
      },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            if (!isAllowlistedEmail(user.email)) {
              throw new APIError('FORBIDDEN', { message: 'Email is not allowlisted' });
            }

            return {
              data: {
                ...user,
                name: user.name || user.email,
                email: user.email.toLowerCase(),
                emailVerified: true,
              },
            };
          },
        },
      },
      verification: {
        create: {
          before: async (verification) => {
            const email = emailFromVerificationIdentifier(verification.identifier);
            if (email && !isAllowlistedEmail(email)) {
              throw new APIError('FORBIDDEN', { message: 'Email is not allowlisted' });
            }
          },
        },
      },
    },
    plugins: [
      magicLink({
        disableSignUp: false,
        expiresIn: 15 * 60,
        sendMagicLink: async ({ email, url }) => {
          if (!isAllowlistedEmail(email)) {
            throw new APIError('FORBIDDEN', { message: 'Email is not allowlisted' });
          }

          await sendCharlesEmail(env, {
            to: email.toLowerCase(),
            subject: 'Sign in to Charles',
            text: `Open this link to sign in to Charles.\n\n[Sign in to Charles](${url})`,
          });
        },
      }),
    ],
  });
}
