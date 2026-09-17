import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import test from 'node:test';
import { resumeApproval } from '../src/approval-resume.js';
import {
  callUpstreamTool,
  getUpstreamPrompt,
  readUpstreamResource,
} from '../src/upstream-proxy.js';
import { upstreamService } from './upstream-context.js';

const SECRET_SHAPED = createHash('sha256').update('mcp-upstream-dlp-fixture').digest('hex');

function context(service: any) {
  return (service as any).context();
}

test('a proxied result is DLP-redacted and marked untrusted', async () => {
  const { service, audit } = upstreamService({
    toolResult: { content: [{ type: 'text', text: `token ${SECRET_SHAPED}` }] },
  });
  const result: any = await callUpstreamTool(context(service), 's1', 'github__search', { q: 'x' });
  assert.equal(result.untrusted, true);
  assert.match(result.notice, /data, not instructions/);
  const text = JSON.stringify(result);
  assert.ok(!text.includes(SECRET_SHAPED), 'the secret-shaped string survived redaction');
  assert.match(text, /\[REDACTED\]/);
  assert.equal(audit.events.at(-1).redactionCount, 1);
});

test('the audit row carries server, tool, risk, and verdict', async () => {
  const { service, audit } = upstreamService({ risk: 'HIGH' });
  await callUpstreamTool(context(service), 's1', 'github__search', {});
  const row = audit.events.at(-1);
  assert.equal(row.tool, 'github__search');
  assert.equal(row.operation, 'mcp:github:search');
  assert.equal(row.target, 'github');
  assert.equal(row.risk, 'HIGH');
  assert.equal(row.decision, 'allow');
  assert.equal(row.result, 'SUCCEEDED');
  assert.equal(row.workspaceId, 'w1');
});

test('the risk tier comes from the operator column, not the upstream annotations', async () => {
  const { service, approvals } = upstreamService({
    risk: 'CRITICAL',
    leaseCapabilities: [],
    catalog: {
      tools: [{ name: 'search', annotations: { readOnlyHint: true, destructiveHint: false } }],
    },
  });
  const response: any = await callUpstreamTool(context(service), 's1', 'github__search', {});
  assert.equal(response.status, 'approval_pending');
  assert.equal(approvals.requests.length, 1);
  assert.equal(approvals.requests[0].risk, 'CRITICAL');
  assert.equal(approvals.requests[0].operation.risk, 'CRITICAL');
  assert.equal(approvals.requests[0].operation.capability, 'mcp.proxy');
  assert.equal(approvals.requests[0].operation.family, 'mcp:github:search');
});

test('a needs-review server refuses every call until it is acknowledged', async () => {
  const { service, calls } = upstreamService({ state: 'needs-review' });
  await assert.rejects(
    () => callUpstreamTool(context(service), 's1', 'github__search', {}),
    (error: any) => {
      assert.equal(error.code, 'CAPABILITY_REQUIRED');
      assert.match(error.message, /awaiting operator review/);
      return true;
    },
  );
  await assert.rejects(
    () => readUpstreamResource(context(service), 's1', 'mcp+github://repo://readme'),
    (error: any) => {
      assert.equal(error.code, 'CAPABILITY_REQUIRED');
      return true;
    },
  );
  assert.deepEqual(calls, [], 'a needs-review server was contacted anyway');
});

test('a disabled server is refused and an unknown name is not enabled', async () => {
  const { service } = upstreamService({ enabled: false });
  await assert.rejects(
    () => callUpstreamTool(context(service), 's1', 'github__search', {}),
    (error: any) => error.code === 'CAPABILITY_REQUIRED',
  );
  const live = upstreamService();
  await assert.rejects(
    () => callUpstreamTool(context(live.service), 's1', 'gitlab__search', {}),
    (error: any) => error.code === 'CAPABILITY_REQUIRED',
  );
});

test('an upstream failure message is redacted before it reaches the model', async () => {
  const failure = Object.assign(new Error(`bad credential ${SECRET_SHAPED}`), {
    code: 'UPSTREAM_CALL_FAILED',
  });
  const { service, audit } = upstreamService({ toolError: failure });
  await assert.rejects(
    () => callUpstreamTool(context(service), 's1', 'github__search', {}),
    (error: any) => {
      assert.equal(error.code, 'EXECUTOR_UNAVAILABLE');
      assert.ok(!error.message.includes(SECRET_SHAPED));
      assert.match(error.message, /\[REDACTED\]/);
      assert.deepEqual(error.details, { upstreamCode: 'UPSTREAM_CALL_FAILED' });
      return true;
    },
  );
  assert.equal(audit.events.at(-1).result, 'FAILED');
  assert.equal(audit.events.at(-1).decision, 'allow');
});

test('a proxied resource read keeps the public URI and forwards the upstream one', async () => {
  const { service, calls } = upstreamService();
  const result: any = await readUpstreamResource(
    context(service),
    's1',
    'mcp+github://repo://readme',
  );
  assert.equal(result.uri, 'mcp+github://repo://readme');
  assert.equal(result.untrusted, true);
  assert.deepEqual(calls, [
    { kind: 'resource', server: 'github', entry: 'repo://readme', args: null },
  ]);
});

test('the service dispatches a namespaced name to the proxy instead of throwing', async () => {
  const { service, calls } = upstreamService();
  const result: any = await service.call('s1', 'github__search', { q: 'bug' });
  assert.equal(result.untrusted, true);
  assert.deepEqual(calls, [
    { kind: 'tool', server: 'github', entry: 'search', args: { q: 'bug' } },
  ]);
});

test('an unnamespaced unknown tool still reports that it is not enabled', async () => {
  const { service, calls } = upstreamService();
  await assert.rejects(
    () => service.call('s1', 'not_a_tool', {}),
    (error: any) => {
      assert.equal(error.code, 'CAPABILITY_REQUIRED');
      assert.match(error.message, /Tool not_a_tool is not enabled/);
      return true;
    },
  );
  assert.deepEqual(calls, []);
});

test('approval replay preserves the original upstream operation kind', async () => {
  const { service, approvals, calls } = upstreamService({ leaseCapabilities: [] });
  const runtime = context(service) as any;
  runtime.sessions.connectionIdentity = () => ({ actor: 'oauth:ChatGPT', subject: 'subject' });
  await getUpstreamPrompt(runtime, 's1', 'github__triage', { issue: '42' });
  const requested = approvals.requests[0];
  const ticket = {
    ...requested,
    requestId: 'r1',
    state: 'APPROVED',
    decisionScope: 'once',
  };
  runtime.approvals.status = () => ticket;
  runtime.approvals.resume = async (_id: string, validate: Function, execute: Function) => {
    const verdict = await validate(ticket);
    if (!verdict.ok) throw new Error(verdict.reason);
    return execute(ticket);
  };
  await resumeApproval(runtime, 's1', 'r1');
  assert.deepEqual(calls.at(-1), {
    kind: 'prompt',
    server: 'github',
    entry: 'triage',
    args: { issue: '42' },
  });
});
