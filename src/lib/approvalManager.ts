/**
 * User Approval and Permissions Manager for Manus AI
 * 
 * Provides unified confirmation mechanisms for sensitive/destructive operations
 * (file deletions, git pushes, code execution, external webhooks, device actions).
 */

import { observability } from './observability';
import { securityCenter } from './securityCenter';

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired' | 'cancelled';
export type ApprovalRiskLevel = 'moderate' | 'sensitive' | 'destructive';

export interface ProposedAction {
  id: string;
  toolName: string;
  title: string;
  description: string;
  target?: string;
  parameters: Record<string, any>;
  riskLevel: ApprovalRiskLevel;
  consequences: string[];
  userId: string;
  createdAt: number;
  expiresAt: number;
  status: ApprovalStatus;
  resolvedAt?: number;
}

type ApprovalListener = (action: ProposedAction) => void;

class ApprovalManagerService {
  private pendingActions = new Map<string, ProposedAction>();
  private listeners: ApprovalListener[] = [];
  private readonly DEFAULT_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes

  /**
   * Register a proposed action that requires user authorization
   */
  public proposeAction(params: {
    toolName: string;
    title: string;
    description: string;
    target?: string;
    parameters: Record<string, any>;
    riskLevel: ApprovalRiskLevel;
    consequences?: string[];
    userId?: string;
    expiresInMs?: number;
  }): ProposedAction {
    const id = `act_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const now = Date.now();
    const action: ProposedAction = {
      id,
      toolName: params.toolName,
      title: params.title,
      description: params.description,
      target: params.target,
      parameters: params.parameters,
      riskLevel: params.riskLevel,
      consequences: params.consequences || [
        'This action modifies state or communicates with an external system.',
      ],
      userId: params.userId || 'usr_manus_default',
      createdAt: now,
      expiresAt: now + (params.expiresInMs || this.DEFAULT_EXPIRY_MS),
      status: 'pending',
    };

    this.pendingActions.set(id, action);

    securityCenter.recordAudit({
      action: 'action_proposed',
      userId: action.userId,
      status: 'allowed',
      reason: `Proposed ${action.toolName} (${action.riskLevel})`,
      target: action.target,
    });

    // Notify listeners / UI components
    this.notifyListeners(action);

    return action;
  }

  /**
   * User approves the proposed action
   */
  public approve(actionId: string, userId = 'usr_manus_default'): boolean {
    const action = this.pendingActions.get(actionId);
    if (!action) return false;

    if (Date.now() > action.expiresAt) {
      action.status = 'expired';
      this.notifyListeners(action);
      return false;
    }

    action.status = 'approved';
    action.resolvedAt = Date.now();

    securityCenter.recordAudit({
      action: 'action_approved',
      userId,
      status: 'allowed',
      reason: `User approved execution of ${action.toolName}`,
      target: action.target,
    });

    observability.log({
      level: 'info',
      category: 'security',
      message: `User approved action: ${action.title} (${action.toolName})`,
    });

    this.notifyListeners(action);
    return true;
  }

  /**
   * User rejects the proposed action
   */
  public reject(actionId: string, userId = 'usr_manus_default'): boolean {
    const action = this.pendingActions.get(actionId);
    if (!action) return false;

    action.status = 'rejected';
    action.resolvedAt = Date.now();

    securityCenter.recordAudit({
      action: 'action_rejected',
      userId,
      status: 'denied',
      reason: `User rejected execution of ${action.toolName}`,
      target: action.target,
    });

    this.notifyListeners(action);
    return true;
  }

  /**
   * Alias for approve
   */
  public approveAction(actionId: string, userId = 'usr_manus_default'): boolean {
    return this.approve(actionId, userId);
  }

  /**
   * Alias for reject
   */
  public rejectAction(actionId: string, reason?: string, userId = 'usr_manus_default'): boolean {
    const action = this.pendingActions.get(actionId);
    if (action && reason) {
      action.consequences = [...(action.consequences || []), `Rejection reason: ${reason}`];
    }
    return this.reject(actionId, userId);
  }

  /**
   * Get action by id, evaluating expiration if still pending
   */
  public getAction(actionId: string): ProposedAction | undefined {
    const action = this.pendingActions.get(actionId);
    if (!action) return undefined;
    if (action.status === 'pending' && Date.now() > action.expiresAt) {
      action.status = 'expired';
    }
    return action;
  }

  /**
   * Check if action is currently approved and not expired
   */
  public isApproved(actionId: string): boolean {
    const action = this.pendingActions.get(actionId);
    if (!action) return false;
    if (action.status !== 'approved') return false;
    if (action.expiresAt && Date.now() > action.expiresAt) return false;
    return true;
  }

  /**
   * Retrieve all currently active pending actions
   */
  public getPendingActions(): ProposedAction[] {
    const now = Date.now();
    const active: ProposedAction[] = [];

    for (const [_, action] of this.pendingActions) {
      if (action.status === 'pending') {
        if (now > action.expiresAt) {
          action.status = 'expired';
        } else {
          active.push(action);
        }
      }
    }

    return active;
  }

  /**
   * Subscribe to approval events
   */
  public subscribe(listener: ApprovalListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private notifyListeners(action: ProposedAction) {
    for (const listener of this.listeners) {
      try {
        listener(action);
      } catch (err) {
        console.error('[ApprovalManager] Error in listener callback:', err);
      }
    }
  }
}

export const approvalManager = new ApprovalManagerService();
