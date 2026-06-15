import { Button } from '@cloudflare/kumo/components/button';
import { ClipboardText } from '@cloudflare/kumo/components/clipboard-text';
import { Input } from '@cloudflare/kumo/components/input';
import { LayerCard } from '@cloudflare/kumo/components/layer-card';
import { Table } from '@cloudflare/kumo/components/table';
import { Tabs, type TabsItem } from '@cloudflare/kumo/components/tabs';
import { Text } from '@cloudflare/kumo/components/text';
import { GithubLogoIcon } from '@phosphor-icons/react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import type { EmailThreadMessage, EmailThreadPage, UserLoginSummary } from './auth-store.ts';
import type { ConfiguredMcpServer } from './capabilities.ts';
import type { DashboardWorkflowRun } from './services/flue-runs.ts';
import type { GroceryReminderSummary } from './services/scheduler.ts';

type DashboardMcpServer = ConfiguredMcpServer & { configured: boolean };

function isSafeHttpUrl(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function renderInlineMarkdown(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern =
    /(\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|(https?:\/\/[^\s<]+)|\*\*([^*]+)\*\*|`([^`]+)`|\*([^*]+)\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text))) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    if (match[2] && match[3] && isSafeHttpUrl(match[3])) {
      nodes.push(
        <a key={match.index} href={match[3]} rel="noopener noreferrer" target="_blank">
          {match[2]}
        </a>,
      );
    } else if (match[4] && isSafeHttpUrl(match[4])) {
      const href = match[4].replace(/[),.;:]+$/, '');
      nodes.push(
        <a key={match.index} href={href} rel="noopener noreferrer" target="_blank">
          {href}
        </a>,
      );
      const trailing = match[4].slice(href.length);
      if (trailing) {
        nodes.push(trailing);
      }
    } else if (match[5]) {
      nodes.push(<strong key={match.index}>{match[5]}</strong>);
    } else if (match[6]) {
      nodes.push(<code key={match.index}>{match[6]}</code>);
    } else if (match[7]) {
      nodes.push(<em key={match.index}>{match[7]}</em>);
    } else {
      nodes.push(match[0]);
    }

    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

function renderMarkdown(markdown: string) {
  const blocks: ReactNode[] = [];
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  let paragraph: string[] = [];
  let list: string[] = [];
  let code: string[] | null = null;

  const flushParagraph = () => {
    if (paragraph.length === 0) {
      return;
    }

    blocks.push(<p key={`p-${blocks.length}`}>{renderInlineMarkdown(paragraph.join(' '))}</p>);
    paragraph = [];
  };
  const flushList = () => {
    if (list.length === 0) {
      return;
    }

    blocks.push(
      <ul key={`ul-${blocks.length}`}>
        {list.map((item, index) => (
          <li key={index}>{renderInlineMarkdown(item)}</li>
        ))}
      </ul>,
    );
    list = [];
  };

  for (const line of lines) {
    if (line.startsWith('```')) {
      if (code) {
        blocks.push(<pre key={`code-${blocks.length}`}>{code.join('\n')}</pre>);
        code = null;
      } else {
        flushParagraph();
        flushList();
        code = [];
      }
      continue;
    }

    if (code) {
      code.push(line);
      continue;
    }

    const trimmed = line.trim();
    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const Tag = heading[1].length === 1 ? 'h2' : 'h3';
      blocks.push(<Tag key={`h-${blocks.length}`}>{renderInlineMarkdown(heading[2])}</Tag>);
      continue;
    }

    const bullet = trimmed.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      flushParagraph();
      list.push(bullet[1]);
      continue;
    }

    paragraph.push(trimmed);
  }

  flushParagraph();
  flushList();
  if (code) {
    blocks.push(<pre key={`code-${blocks.length}`}>{code.join('\n')}</pre>);
  }

  return <div className="charles-markdown">{blocks}</div>;
}

const dashboardTabValues = ['dashboard', 'emails', 'groceries', 'workflows', 'settings'] as const;
type DashboardTab = (typeof dashboardTabValues)[number];

function normalizeDashboardTab(value: string | undefined): DashboardTab {
  return dashboardTabValues.includes(value as DashboardTab) ? (value as DashboardTab) : 'dashboard';
}

