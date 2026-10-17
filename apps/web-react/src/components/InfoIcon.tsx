/** Locally authored information symbol, matching the row action icon dimensions. */
export function InfoIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
      className="workspace-action-icon"
    >
      <circle fill="none" cx="12" cy="12" r="9" />
      <path fill="none" d="M12 11v6M12 7v1" />
    </svg>
  );
}
