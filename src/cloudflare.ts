import { EmailMessage } from 'cloudflare:email';
import { createMimeMessage } from 'mimetext';
import PostalMime from 'postal-mime';
import app from './app.ts';
import { CharlesAuthStore } from './auth-store.ts';
import { CharlesWorkflowStore } from './workflow-store.ts';
import {
  buildReplySubject,
  defaultFromAddress,
  defaultFromIdentity,
  classifyEmailIntent,
  emailThreadKey,
  emailErrorMessage,
  formatEmailAddress,
  requireAllowlistedSender,
  sendCharlesEmail,
  type InboundEmailPayload,
} from './email.ts';
import { logEvent } from './logging.ts';
import {
  recordWorkflowHistory,
  summarizeWorkflowResult,
  type InternalWorkflowResult,
} from './services/workflows.ts';

export { CharlesAuthStore, CharlesWorkflowStore };

const EMAIL_WORKFLOW_FAILURE_REPLY =
  'Charles received your message, but something went wrong while processing it.';

async function parseInboundEmail(message: ForwardableEmailMessage): Promise<InboundEmailPayload> {
  const parsed = await new PostalMime().parse(await new Response(message.raw).arrayBuffer());
  const headers = new Map(
    (parsed.headers ?? []).map((header) => [header.key.toLowerCase(), header.value]),
  );

  return {
    from: parsed.from?.address || message.from,
    to: message.to,
    subject: parsed.subject || '(no subject)',
    text: parsed.text || parsed.html || '',
    html: parsed.html,
    messageId: headers.get('message-id'),
    inReplyTo: headers.get('in-reply-to'),
    references: headers.get('references'),
    receivedAt: new Date().toISOString(),
  };
}

async function replyToEmail(
  message: ForwardableEmailMessage,
  env: Env,
  payload: InboundEmailPayload,
  text: string,
): Promise<'reply' | 'send'> {
  const from = defaultFromAddress(env);
  const fromIdentity = defaultFromIdentity(env);
  const formattedFrom = formatEmailAddress(fromIdentity);
  const subject = buildReplySubject(payload.subject);
  const mime = createMimeMessage();
  mime.setSender(formattedFrom);
  mime.setRecipient(payload.from);
  mime.setSubject(subject);

  if (payload.messageId) {
    mime.setHeader('in-reply-to', payload.messageId);
  }

  if (payload.references) {
    mime.setHeader('references', payload.references);
  }

  mime.addMessage({ contentType: 'text/plain', data: text });

  try {
    await message.reply(new EmailMessage(from, payload.from, mime.asRaw()));
    return 'reply';
  } catch (error) {
    logEvent('warn', 'email.reply_failed_fallback_send', { error: String(error) });
  }

  await sendCharlesEmail(env, {
    to: payload.from,
    subject,
    text,
    headers: {
      ...(payload.messageId ? { 'In-Reply-To': payload.messageId } : {}),
      ...(payload.references ? { References: payload.references } : {}),
    },
  });
  return 'send';
}

async function recordEmailThread(env: Env, payload: InboundEmailPayload, replyText: string) {
  const store = env.AUTH_STORE.getByName('default');
  const sender = requireAllowlistedSender(payload.from);
  const normalizedSender = 'value' in sender ? sender.value : payload.from;
  await store.recordEmailThread({
    threadKey: emailThreadKey(payload.subject, normalizedSender),
    sender: normalizedSender,
    subject: payload.subject,
    intent: classifyEmailIntent(payload.subject, payload.text),
    receivedAt: payload.receivedAt,
    inboundText: payload.text,
    replyText,
  });
}

