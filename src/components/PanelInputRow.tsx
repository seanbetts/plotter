import type { InputHTMLAttributes, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

export type PanelActionRowProps = {
  children: ReactNode;
  actionLabel: string;
  actionIcon: ReactNode;
  actionType?: 'button' | 'submit';
  actionDisabled?: boolean;
  onActionClick?: () => void;
};

export function PanelActionRow({
  children,
  actionLabel,
  actionIcon,
  actionType = 'button',
  actionDisabled = false,
  onActionClick,
}: PanelActionRowProps) {
  return (
    <div className="panel-action-row">
      {children}
      <button type={actionType} aria-label={actionLabel} disabled={actionDisabled} onClick={onActionClick}>
        {actionIcon}
      </button>
    </div>
  );
}

export type PanelInputGroupProps = {
  label: string;
  inputId: string;
  icon: LucideIcon;
  inputProps: Omit<InputHTMLAttributes<HTMLInputElement>, 'id'>;
  className?: string;
  trailingControl?: ReactNode;
  children?: ReactNode;
};

export function PanelInputGroup({
  label,
  inputId,
  icon: Icon,
  inputProps,
  className = 'panel-input-group',
  trailingControl,
  children,
}: PanelInputGroupProps) {
  return (
    <div className={className}>
      <label className="sr-only" htmlFor={inputId}>
        {label}
      </label>
      <div className="search-input-shell">
        <Icon className="search-input-icon" size={18} aria-hidden="true" />
        <input id={inputId} {...inputProps} />
        {trailingControl}
      </div>
      {children}
    </div>
  );
}
