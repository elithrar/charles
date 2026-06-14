import { betterAuth } from 'better-auth';
import { APIError } from 'better-auth/api';
import { magicLink } from 'better-auth/plugins';
import { isAllowlistedEmail } from './config.ts';
import { charlesAuthAdapter } from './auth-adapter.ts';
import { defaultFromIdentity } from './email.ts';
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

export function createCharlesAuth(env: CharlesEnv, requestUrl: string) {
  const baseURL = authOrigin(env, requestUrl);
  const authStore = env.AUTH_STORE.getByName('default');

  return betterAuth({
    baseURL,
    secret: requireAuthSecret(env),
    database: charlesAuthAdapter({ store: authStore }),
    trustedOrigins: [baseURL],
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
    },
    plugins: [
      magicLink({
        disableSignUp: false,
        expiresIn: 15 * 60,
        sendMagicLink: async ({ email, url }) => {
          if (!isAllowlistedEmail(email)) {
            throw new APIError('FORBIDDEN', { message: 'Email is not allowlisted' });
          }

          await env.EMAIL.send({
            from: defaultFromIdentity(env),
            to: email.toLowerCase(),
            subject: 'Sign in to Charles',
            text: `Open this link to sign in to Charles.\n\n${url}`,
          });
        },
      }),
    ],
  });
}