async function buildWorkflowReply(
  env: Env,
  ctx: ExecutionContext,
  sender: string,
  payload: InboundEmailPayload,
) {
  const request = new Request('https://charles.internal/workflows/email-prompt?wait=result', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-charles-internal-auth': env.INTERNAL_AUTH_SECRET ?? '',
      'x-charles-user': sender,
    },
    body: JSON.stringify(payload),
  });

  try {
    const response = await app.fetch(request, env, ctx);
    if (!response.ok) {
      const bodyPreview = await response
        .clone()
        .text()
        .then((text) => text.slice(0, 500))
        .catch(() => '');
      logEvent('error', 'email.workflow_admission_failed', {
        status: response.status,
        bodyPreview,
      });
      return { replyText: EMAIL_WORKFLOW_FAILURE_REPLY };
    }

    const result = (await response.json()) as {
      result?: { replyText?: string; childWorkflow?: InternalWorkflowResult };
      replyText?: string;
      childWorkflow?: InternalWorkflowResult;
    };
    return {
      replyText:
        result.result?.replyText ||
        result.replyText ||
        'Charles received your message, but did not produce a reply.',
      childWorkflow: result.result?.childWorkflow || result.childWorkflow,
    };
  } catch (error) {
    logEvent('error', 'email.workflow_execution_failed', { error: String(error) });
    return { replyText: EMAIL_WORKFLOW_FAILURE_REPLY };
  }
}

async function deliverWorkflowReply(
  message: ForwardableEmailMessage,
  env: Env,
  payload: InboundEmailPayload,
  replyText: string,
) {
  try {
    const deliveryMethod = await replyToEmail(message, env, payload, replyText);
    logEvent('info', 'email.reply_sent', {
      from: payload.from,
      subject: payload.subject,
      deliveryMethod,
    });
    return true;
  } catch (error) {
    logEvent('error', 'email.reply_delivery_failed', {
      from: payload.from,
      subject: payload.subject,
      error: String(error),
    });
    return false;
  }
}

async function recordDeliveredArtifacts(
  env: Env,
  payload: InboundEmailPayload,
  replyText: string,
  requestedBy: string,
  childWorkflow?: InternalWorkflowResult,
) {
  const tasks: Promise<unknown>[] = [
    recordEmailThread(env, payload, replyText).catch((error) =>
      logEvent('error', 'email.thread_record_failed', {
        from: payload.from,
        subject: payload.subject,
        error: String(error),
      }),
    ),
  ];

  if (childWorkflow) {
    const summary = summarizeWorkflowResult(childWorkflow);
    tasks.push(
      recordWorkflowHistory(env, {
        workflow: childWorkflow.workflow,
        status: childWorkflow.ok ? 'ok' : 'error',
        subject: payload.subject,
        requestedBy,
        summary,
        createdAt: new Date().toISOString(),
      }).catch((error) =>
        logEvent('error', 'email.workflow_history_record_failed', {
          requestedBy,
          subject: payload.subject,
          workflow: childWorkflow.workflow,
          error: String(error),
        }),
      ),
    );
  }

  await Promise.all(tasks);
}

export default {
  async email(message, env, ctx) {
    let payload: InboundEmailPayload;
    try {
      payload = await parseInboundEmail(message);
    } catch (error) {
      logEvent('error', 'email.parse_failed', { error: String(error) });
      message.setReject('Charles could not parse that email safely.');
      return;
    }

    const sender = requireAllowlistedSender(payload.from);
    logEvent('info', 'email.received', { from: payload.from, subject: payload.subject });

    if ('error' in sender) {
      logEvent('warn', 'email.sender_rejected', { from: payload.from });
      message.setReject(emailErrorMessage(sender.error));
      return;
    }

    if (!env.INTERNAL_AUTH_SECRET) {
      logEvent('error', 'email.missing_internal_auth_secret');
      const delivered = await deliverWorkflowReply(
        message,
        env,
        payload,
        'Charles is missing internal workflow authentication configuration.',
      );
      if (delivered) {
        ctx.waitUntil(
          recordDeliveredArtifacts(
            env,
            payload,
            'Charles is missing internal workflow authentication configuration.',
            sender.value,
          ),
        );
      }
      return;
    }

    const workflowReply = await buildWorkflowReply(env, ctx, sender.value, payload);
    logEvent('info', 'email.reply_ready', { from: sender.value, subject: payload.subject });

    const delivered = await deliverWorkflowReply(message, env, payload, workflowReply.replyText);
    if (delivered) {
      ctx.waitUntil(
        recordDeliveredArtifacts(
          env,
          payload,
          workflowReply.replyText,
          sender.value,
          workflowReply.childWorkflow,
        ),
      );
    }
  },
} satisfies ExportedHandler<Env>;
