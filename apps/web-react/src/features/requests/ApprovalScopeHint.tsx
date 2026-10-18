import type { ApprovalItem } from '@aevra/admin-contracts';
import { actionsForApproval } from './request-actions';

export function ApprovalScopeHint({
  item,
  connectionHasMultipleSessions,
}: {
  item: ApprovalItem;
  connectionHasMultipleSessions?: boolean;
}) {
  if (!connectionHasMultipleSessions) return null;
  if (item.operation.family !== 'workspace:select') return null;
  const hasConnectionAction = actionsForApproval(item).some((a) => a.scope === 'connection');
  if (!hasConnectionAction) return null;

  return (
    <div className="approval-connection-hint" role="note">
      <span>
        This client opens multiple sessions; &ldquo;This connection&rdquo; is recommended.
      </span>
    </div>
  );
}