function dashboardTabs(activeTab: DashboardTab) {
  const tabs: Array<{ value: DashboardTab; label: string; href: string }> = [
    {
      value: 'dashboard',
      label: 'Dashboard',
      href: '/dashboard?tab=dashboard',
    },
    { value: 'emails', label: 'Emails', href: '/dashboard?tab=emails' },
    {
      value: 'groceries',
      label: 'Groceries',
      href: '/dashboard?tab=groceries',
    },
    {
      value: 'workflows',
      label: 'Workflows',
      href: '/dashboard?tab=workflows',
    },
    { value: 'settings', label: 'Settings', href: '/dashboard?tab=settings' },
  ];

  return (
    <Tabs
      variant="segmented"
      selectedValue={activeTab}
      className="charles-dashboard-tabs"
      listClassName="charles-dashboard-tabs-list"
      tabs={tabs.map(
        (tab): TabsItem => ({
          value: tab.value,
          label: tab.label,
          render: (props) => <a {...props} href={tab.href} />,
        }),
      )}
    />
  );
}

function pageShell(title: string, content: ReactNode, script?: string) {
  return `<!doctype html>${renderToStaticMarkup(
    <html lang="en" data-mode="light">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="stylesheet" href="/kumo.css" />
        <style>{`
          :root {
            --color-kumo-brand: #111;
            --color-kumo-brand-hover: #333;
            --text-color-kumo-brand: #111;
          }

          .charles-login {
            min-height: 100vh;
            display: grid;
            place-items: center;
            padding: 1.5rem;
            background: #F5F4EC;
          }

          .charles-login-card {
            width: min(100%, 23rem);
            padding: 1.5rem;
            box-shadow: 0 1px 2px rgb(0 0 0 / 0.05);
          }

          .charles-login-copy {
            margin-top: 0.5rem;
            max-width: 18rem;
          }

          .charles-login-form {
            margin-top: 1.5rem;
            display: grid;
            gap: 1rem;
          }

          .charles-login-form input,
          .charles-login-form button {
            width: 100%;
          }

          .charles-dashboard {
            min-height: 100vh;
            background: #F5F4EC;
            color: #111;
            padding: clamp(2rem, 5vw, 4.5rem);
          }

          .charles-dashboard-shell {
            width: min(100%, 72rem);
            margin: 0 auto;
            display: grid;
            gap: clamp(1.5rem, 3vw, 2.5rem);
          }

          .charles-dashboard-header {
            padding-top: clamp(2rem, 10vh, 7rem);
            max-width: 46rem;
          }

          .charles-dashboard-tabs {
            justify-self: center;
            width: fit-content;
            max-width: 100%;
          }

          .charles-dashboard-tabs-list {
            width: max-content;
            max-width: 100%;
          }

          .charles-dashboard-tab-panel {
            min-width: 0;
          }

          .charles-dashboard-eyebrow {
            letter-spacing: 0.02em;
          }

          .charles-dashboard-title {
            margin-top: 0.5rem;
            font-family: Georgia, 'Times New Roman', Times, serif;
            font-size: clamp(3rem, 8vw, 7rem);
            font-style: italic;
            font-weight: 400;
            letter-spacing: -0.06em;
            line-height: 0.95;
          }

          .charles-dashboard-intro {
            margin-top: 1.25rem;
            max-width: 34rem;
            font-size: 1.05rem;
            line-height: 1.65;
          }

          .charles-dashboard-grid {
            display: grid;
            grid-template-columns: minmax(0, 1.5fr) minmax(18rem, 0.85fr);
            gap: 1.25rem;
            align-items: start;
          }

          .charles-dashboard-stack {
            display: grid;
            gap: 1.25rem;
          }

          .charles-dashboard-card {
            padding: clamp(1.25rem, 3vw, 2rem);
            background: rgb(255 255 255 / 0.52);
            border: 1px solid rgb(17 17 17 / 0.1);
            border-radius: 1.25rem;
            box-shadow: 0 1rem 3rem rgb(76 67 45 / 0.06);
          }

          .charles-dashboard-card-title {
            font-family: Georgia, 'Times New Roman', Times, serif;
            font-size: clamp(1.5rem, 3vw, 2.15rem);
            font-style: italic;
            font-weight: 400;
            letter-spacing: -0.04em;
          }

          .charles-dashboard-list {
            list-style: none;
            margin: 1.5rem 0 0;
            padding: 0;
            display: grid;
            gap: 1.25rem;
          }

          .charles-dashboard-list li {
            padding-top: 1.25rem;
            border-top: 1px solid rgb(17 17 17 / 0.08);
          }

          .charles-dashboard-list li:first-child {
            padding-top: 0;
            border-top: 0;
          }

          .charles-dashboard-copy {
            margin-top: 0.75rem;
            line-height: 1.6;
          }

          .charles-dashboard-pre {
            margin-top: 0.75rem;
            white-space: pre-wrap;
            font-size: 0.8rem;
            line-height: 1.55;
          }

          .charles-thread-table {
            margin-top: 1.5rem;
            width: 100%;
          }

          .charles-thread-table a,
          .charles-dashboard-pagination a,
          .charles-dashboard-back {
            display: inline-flex;
            padding: 0.35rem 0;
            margin-bottom: 0.5rem;
            color: #111;
            text-decoration: underline;
            text-underline-offset: 0.2em;
          }

          .charles-thread-sender {
            display: inline-flex;
            width: min(100%, 22rem);
            margin-top: 0.75rem;
          }

          .charles-dashboard-pagination {
            margin-top: 1.5rem;
            display: flex;
            justify-content: space-between;
            gap: 1rem;
          }

          .charles-thread-card {
            display: grid;
            gap: 1.25rem;
          }

          .charles-thread-message {
            padding-top: 1.5rem;
            border-top: 1px solid rgb(17 17 17 / 0.1);
          }

          .charles-thread-message:first-child {
            padding-top: 0;
            border-top: 0;
          }

          .charles-thread-stamp {
            margin-bottom: 0.8rem;
          }

          .charles-markdown {
            line-height: 1.65;
          }

          .charles-markdown > * + * {
            margin-top: 0.85rem;
          }

          .charles-markdown p,
          .charles-markdown ul,
          .charles-markdown pre,
          .charles-markdown h2,
          .charles-markdown h3 {
            margin-bottom: 0;
          }

          .charles-markdown ul {
            padding-left: 1.2rem;
          }

          .charles-markdown code,
          .charles-markdown pre {
            font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
            font-size: 0.9em;
          }

          .charles-markdown pre {
            white-space: pre-wrap;
            padding: 0.9rem;
            border-radius: 0.75rem;
            background: rgb(17 17 17 / 0.05);
          }

          .charles-markdown a {
            color: #111;
            text-decoration: underline;
            text-underline-offset: 0.2em;
            overflow-wrap: anywhere;
          }

          @media (max-width: 820px) {
            .charles-dashboard-grid {
              grid-template-columns: 1fr;
            }

            .charles-dashboard-header {
              padding-top: 12vh;
            }

            .charles-dashboard-tabs {
              justify-self: stretch;
              width: 100%;
            }
          }
        `}</style>
        <title>{title}</title>
      </head>
      <body>
        {content}
        {script ? <script dangerouslySetInnerHTML={{ __html: script }} /> : null}
      </body>
    </html>,
  )}`;
}

