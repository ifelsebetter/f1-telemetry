import './ConnectionStatus.css';

const STATUS_CONFIG = {
  connected: { label: 'Live', className: 'connected' },
  connecting: { label: 'Connecting', className: 'connecting' },
  disconnected: { label: 'Offline', className: 'disconnected' },
  error: { label: 'Error', className: 'error' },
};

export default function ConnectionStatus({ status }) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.disconnected;

  return (
    <div
      className={`connection-status connection-status--${config.className}`}
      role="status"
      aria-live="polite"
      id="connection-status"
    >
      <span className="connection-status__dot" aria-hidden="true" />
      <span className="connection-status__label">{config.label}</span>
    </div>
  );
}
