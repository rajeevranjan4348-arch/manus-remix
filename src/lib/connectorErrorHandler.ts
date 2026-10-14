import { toast } from 'sonner';
import { CONNECTOR_CATALOG, getConnectorState, updateConnectorState, startOAuthFlow, ConnectorStatus } from './connectors';

export type ConnectorIssueType = 
  | 'expired' 
  | 'permission_required' 
  | 'connection_failed' 
  | 'disconnected' 
  | 'rate_limited';

export interface ConnectorErrorOptions {
  issueType?: ConnectorIssueType;
  customMessage?: string;
  rawError?: any;
  onReauthorized?: () => void;
  silentStateUpdateOnly?: boolean;
}

/**
 * Infer the specific connector issue type from raw error messages or HTTP status codes.
 */
export function inferConnectorIssueType(error: any): ConnectorIssueType {
  if (!error) return 'connection_failed';

  const errStr = typeof error === 'string' 
    ? error.toLowerCase() 
    : JSON.stringify(error).toLowerCase();

  if (
    errStr.includes('expired') || 
    errStr.includes('token_expired') || 
    errStr.includes('invalid_token') || 
    errStr.includes('401') || 
    errStr.includes('unauthorized') ||
    errStr.includes('session invalid') ||
    errStr.includes('stale')
  ) {
    return 'expired';
  }

  if (
    errStr.includes('permission') || 
    errStr.includes('scope') || 
    errStr.includes('insufficient_scope') || 
    errStr.includes('access_denied') || 
    errStr.includes('403') || 
    errStr.includes('forbidden') ||
    errStr.includes('unauthorized_scope')
  ) {
    return 'permission_required';
  }

  if (
    errStr.includes('disconnected') || 
    errStr.includes('not_connected') || 
    errStr.includes('unlinked') || 
    errStr.includes('logged_out')
  ) {
    return 'disconnected';
  }

  if (
    errStr.includes('rate limit') || 
    errStr.includes('429') || 
    errStr.includes('too many requests')
  ) {
    return 'rate_limited';
  }

  return 'connection_failed';
}

/**
 * Get human-friendly metadata for a connector error issue.
 */
export function getIssueTypeDetails(issueType: ConnectorIssueType, connectorName: string) {
  switch (issueType) {
    case 'expired':
      return {
        title: `${connectorName}: Token Expired`,
        status: 'expired' as ConnectorStatus,
        defaultDescription: `Authorization token for ${connectorName} has expired or was revoked. Re-authorize to restore access.`,
        actionLabel: 'Re-authorize Token',
        badgeBg: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20'
      };
    case 'permission_required':
      return {
        title: `${connectorName}: Permissions Required`,
        status: 'permission_required' as ConnectorStatus,
        defaultDescription: `${connectorName} requires additional scopes or permissions to perform this action.`,
        actionLabel: 'Grant Permissions',
        badgeBg: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20'
      };
    case 'disconnected':
      return {
        title: `${connectorName}: Account Disconnected`,
        status: 'disconnected' as ConnectorStatus,
        defaultDescription: `${connectorName} is currently disconnected. Connect your account to use this feature.`,
        actionLabel: 'Connect Account',
        badgeBg: 'bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20'
      };
    case 'rate_limited':
      return {
        title: `${connectorName}: Rate Limit Exceeded`,
        status: 'error' as ConnectorStatus,
        defaultDescription: `Too many requests sent to ${connectorName}. Please wait a moment before trying again.`,
        actionLabel: 'Retry Connection',
        badgeBg: 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20'
      };
    case 'connection_failed':
    default:
      return {
        title: `${connectorName}: Connection Failed`,
        status: 'error' as ConnectorStatus,
        defaultDescription: `Could not reach ${connectorName} service. Please check your connection or re-authenticate.`,
        actionLabel: 'Fix Connection',
        badgeBg: 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20'
      };
  }
}

/**
 * Centralized connector UI error handler.
 * Displays interactive toast notification with one-click re-authorization prompt and updates store status.
 */
export function handleConnectorError(
  connectorId: string,
  error: any,
  options: ConnectorErrorOptions = {}
): ConnectorIssueType {
  const connectorDef = CONNECTOR_CATALOG.find(c => c.id === connectorId);
  const connectorName = connectorDef?.name || connectorId.toUpperCase();
  
  const issueType = options.issueType || inferConnectorIssueType(options.rawError || error);
  const details = getIssueTypeDetails(issueType, connectorName);
  
  const errorMessage = options.customMessage || 
    (typeof error === 'string' ? error : error?.message) || 
    details.defaultDescription;

  // 1. Synchronize status into connector state store
  updateConnectorState(connectorId, {
    status: details.status,
    errorMessage
  });

  // 2. Dispatch custom global event for reactive UI listeners
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('manus_connector_error', {
        detail: {
          connectorId,
          connectorName,
          issueType,
          errorMessage,
          status: details.status
        }
      })
    );
  }

  // If caller only wanted silent state update
  if (options.silentStateUpdateOnly) {
    return issueType;
  }

  // 3. Display interactive Toast with One-Click Re-Authorization Prompt
  toast.error(details.title, {
    description: errorMessage,
    duration: 8000,
    action: {
      label: details.actionLabel,
      onClick: async () => {
        toast.info(`Initiating re-authorization for ${connectorName}...`);
        try {
          const success = await startOAuthFlow(connectorId);
          if (success) {
            toast.success(`${connectorName} Re-authorized Successfully! ⚡`, {
              description: `Connection restored. Your tool requests can now be processed.`
            });
            if (options.onReauthorized) {
              options.onReauthorized();
            }
          } else {
            toast.error(`Re-authorization for ${connectorName} incomplete or cancelled.`);
          }
        } catch (e: any) {
          toast.error(`Re-authorization error: ${e?.message || 'Unknown error'}`);
        }
      }
    }
  });

  return issueType;
}

/**
 * Convenience alias for handleConnectorError
 */
export const notifyConnectorError = handleConnectorError;
export const showConnectorErrorToast = handleConnectorError;