export function homeHtml() {
  return `<!doctype html>${renderToStaticMarkup(
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Charles</title>
        <style>{`
          :root { background: #F5F4EC; color: #111; }
          * { box-sizing: border-box; }
          body { margin: 0; min-height: 100vh; background: #F5F4EC; }
          main { min-height: 100vh; padding-top: 30vh; display: flex; flex-direction: column; align-items: center; }
          h1 { margin: 0; font-family: Georgia, 'Times New Roman', Times, serif; font-size: clamp(2.5rem, 7vw, 7rem); font-style: italic; font-weight: 400; line-height: 0.95; letter-spacing: -0.06em; text-align: center; }
          h1 span { display: block; }
          a { position: fixed; left: 50%; bottom: 2.5rem; transform: translateX(-50%); color: rgb(17 17 17 / 0.28); display: inline-flex; align-items: center; justify-content: center; transition: color 160ms ease; }
          a:hover { color: rgb(17 17 17 / 0.48); }
          svg { width: 2rem; height: 2rem; display: block; }
          a:focus-visible { outline: 2px solid #111; outline-offset: 0.5rem; border-radius: 999px; }
        `}</style>
      </head>
      <body>
        <main aria-label="Charles homepage">
          <h1>
            <span>Pleased to meet you.</span>
            <span>I'm Charles.</span>
          </h1>
          <a href="https://github.com/elithrar/charles" aria-label="Charles on GitHub">
            <GithubLogoIcon aria-hidden="true" weight="fill" />
          </a>
        </main>
      </body>
    </html>,
  )}`;
}

export function loginHtml() {
  return pageShell(
    'Sign in to Charles',
    <main className="charles-login bg-kumo-canvas text-kumo-default">
      <section>
        <LayerCard className="charles-login-card">
          <Text variant="secondary" size="sm">
            Charles
          </Text>
          <Text variant="heading1" as="h1" DANGEROUS_className="mt-3">
            Sign in
          </Text>
          <Text variant="secondary" size="sm" DANGEROUS_className="charles-login-copy">
            Use your allowlisted email address. Charles will send a magic link.
          </Text>
          <form id="sign-in-form" className="charles-login-form">
            <Input name="email" type="email" autoComplete="email" required label="Email" />
            <Button type="submit" variant="primary" className="w-full justify-center">
              Send magic link
            </Button>
          </form>
          <Text
            id="status"
            role="status"
            variant="secondary"
            size="sm"
            DANGEROUS_className="mt-4"
          />
        </LayerCard>
      </section>
    </main>,
    `document.getElementById('sign-in-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const email = new FormData(event.currentTarget).get('email');
      const response = await fetch('/api/auth/sign-in/magic-link', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, callbackURL: '/dashboard' }),
      });
      document.getElementById('status').textContent = response.ok ? 'Check your email for a sign-in link.' : 'Sign-in failed.';
    });`,
  );
}

export function dashboardHtml(
  userEmail: string | undefined,
  reminders: GroceryReminderSummary[],
  emailThreads: EmailThreadPage,
  workflows: DashboardWorkflowRun[],
  recentLogins: UserLoginSummary[],
  mcpServers: DashboardMcpServer[],
  bundledSkills: string[],
  activeTabValue?: string,
) {
  const activeTab = normalizeDashboardTab(activeTabValue);
  const latestReminder = reminders[0];
  const latestWorkflow = workflows[0];

  const emailPanel = (
    <LayerCard className="charles-dashboard-card">
      <Text variant="heading2" as="h2" DANGEROUS_className="charles-dashboard-card-title">
        Recent email threads
      </Text>
      <div>
        {emailThreads.items.length ? (
          <>
            <Table className="charles-thread-table">
              <Table.Header>
                <Table.Row>
                  <Table.Head>Date</Table.Head>
                  <Table.Head>Sender</Table.Head>
                  <Table.Head>Subject</Table.Head>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {emailThreads.items.map((thread) => (
                  <Table.Row key={thread.threadKey}>
                    <Table.Cell>
                      <a href={`/dashboard/threads/${encodeURIComponent(thread.threadKey)}`}>
                        {new Date(thread.latestAt).toLocaleString()}
                      </a>
                    </Table.Cell>
                    <Table.Cell>{thread.from}</Table.Cell>
                    <Table.Cell>{thread.subject}</Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table>
            <nav className="charles-dashboard-pagination" aria-label="Email thread pagination">
              {emailThreads.page > 1 ? (
                <a href={`/dashboard?tab=emails&page=${emailThreads.page - 1}`}>Newer</a>
              ) : (
                <span />
              )}
              <Text variant="secondary" size="sm" as="span">
                Page {emailThreads.page} of {emailThreads.totalPages}
              </Text>
              {emailThreads.page < emailThreads.totalPages ? (
                <a href={`/dashboard?tab=emails&page=${emailThreads.page + 1}`}>Older</a>
              ) : (
                <span />
              )}
            </nav>
          </>
        ) : (
          <Text variant="secondary" DANGEROUS_className="charles-dashboard-copy">
            No recent email threads yet.
          </Text>
        )}
      </div>
    </LayerCard>
  );

  const groceryPanel = (
    <LayerCard className="charles-dashboard-card">
      <Text variant="heading2" as="h2" DANGEROUS_className="charles-dashboard-card-title">
        Grocery
      </Text>
      {reminders.length ? (
        <ul className="charles-dashboard-list">
          {reminders.map((reminder) => (
            <li key={`${reminder.localDate}-${reminder.generatedAt}`}>
              <Text bold>{reminder.localDate}</Text>
              <Text variant="secondary" size="sm">
                {reminder.recipients.join(', ')}
              </Text>
              <Text variant="mono-secondary" as="pre" DANGEROUS_className="charles-dashboard-pre">
                {reminder.text}
              </Text>
            </li>
          ))}
        </ul>
      ) : (
        <Text variant="secondary" DANGEROUS_className="charles-dashboard-copy">
          No grocery reminders recorded yet.
        </Text>
      )}
    </LayerCard>
  );

  const workflowPanel = (
    <LayerCard className="charles-dashboard-card">
      <Text variant="heading2" as="h2" DANGEROUS_className="charles-dashboard-card-title">
        Workflow runs
      </Text>
      {workflows.length ? (
        <ul className="charles-dashboard-list">
          {workflows.map((workflow) => (
            <li key={workflow.id}>
              <Text bold>{workflow.workflow}</Text>
              <Text variant="secondary" size="sm">
                {workflow.status} / {new Date(workflow.createdAt).toLocaleString()}
              </Text>
              <Text DANGEROUS_className="charles-dashboard-copy">{workflow.summary}</Text>
              <Text variant="secondary" size="sm">
                <a href={workflow.detailUrl}>Run</a> / <a href={workflow.eventsUrl}>Events</a>
              </Text>
            </li>
          ))}
        </ul>
      ) : (
        <Text variant="secondary" DANGEROUS_className="charles-dashboard-copy">
          No workflow runs recorded yet.
        </Text>
      )}
    </LayerCard>
  );

  const settingsPanel = (
    <div className="charles-dashboard-stack">
      <LayerCard className="charles-dashboard-card">
        <Text variant="heading2" as="h2" DANGEROUS_className="charles-dashboard-card-title">
          Recent logins
        </Text>
        {recentLogins.length ? (
          <Table className="charles-thread-table">
            <Table.Header>
              <Table.Row>
                <Table.Head>Email</Table.Head>
                <Table.Head>Timestamp</Table.Head>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {recentLogins.map((login, index) => (
                <Table.Row key={`${login.email}-${login.timestamp}-${index}`}>
                  <Table.Cell>{login.email}</Table.Cell>
                  <Table.Cell>{new Date(login.timestamp).toLocaleString()}</Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        ) : (
          <Text variant="secondary" DANGEROUS_className="charles-dashboard-copy">
            No user logins recorded yet.
          </Text>
        )}
      </LayerCard>
      <LayerCard className="charles-dashboard-card">
        <Text variant="heading2" as="h2" DANGEROUS_className="charles-dashboard-card-title">
          MCP servers
        </Text>
        <ul className="charles-dashboard-list">
          {mcpServers.map((server) => (
            <li key={server.name}>
              <Text bold>{server.name}</Text>
              <Text variant="secondary" size="sm">
                {server.configured ? 'Configured' : `Missing ${server.secretName}`}
              </Text>
              <Text variant="mono-secondary" as="code" DANGEROUS_className="charles-dashboard-copy">
                {server.url}
              </Text>
            </li>
          ))}
        </ul>
      </LayerCard>
      <LayerCard className="charles-dashboard-card">
        <Text variant="heading2" as="h2" DANGEROUS_className="charles-dashboard-card-title">
          Bundled skills
        </Text>
        <ul className="charles-dashboard-list">
          {bundledSkills.map((skill) => (
            <li key={skill}>
              <Text>{skill}</Text>
            </li>
          ))}
        </ul>
      </LayerCard>
    </div>
  );

  const dashboardPanel = (
    <section className="charles-dashboard-grid">
      <LayerCard className="charles-dashboard-card">
        <Text variant="heading2" as="h2" DANGEROUS_className="charles-dashboard-card-title">
          At a glance
        </Text>
        <ul className="charles-dashboard-list">
          <li>
            <Text bold>Email threads</Text>
            <Text variant="secondary" DANGEROUS_className="charles-dashboard-copy">
              {emailThreads.total} recorded thread
              {emailThreads.total === 1 ? '' : 's'}.
            </Text>
          </li>
          <li>
            <Text bold>Latest grocery reminder</Text>
            <Text variant="secondary" DANGEROUS_className="charles-dashboard-copy">
              {latestReminder ? latestReminder.localDate : 'No reminders recorded yet.'}
            </Text>
          </li>
          <li>
            <Text bold>Latest workflow</Text>
            <Text variant="secondary" DANGEROUS_className="charles-dashboard-copy">
              {latestWorkflow
                ? `${latestWorkflow.workflow} / ${latestWorkflow.status}`
                : 'No workflow runs recorded yet.'}
            </Text>
          </li>
        </ul>
      </LayerCard>
      <div className="charles-dashboard-stack">
        {groceryPanel}
        {workflowPanel}
      </div>
    </section>
  );
  return pageShell(
    'Charles Dashboard',
    <main className="charles-dashboard text-kumo-default">
      <section className="charles-dashboard-shell">
        <header className="charles-dashboard-header">
          <Text variant="secondary" size="sm" DANGEROUS_className="charles-dashboard-eyebrow">
            Signed in as {userEmail ?? 'unknown'}
          </Text>
          <Text variant="heading1" as="h1" DANGEROUS_className="charles-dashboard-title">
            Charles
          </Text>
          <Text variant="secondary" DANGEROUS_className="charles-dashboard-intro">
            Email-first personal agent for grocery reminders, research, and car parts search.
          </Text>
        </header>
        {dashboardTabs(activeTab)}
        <section className="charles-dashboard-tab-panel">
          {activeTab === 'dashboard' ? dashboardPanel : null}
          {activeTab === 'emails' ? emailPanel : null}
          {activeTab === 'groceries' ? groceryPanel : null}
          {activeTab === 'workflows' ? workflowPanel : null}
          {activeTab === 'settings' ? settingsPanel : null}
        </section>
      </section>
    </main>,
  );
}

export function threadHtml(userEmail: string | undefined, messages: EmailThreadMessage[]) {
  const first = messages[0];
  const threadSender =
    messages.find((message) => message.direction === 'inbound')?.from ?? first.from;
  return pageShell(
    first.subject,
    <main className="charles-dashboard text-kumo-default">
      <section className="charles-dashboard-shell">
        <header className="charles-dashboard-header">
          <a className="charles-dashboard-back" href="/dashboard">
            Back to dashboard
          </a>
          <Text variant="secondary" size="sm" DANGEROUS_className="charles-dashboard-eyebrow">
            Signed in as {userEmail ?? 'unknown'}
          </Text>
          <Text variant="heading1" as="h1" DANGEROUS_className="charles-dashboard-title">
            {first.subject}
          </Text>
          <div className="charles-dashboard-intro">
            <Text variant="secondary" as="span">
              Thread with
            </Text>
            <ClipboardText
              text={threadSender}
              textToCopy={threadSender}
              size="sm"
              className="charles-thread-sender"
              tooltip={{
                text: 'Copy sender email',
                copiedText: 'Copied sender email',
              }}
              labels={{ copyAction: 'Copy sender email' }}
            />
          </div>
        </header>
        <LayerCard className="charles-dashboard-card charles-thread-card">
          {messages.map((message) => (
            <article className="charles-thread-message" key={message.id}>
              <header className="charles-thread-stamp">
                <Text bold>
                  {new Date(message.receivedAt).toLocaleString()} /{' '}
                  {message.fromName ?? message.from}
                </Text>
                <Text variant="secondary" size="sm">
                  {message.direction}
                </Text>
              </header>
              {renderMarkdown(message.bodyMarkdown)}
            </article>
          ))}
        </LayerCard>
      </section>
    </main>,
    `document.querySelector('.charles-thread-sender button')?.addEventListener('click', async () => {
      const sender = document.querySelector('.charles-thread-sender');
      const status = sender?.querySelector('[aria-live="polite"]');
      const email = sender?.querySelector('span:not(.sr-only)')?.textContent?.trim();
      if (!email) return;
      try {
        await navigator.clipboard.writeText(email);
        if (status) status.textContent = 'Copied sender email';
      } catch {
        if (status) status.textContent = 'Copy failed';
      }
    });`,
  );
}

function staticMessageHtml(title: string, message: string) {
  return `<!doctype html>${renderToStaticMarkup(
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title}</title>
        <style>{`
          :root { background: #F5F4EC; color: #111; }
          * { box-sizing: border-box; }
          body { margin: 0; min-height: 100vh; background: #F5F4EC; }
          main { min-height: 100vh; padding-top: 30vh; display: flex; flex-direction: column; align-items: center; }
          h1 { margin: 0; font-family: Georgia, 'Times New Roman', Times, serif; font-size: clamp(1.75rem, 4.9vw, 4.9rem); font-style: italic; font-weight: 400; line-height: 0.95; letter-spacing: -0.06em; text-align: center; }
        `}</style>
      </head>
      <body>
        <main aria-label={title}>
          <h1>{message}</h1>
        </main>
      </body>
    </html>,
  )}`;
}

export function notFoundHtml() {
  return staticMessageHtml('Not found', "Sorry sir, there's nothing here.");
}

export function serverErrorHtml() {
  return staticMessageHtml('Server error', 'Oh dear. Something is terribly wrong.');
}
